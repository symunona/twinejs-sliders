/**
 * Story-level link validation: does every link in this passage point at a passage that
 * actually exists?
 *
 * Deliberately NOT in `@sliders/scene-schema`. The parser sees one block and knows
 * nothing about the story around it; only the editor holds the passage list, so only the
 * editor can tell `to: Tavern Fight` from `to: Tavren Fight`.
 *
 * Two places a target can be written, and both are checked:
 *   - a scene's `links:` map, including the targets an inline `[[stay -> Street]]` in beat
 *     text supplies. The parser reports where each one was written as `linkSpans`.
 *   - plain `[[…]]` links in the prose outside the block, which is a way out of the scene
 *     just as much as a `links:` entry is.
 *
 * These are WARNINGS, not errors. Pointing at a passage that does not exist yet is how
 * authors work — the story map draws the target as a dashed ghost and creating it is one
 * click (`util/broken-link-ghosts`), exactly as `[[not written yet]]` behaves. What the
 * list adds on top of the ghost is the typo case: "did you mean 'Tavern'?" for a
 * `to: Tavren` the author never meant to create.
 */

import {
	ParseResult,
	SceneError,
	SceneFix,
	SceneSpan,
	matchPassageName
} from '@sliders/scene-types';
import {nearestKey} from '@sliders/scene-schema';

export interface LinkValidationInput {
	/** The whole passage text, so prose outside the block is checked too. */
	text: string;
	/** 0-based line the scene block starts on, as `extractSceneBlock` reports it. */
	blockOffset: number;
	/** How many lines the block covers, so prose can be told from scene YAML. */
	blockLines: number;
	/** The parse of the block, absent when there is nothing parseable in it. */
	result?: ParseResult;
	/** Every passage name in the story, this passage included. */
	passageNames: string[];
}

/**
 * An `unknown-passage` error, plus the name the author actually wrote.
 *
 * The error list offers to create the missing passage, and it needs the bare name to do
 * it. Digging it back out of `message` would be a parse of English; carrying it is one
 * optional field, and `SceneError` (which lives in `@sliders/scene-types`, shared with the
 * parser and the CLI) stays free of anything only the editor cares about.
 */
export interface LinkTargetError extends SceneError {
	/** Absent on any error that is not a missing passage target. */
	missingPassage?: string;
}

/** `http://…`, `mailto:…` — someone else's problem, not a passage. */
const EXTERNAL_RE = /^\w+:\/\/\/?\w|^mailto:/i;

/** A whole `[[…]]`, with its body, and where the body starts. */
const LINK_RE = /\[\[(.*?)\]\]/g;

/**
 * The passage a `[[…]]` body points at, and where in the body it was written.
 *
 * Handles every form Twine's own parser does: `[[Target]]`, `[[text->Target]]`,
 * `[[Target<-text]]`, `[[text|Target]]`, and a `[[Target][setter]]` suffix. The rightmost
 * `->` and the leftmost `<-` win, matching `util/parse-links`.
 */
function targetOfBody(body: string): {start: number; text: string} {
	const setter = body.indexOf('][');
	const head = setter === -1 ? body : body.slice(0, setter);
	const arrow = head.lastIndexOf('->');

	if (arrow !== -1) {
		return {start: arrow + 2, text: head.slice(arrow + 2)};
	}

	const back = head.indexOf('<-');

	if (back !== -1) {
		return {start: 0, text: head.slice(0, back)};
	}

	const pipe = head.lastIndexOf('|');

	if (pipe !== -1) {
		return {start: pipe + 1, text: head.slice(pipe + 1)};
	}

	return {start: 0, text: head};
}

function missingMessage(name: string, to: string): string {
	return `Link '${name}' points at a passage that doesn't exist: '${to}'.`;
}

/** A target that only found its passage by case. It works; it is still worth tidying. */
function caseMessage(to: string, matched: string): string {
	return `'${to}' differs in case from the passage '${matched}'.`;
}

/**
 * The hint, and the repair when the name is close enough to be a typo.
 *
 * Both come out of one `nearestKey` call, so the button and the sentence can never suggest
 * different names. The fix carries no span: only the caller knows whether it has a real one
 * to attach (see `spanFix`).
 */
function missingSuggestion(
	to: string,
	passageNames: string[]
): {hint: string; fix?: Omit<SceneFix, keyof SceneSpan>} {
	const nearest = nearestKey(to, passageNames);

	if (nearest === undefined) {
		return {
			hint: 'Create that passage, or point the link somewhere that exists.'
		};
	}

	return {
		fix: {label: `Change '${to}' to '${nearest}'`, replaces: to, text: nearest},
		hint: `Did you mean '${nearest}'?`
	};
}

/**
 * What is wrong with one link target, or `undefined` when it names a passage exactly.
 *
 * Two answers, because the player resolves a name case-insensitively (`matchPassageName`,
 * and `passageNamed()` in the format): a target that differs only in case WORKS, so it is
 * not a missing passage and must not draw a ghost card — but it is still worth saying,
 * because a story that spells one room two ways is one rename away from a dead link.
 */
function targetIssue(
	to: string,
	passageNames: string[]
):
	| {
			code: 'unknown-passage' | 'passage-case';
			fix?: Omit<SceneFix, keyof SceneSpan>;
			hint: string;
			matched?: string;
	  }
	| undefined {
	const matched = matchPassageName(passageNames, to);

	if (matched === to) {
		return undefined;
	}

	if (matched !== undefined) {
		return {
			code: 'passage-case',
			fix: {
				label: `Change '${to}' to '${matched}'`,
				replaces: to,
				text: matched
			},
			hint: `The player finds it anyway, but the passage is called '${matched}'.`,
			matched
		};
	}

	return {code: 'unknown-passage', ...missingSuggestion(to, passageNames)};
}

/**
 * Attaches a span to a fix, or drops the fix when there is no real span to attach.
 *
 * A link declared in `links:` has a target span only when the parser recorded one; without
 * it the error falls back to column 1 of the block, and a fix aimed there would splice the
 * suggestion over whatever happens to sit on that line. A missing button is a small loss,
 * a wrong edit is not.
 */
function spanFix(
	fix: Omit<SceneFix, keyof SceneSpan> | undefined,
	span: SceneSpan | undefined
): SceneFix | undefined {
	if (!fix || !span || span.endCol === undefined) {
		return undefined;
	}

	return {...fix, ...span};
}

/**
 * Every link in the passage that names a passage the story does not have.
 *
 * Lines are absolute — the caller has already offset the parser's own errors, and these
 * never went through that mapping.
 */
export function linkTargetErrors(input: LinkValidationInput): LinkTargetError[] {
	const {blockLines, blockOffset, passageNames, result, text} = input;

	if (passageNames.length === 0) {
		return [];
	}

	const errors: LinkTargetError[] = [];
	const links = result?.scene.links ?? {};
	const spans = result?.linkSpans ?? {};

	// 1. The scene's own links:, wherever their target was written.

	for (const link of Object.values(links)) {
		if (!link.to || EXTERNAL_RE.test(link.to)) {
			continue;
		}

		const suggestion = targetIssue(link.to, passageNames);

		if (!suggestion) {
			continue;
		}

		const span = spans[link.name];
		const line = (span?.line ?? 1) + blockOffset;
		const endLine =
			span?.endLine === undefined ? undefined : span.endLine + blockOffset;

		errors.push({
			code: suggestion.code,
			col: span?.col ?? 1,
			fix: spanFix(
				suggestion.fix,
				span && {col: span.col, endCol: span.endCol, endLine, line}
			),
			hint: suggestion.hint,
			line,
			endCol: span?.endCol,
			endLine,
			message: suggestion.matched
				? caseMessage(link.to, suggestion.matched)
				: missingMessage(link.name, link.to),
			...(suggestion.matched ? {} : {missingPassage: link.to}),
			severity: 'warning'
		});
	}

	// 2. Clickable entities. A list, not a map: two props may lead to the same missing
	//    passage and both deserve a squiggle.

	for (const span of result?.entityLinkSpans ?? []) {
		if (EXTERNAL_RE.test(span.to)) {
			continue;
		}

		const suggestion = targetIssue(span.to, passageNames);

		if (!suggestion) {
			continue;
		}

		const line = span.line + blockOffset;
		const endLine =
			span.endLine === undefined ? undefined : span.endLine + blockOffset;

		errors.push({
			code: suggestion.code,
			col: span.col,
			fix: spanFix(suggestion.fix, {
				col: span.col,
				endCol: span.endCol,
				endLine,
				line
			}),
			hint: suggestion.hint,
			line,
			endCol: span.endCol,
			endLine,
			message: suggestion.matched
				? caseMessage(span.to, suggestion.matched)
				: `This link points at a passage that doesn't exist: '${span.to}'.`,
			...(suggestion.matched ? {} : {missingPassage: span.to}),
			severity: 'warning'
		});
	}

	// 3. Prose links outside the block. A bare `[[stay]]` that links: already claims is
	//    skipped: it is a link NAME, and rule 1 has judged where it goes.

	const lines = text.split('\n');
	const blockEnd = blockOffset + blockLines;

	for (let i = 0; i < lines.length; i++) {
		if (i >= blockOffset && i < blockEnd) {
			continue;
		}

		LINK_RE.lastIndex = 0;

		let match: RegExpExecArray | null;

		while ((match = LINK_RE.exec(lines[i])) !== null) {
			const body = match[1];
			const {start, text: to} = targetOfBody(body);
			const name = to.trim();

			if (name === '' || EXTERNAL_RE.test(name)) {
				continue;
			}

			if (start === 0 && body.indexOf('][') === -1 && links[name]) {
				continue; // `[[stay]]`, routed by links:.
			}

			const suggestion = targetIssue(name, passageNames);

			if (!suggestion) {
				continue;
			}

			const col = match.index + 2 + start + 1;
			const span = {col, endCol: col + to.length, endLine: i + 1, line: i + 1};

			errors.push({
				code: suggestion.code,
				...span,
				fix: spanFix(suggestion.fix, span),
				hint: suggestion.hint,
				message: suggestion.matched
					? caseMessage(name, suggestion.matched)
					: `[[${name}]] points at a passage that doesn't exist.`,
				...(suggestion.matched ? {} : {missingPassage: name}),
				severity: 'warning'
			});
		}
	}

	return errors;
}
