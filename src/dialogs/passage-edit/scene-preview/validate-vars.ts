/**
 * Story-level variable validation: does every `if:` on a link name a variable the story
 * actually sets?
 *
 * Same reasoning as `validate-links.ts` — and deliberately not in `@sliders/scene-schema`
 * for the same reason. A condition like `if: has_weapon` is only meaningful against the
 * vars sections of the whole story, and the parser sees one `[scene]` block.
 *
 * "Sets" means Chapbook's vars section: the `name: value` lines above a `--` line at the
 * top of a passage (spec 02, "Chapbook's vars section stays as-is"). Anything else a
 * condition can name is a Chapbook built-in namespace, listed below.
 */

import {ParseResult, SceneError} from '@sliders/scene-types';
import {nearestKey} from '@sliders/scene-schema';

export interface VarValidationInput {
	/** The whole passage text, so the vars section being typed right now counts. */
	text: string;
	/** 0-based line the scene block starts on, as `extractSceneBlock` reports it. */
	blockOffset: number;
	/** The parse of the block, absent when there is nothing parseable in it. */
	result?: ParseResult;
	/** Every passage in the story, for the vars sections they declare. */
	passages: {name: string; text: string}[];
}

/**
 * Ends a vars section. Chapbook's own separator is a line of exactly two dashes; more are
 * accepted because a longer rule is what an author who has seen Markdown writes.
 */
const VARS_END_RE = /^\s*--+\s*$/;

/**
 * A vars line: `has_weapon: true`, `sliders.fullScreen: false`, and Chapbook's conditional
 * form `has_weapon (visited): true`. Only the name matters here.
 */
const VARS_LINE_RE = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:\([^)]*\))?\s*:/;

/**
 * Namespaces Chapbook hands the story for free, plus ours. A condition may reach into any
 * of them without anything having been written in a vars section.
 */
const BUILTIN_ROOTS = new Set([
	'config',
	'engine',
	'now',
	'passage',
	'random',
	'sliders',
	'story'
]);

/** Words in an expression that are syntax, not state. */
const KEYWORDS = new Set([
	'and',
	'false',
	'in',
	'Infinity',
	'NaN',
	'not',
	'null',
	'or',
	'true',
	'typeof',
	'undefined'
]);

/**
 * Strings and numbers first so their innards never look like names, then a dotted name.
 * `'no' in list` must yield `list` alone, and `1.5` must yield nothing at all.
 */
const EXPR_RE =
	/(['"])(?:\\.|(?!\1)[^\\])*\1?|\b\d[\d.eE+-]*|([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;

/**
 * The variable names one passage's vars section declares. A passage with no `--` line has
 * no vars section, and its ordinary prose must not be mistaken for one.
 */
export function passageVariables(text: string): string[] {
	const names: string[] = [];

	for (const line of text.split('\n')) {
		if (VARS_END_RE.test(line)) {
			return names;
		}

		if (line.trim() === '') {
			continue;
		}

		const match = VARS_LINE_RE.exec(line);

		if (!match) {
			// Something that is not a `name: value` line before any `--`: this passage
			// opens with prose, so it has no vars section at all.
			return [];
		}

		names.push(match[1]);
	}

	return [];
}

/**
 * Every variable the story sets, each name also recorded by its root — `player.name` being
 * set is what makes a bare `player` a real thing to test.
 */
export function definedVariables(texts: string[]): Set<string> {
	const defined = new Set<string>();

	for (const text of texts) {
		for (const name of passageVariables(text)) {
			defined.add(name);
			defined.add(name.split('.')[0]);
		}
	}

	return defined;
}

/** A name an expression tests, and where in the expression it was written. */
export interface ExprName {
	name: string;
	index: number;
}

/** The variables an `if:` expression reads, in the order they appear. */
export function conditionNames(expression: string): ExprName[] {
	const names: ExprName[] = [];

	EXPR_RE.lastIndex = 0;

	let match: RegExpExecArray | null;

	while ((match = EXPR_RE.exec(expression)) !== null) {
		const name = match[2];

		if (name === undefined || KEYWORDS.has(name)) {
			continue;
		}

		// `foo(…)` is a call, and a call is not state the story sets.
		if (/^\s*\(/.test(expression.slice(match.index + name.length))) {
			continue;
		}

		names.push({index: match.index, name});
	}

	return names;
}

/** Is this name something the story sets, or something Chapbook provides? */
function isKnown(name: string, defined: Set<string>): boolean {
	const root = name.split('.')[0];

	return BUILTIN_ROOTS.has(root) || defined.has(name) || defined.has(root);
}

/**
 * Where in the passage a name inside an `if:` sits, so the underline lands on the name and
 * not on the whole condition.
 *
 * The span the parser reports covers the value as written, quotes included, so the name is
 * found in the source line rather than counted out from the expression — `if: "a and b"`
 * would otherwise be off by a quote.
 */
function nameSpan(
	lines: string[],
	span: {line: number; col: number; endLine?: number; endCol?: number} | undefined,
	blockOffset: number,
	name: string
): {line: number; col: number; endCol?: number} {
	if (!span) {
		return {col: 1, line: blockOffset + 1};
	}

	const line = span.line + blockOffset;
	const source = lines[line - 1];

	if (source && (span.endLine === undefined || span.endLine === span.line)) {
		const from = span.col - 1;
		const to = span.endCol === undefined ? source.length : span.endCol - 1;
		const at = source.slice(from, to).indexOf(name);

		if (at !== -1) {
			return {col: from + at + 1, endCol: from + at + name.length + 1, line};
		}
	}

	return {col: span.col, endCol: span.endCol, line};
}

/**
 * Every `if:` in the scene that tests a variable nothing sets.
 *
 * Lines are absolute, like `linkTargetErrors` — the caller has already mapped the parser's
 * own errors, and these never went through that.
 */
export function unknownVariableErrors(input: VarValidationInput): SceneError[] {
	const {blockOffset, passages, result, text} = input;
	const links = result?.scene.links ?? {};
	const conditions = Object.values(links).filter(link => link.if);

	if (conditions.length === 0) {
		return [];
	}

	// The story's copy of this passage is a debounced second behind, so the live text goes
	// in as well: a variable declared thirty seconds ago must not read as missing.
	const defined = definedVariables([text, ...passages.map(one => one.text)]);
	const known = [...defined].filter(name => !name.includes('.'));
	const lines = text.split('\n');
	const spans = result?.linkIfSpans ?? {};
	const errors: SceneError[] = [];

	for (const link of conditions) {
		for (const {name} of conditionNames(link.if!)) {
			if (isKnown(name, defined)) {
				continue;
			}

			const nearest = nearestKey(name, known);
			const at = nameSpan(lines, spans[link.name], blockOffset, name);

			errors.push({
				code: 'unknown-variable',
				col: at.col,
				endCol: at.endCol,
				endLine: at.line,
				hint:
					nearest === undefined
						? `Set it in a vars section: '${name}: false' above a '--' line at the top of a passage.`
						: `Did you mean '${nearest}'?`,
				line: at.line,
				message: `Link '${link.name}' tests a variable nothing sets: '${name}'.`,
				severity: 'error'
			});
		}
	}

	return errors;
}
