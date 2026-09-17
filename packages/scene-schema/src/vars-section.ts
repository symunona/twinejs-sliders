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
