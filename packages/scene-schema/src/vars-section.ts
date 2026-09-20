// Type-only, so the module stays the runtime leaf its header promises: the story format's
// vendored Chapbook imports it, and a real dependency here would follow it into the bundle.
import type {SceneError, SceneFix} from '@sliders/scene-types';

/**
 * Chapbook's vars section, as one rule three consumers share.
 *
 * A passage may open with `name: value` lines, closed by a separator line, and everything
 * after that is the body. The separator is the whole contract, and it used to be written
 * three times: the runtime parser, the editor's lint and the CodeMirror mode each had their
 * own regexp, and the lint's was the loose one. So `---` read as a vars section in the
 * editor, was not one in the player, and the lines above it were silently dropped by
 * `sceneOnlyBlocks` on the way — green editor, dead story, nothing on screen to say why.
 *
 * Hence this module. It is a leaf on purpose (no `yaml`, no parser): the story format's
 * vendored Chapbook imports it too, and the point is that there is nowhere left for a
 * fourth opinion to live.
 *
 * The rule is deliberately NOT widened to `-{2,}`. `---` is a Markdown horizontal rule, so
 * accepting it would turn the prose above any scene break in any Chapbook story into
 * variable declarations. A near miss is reported (see `nearMissSeparator`), never honoured.
 *
 * TWO ROLES LIVE HERE, and confusing them is what the original bug was:
 *
 *   RUNTIME TRUTH — `splitVarsSection` and `scanVarsLines` reproduce what the player
 *   actually does, quirks included. Whatever they say, the reader gets. A linter may
 *   complain about what they return, but it may not disagree about what it IS.
 *
 *   EDITOR HEURISTIC — `VARS_LINE_RE`, `looksLikeVarsLine`, `looksLikeVarsSection` and
 *   `nearMissSeparator` answer a different and softer question: "does this blob LOOK like
 *   somebody meant it as a vars section?". They are deliberately STRICTER than the runtime
 *   (identifier-shaped names only), because they are used to decide whether to warn about
 *   text the player would otherwise swallow. Never wire them into the runtime: the player
 *   accepts `my name: 1` today, and narrowing that would quietly stop setting a variable
 *   in stories already published.
 *
 * The module owns the GRAMMAR and the exact source text the runtime compiles. Each consumer
 * owns the ACTION — the player executes, the lint compiles to check, the editor highlights.
 * That is what keeps a checker from ever disagreeing with the thing it checks.
 */

/** What an author must type. */
export const VARS_SEPARATOR = '--';

/**
 * A separator line. Trailing spaces and tabs are allowed because they are invisible and no
 * author ever meant them; anything else is a near miss, not a separator.
 */
export const VARS_SEPARATOR_RE = /^--[ \t]*$/;

/** The same rule as a multiline pattern, for `String.split`. */
export const VARS_SEPARATOR_SPLIT_RE = /^--[ \t]*$/m;

/** A line of nothing but dashes: `---`, `  --`, `----  `. Includes real separators. */
export const VARS_NEAR_MISS_RE = /^[ \t]*-{2,}[ \t]*$/;

/**
 * A vars line: `has_weapon: true`, `sliders.fullScreen: false`, and Chapbook's conditional
 * form `has_weapon (visited): true`. Only the shape matters here, never the value.
 */
export const VARS_LINE_RE =
	/^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:\([^)]*\))?\s*:/;

export function isVarsSeparator(line: string): boolean {
	return VARS_SEPARATOR_RE.test(line);
}

export function looksLikeVarsLine(line: string): boolean {
	return VARS_LINE_RE.test(line);
}

/** The variable a vars line names, or undefined when the line is not one. */
export function varsLineName(line: string): string | undefined {
	return VARS_LINE_RE.exec(line)?.[1];
}

/**
 * Every line of `text` reads as a vars line, and there is at least one.
 *
 * Used to tell a swallowed vars section from ordinary prose, so a near miss can be reported
 * instead of vanishing. Blank lines are ignored, the way Chapbook's own parser ignores them.
 */
export function looksLikeVarsSection(text: string): boolean {
	const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');

	return lines.length > 0 && lines.every(looksLikeVarsLine);
}

export interface NearMissSeparator {
	/** 1-indexed, like a `SceneError`. */
	line: number;
	/** The line exactly as written, so a caller can replace it or quote it back. */
	text: string;
}

/**
 * The first line that was meant to close a vars section but does not.
 *
 * Only reported when the lines above it are vars-shaped: a lone `---` under prose is a
 * horizontal rule and always was, and warning about it would be wrong in every Chapbook
 * story ever written. A real separator earlier in the passage ends the search — the vars
 * section closed properly, and a `---` in the body below is just an hr.
 */
export function nearMissSeparator(text: string): NearMissSeparator | undefined {
	const lines = text.split(/\r?\n/);

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];

		if (isVarsSeparator(line)) {
			return undefined;
		}

		if (!VARS_NEAR_MISS_RE.test(line)) {
			// Anything that is not a vars line means the passage opens with prose, so it has
			// no vars section and nothing below can be a separator for one.
			if (line.trim() !== '' && !looksLikeVarsLine(line)) {
				return undefined;
			}

			continue;
		}

		return looksLikeVarsSection(lines.slice(0, index).join('\n'))
			? {line: index + 1, text: line}
			: undefined;
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Runtime truth: what the player actually reads.
// ---------------------------------------------------------------------------

/** A passage split at its vars separator. */
export interface SplitVarsSection {
	/** Everything above the separator, separator excluded. */
	vars: string;
	/** Everything below it. */
	body: string;
}

/**
 * Split a passage into its vars section and its body, or undefined when it has none.
 *
 * The obvious spelling, `text.split(sep, 2)`, is a data-loss bug and shipped as one: the
 * limit does not stop the split, it runs the FULL split and then throws away every piece
 * past the second. So a passage whose PROSE contains a bare `--` line lost everything
 * below it, in the player as well as the editor. The vars half was never the problem —
 * the split point does not move — so nothing an author wrote can depend on the loss, and
 * repairing it can only make text reappear.
 *
 * Hence `exec` + `slice`: find the FIRST separator, keep the remainder whole.
 */
export function splitVarsSection(text: string): SplitVarsSection | undefined {
	return splitVarsSectionAt(text, VARS_SEPARATOR_SPLIT_RE);
}

/**
 * `splitVarsSection` with the separator passed in, for the player's parser.
 *
 * `parse()` takes its separator through an options object, so it cannot call the plain
 * version — and it held the second copy of the `split(sep, 2)` bug above. One
 * implementation, so there is no second copy to forget again.
 */
export function splitVarsSectionAt(
	text: string,
	separator: RegExp
): SplitVarsSection | undefined {
	// A fresh regexp, never the caller's: `exec` on a /g/ pattern carries `lastIndex`
	// between calls, and a separator handed in from module scope is shared state.
	const match = new RegExp(
		separator.source,
		separator.flags.replace('g', '')
	).exec(text);

	if (!match) {
		return undefined;
	}

	return {
		body: text.slice(match.index + match[0].length),
		vars: text.slice(0, match.index)
	};
}

/** One `name: value` line, as the runtime reads it. */
export interface VarsDeclaration {
	/** 1-indexed line WITHIN the vars text — which, since vars open a passage, is also the
	    passage line. */
	line: number;
	/** The variable, with any `(condition)` removed. */
	name: string;
	/** The guard as written, parentheses included, or undefined. */
	condition?: string;
	/** The value, verbatim. NEVER interpreted here — that is the consumer's job. */
	value: string;
	/** The line exactly as written, so a caller can quote or replace it. */
	text: string;
}

/** A non-blank line the runtime could make nothing of. */
export interface VarsIgnoredLine {
	line: number;
	text: string;
	reason: 'no-colon' | 'no-name';
}

export interface VarsScan {
	declarations: VarsDeclaration[];
	/**
	 * Lines the player drops on the floor. Returned rather than swallowed because the
	 * runtime only `warn`s about them into a console nobody is watching, and a dropped
	 * variable is exactly the kind of failure that looks like the feature never worked.
	 */
	ignored: VarsIgnoredLine[];
}

/**
 * Where the player looks for a `(condition)`: anywhere inside the name, greedily.
 *
 * Copied from the runtime rather than tightened. `/\(.+\)/` also matches `a (b) (c)` as one
 * span, which is odd but is what stories in the wild were written against.
 */
const VARS_CONDITION_RE = /\(.+\)/;

/**
 * Read a vars section the way the player does.
 *
 * Faithful to `format/src/runtime/template/parse.ts` on purpose, quirks included: the split
 * is on the FIRST colon, so a value may contain as many more as it likes; the name is
 * whatever precedes it, identifier-shaped or not; a line with no colon is ignored.
 *
 * One deliberate divergence, and only because the alternative is a crash: a name that is
 * ENTIRELY a condition (`(visited): x`) made the runtime throw, because it guarded with
 * `if (!condMatch.index)` and index 0 is falsy. Here it is reported as `no-name` and the
 * caller skips it, which is what the neighbouring colonless case already did.
 */
export function scanVarsLines(varsText: string): VarsScan {
	const declarations: VarsDeclaration[] = [];
	const ignored: VarsIgnoredLine[] = [];

	varsText.split(/\r?\n/).forEach((text, index) => {
		if (text.trim() === '') {
			return;
		}

		const line = index + 1;
		const colon = text.indexOf(':');

		if (colon === -1) {
			ignored.push({line, reason: 'no-colon', text});
			return;
		}

		const declared = text.substring(0, colon).trim();
		const value = text.substring(colon + 1).trim();
		const match = VARS_CONDITION_RE.exec(declared);

		if (!match) {
			declarations.push({line, name: declared, text, value});
			return;
		}

		const name = declared.substring(0, match.index).trim();

		if (name === '') {
			ignored.push({line, reason: 'no-name', text});
			return;
		}

		declarations.push({condition: match[0], line, name, text, value});
	});

	return {declarations, ignored};
}

// ---------------------------------------------------------------------------
// The source the runtime compiles. One spelling, so a checker cannot disagree.
// ---------------------------------------------------------------------------

/** The function body the player compiles for a value. */
export function varsValueSource(value: string): string {
	return `return (${value})`;
}

/** The function body the player compiles for a `(condition)`. */
export function varsConditionSource(condition: string): string {
	return `return !!(${condition})`;
}

/**
 * Why this value would not compile, or undefined when it is fine.
 *
 * The player compiles every value EAGERLY, as the passage is parsed — so one unquoted
 * multi-word value (`name: Take The Key`) throws before a single beat renders, the error
 * boundary catches it, and the reader is left looking at the previous passage with no idea
 * why. This is the check that makes that visible before it ships.
 *
 * Compiling is not running: `new Function` parses the body and hands back a closure nobody
 * calls. Nothing in the author's text executes here.
 */
export function varsValueError(value: string): string | undefined {
	try {
		// eslint-disable-next-line no-new-func
		new Function(varsValueSource(value));
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

/** The same question for a `(condition)` guard. */
export function varsConditionError(condition: string): string | undefined {
	try {
		// eslint-disable-next-line no-new-func
		new Function(varsConditionSource(condition));
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

/**
 * A value that is plainly a phrase somebody forgot to quote: words and ordinary sentence
 * punctuation, at least one space, and nothing that could open an expression.
 *
 * Deliberately narrow. It gates the Fix button only — the WARNING fires for every value the
 * player cannot compile, whatever it looks like.
 */
const PROSE_VALUE_RE = /^[A-Za-z0-9_.,!?'\u2019-]+(?: [A-Za-z0-9_.,!?'\u2019-]+)+$/;

/**
 * A vars line whose value the player cannot compile.
 *
 * Chapbook compiles EVERY value as the passage is parsed, before a word of it renders —
 * `new Function('return (' + value + ')')`. So one unquoted multi-word value takes the whole
 * passage down, the player's error boundary catches it, and the reader is left looking at
 * the previous passage with "an unexpected error has occurred" and nothing else. This is
 * the check that turns that into a squiggle.
 *
 * It asks the question with `varsValueError`, which builds the same source text the runtime
 * builds — so a value this accepts cannot be a value the player refuses.
 *
 * An ERROR, not a warning: unlike a near-miss separator, there is no reading of this where
 * the story still plays.
 *
 * Absolute lines: this reads the whole passage, so a caller with a block offset must not
 * add one.
 */
export function varsValueErrors(text: string): SceneError[] {
	const split = splitVarsSection(text);

	if (!split) {
		return [];
	}

	const out: SceneError[] = [];

	for (const declaration of scanVarsLines(split.vars).declarations) {
		const problem = varsValueError(declaration.value);

		if (!problem) {
			continue;
		}

		// Where the VALUE starts, not where the colon is: a line may space it out, and a fix
		// that spliced from the colon would eat the gap and write `name:"..."`.
		const start = declaration.text.indexOf(
			declaration.value,
			declaration.text.indexOf(':') + 1
		);
		const col = start + 1;
		const quoted = JSON.stringify(declaration.value);
		// Offered only for the case it is actually right for: a plain unquoted phrase. A
		// half-written expression (`b: [1,`) would also "compile" once quoted, and turning
		// a broken array into the string "[1," is a worse answer than no button at all.
		const fix: SceneFix | undefined = PROSE_VALUE_RE.test(declaration.value)
			? {
					col,
					endCol: declaration.text.length + 1,
					endLine: declaration.line,
					label: `Quote it as ${quoted}`,
					line: declaration.line,
					replaces: declaration.text.slice(start),
					text: quoted
				}
			: undefined;

		out.push({
			code: 'vars-value',
			col,
			endCol: declaration.text.length + 1,
			endLine: declaration.line,
			...(fix ? {fix} : {}),
			hint:
				declaration.value === ''
					? `'${declaration.name}' is set to nothing. Give it a value, or take the line out.`
					: `Values are JavaScript expressions, so text has to be quoted: '${declaration.name}: "${declaration.value}"'.`,
			line: declaration.line,
			message: `'${declaration.name}' has a value the player cannot read: ${problem}`,
			severity: 'error'
		});
	}

	return out;
}
