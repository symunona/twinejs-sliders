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
 */

import {ParseResult, SceneError} from '@sliders/scene-types';
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

function missingHint(to: string, passageNames: string[]): string {
	const nearest = nearestKey(to, passageNames);

	return nearest === undefined
		? 'Create that passage, or point the link somewhere that exists.'
		: `Did you mean '${nearest}'?`;
}

/**
 * Every link in the passage that names a passage the story does not have.
 *
 * Lines are absolute — the caller has already offset the parser's own errors, and these
 * never went through that mapping.
 */
export function linkTargetErrors(input: LinkValidationInput): SceneError[] {
	const {blockLines, blockOffset, passageNames, result, text} = input;

	if (passageNames.length === 0) {
		return [];
	}

	const exists = new Set(passageNames);
	const errors: SceneError[] = [];
	const links = result?.scene.links ?? {};
	const spans = result?.linkSpans ?? {};

	// 1. The scene's own links:, wherever their target was written.

	for (const link of Object.values(links)) {
		if (!link.to || exists.has(link.to) || EXTERNAL_RE.test(link.to)) {
			continue;
		}

		const span = spans[link.name];

		errors.push({
			code: 'unknown-passage',
			col: span?.col ?? 1,
			hint: missingHint(link.to, passageNames),
			line: (span?.line ?? 1) + blockOffset,
			endCol: span?.endCol,
			endLine: span?.endLine === undefined ? undefined : span.endLine + blockOffset,
			message: missingMessage(link.name, link.to),
			severity: 'error'
		});
	}

	// 2. Prose links outside the block. A bare `[[stay]]` that links: already claims is
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

			if (name === '' || EXTERNAL_RE.test(name) || exists.has(name)) {
				continue;
			}

			if (start === 0 && body.indexOf('][') === -1 && links[name]) {
				continue; // `[[stay]]`, routed by links:.
			}

			const col = match.index + 2 + start + 1;

			errors.push({
				code: 'unknown-passage',
				col,
				hint: missingHint(name, passageNames),
				endCol: col + to.length,
				endLine: i + 1,
				line: i + 1,
				message: `[[${name}]] points at a passage that doesn't exist.`,
				severity: 'error'
			});
		}
	}

	return errors;
}
