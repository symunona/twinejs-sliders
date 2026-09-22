/**
 * Reference extraction for Twine's story map (spec 05, "Reference parsing").
 *
 * This runs over RAW passage text with no YAML parse at all — it feeds the map, not the
 * runtime, so a cheap regex is both fine and correct. It must survive half-typed scenes.
 *
 * Twine asks a format for the passages a passage points at, and answers with arrows.
 * Chapbook's own answer only knows `{link to: …}` and `[[wiki links]]`; a scene's choices
 * live under `links:` instead, so without this a scene-driven story draws as a field of
 * unconnected cards. The format's CodeMirror extensions read `sceneLinkTargets` from here
 * (`format/src/twine-extensions/parse-references.ts`) so the map, the CLI and the editor
 * lint all agree about what a `links:` block says.
 *
 * Deliberately a line scanner and not `parseScene`: it runs on every passage on every
 * keystroke, it must survive a half-typed block, and it only ever needs the `to:` of each
 * entry.
 */

import {scanWikiLinks} from './links';

/** `links:` at any indent, capturing whatever follows on the same line. */
const LINKS_LINE_RE = /^(\s*)links\s*:\s*(.*)$/;

/** `key: value` on one line, capturing indent, key and value. */
const ENTRY_LINE_RE = /^(\s*)([^\s:#][^:]*?)\s*:\s*(.*)$/;

/** `to:` inside a flow map — `{to: Somewhere, if: x}`. */
const TO_IN_FLOW_RE = /(?:^|[{,])\s*to\s*:\s*([^,}]*)/;

/**
 * An entity's `link:`, at the start of a line or inside a flow map.
 *
 * The value runs to the end of the line or to the next `,`/`}` — except for the `{…}` map
 * form, which is taken whole so its own `to:` can be read out of it. `\blink` would also
 * match the `s` of `links:`, hence the explicit word boundary on the other side.
 */
const LINK_KEY_RE = /(?:^[ \t]*|[{,][ \t]*)link[ \t]*:[ \t]*(\{[^{}]*\}|[^,}\n]*)/gm;

function indentOf(line: string): number {
	const match = /^[ \t]*/.exec(line);

	return match ? match[0].length : 0;
}

function unquote(raw: string): string {
	const value = raw.trim().replace(/\s*(?:#.*)?$/, '').trim();

	if (value.length >= 2) {
		const first = value[0];

		if ((first === '"' || first === "'") && value[value.length - 1] === first) {
			return value.slice(1, -1);
		}
	}

	return value;
}

/**
 * Where {@link unquote}'s answer sits inside the raw text it was cut from.
 *
 * Derived from `unquote` itself rather than re-deriving the trimming, so the value and
 * the offsets an editor highlights cannot drift apart. `base` is where `raw` starts in
 * the scanned text.
 */
function unquoteSpan(
	base: number,
	raw: string
): {end: number; start: number; target: string} {
	const target = unquote(raw);
	const start = base + Math.max(0, raw.indexOf(target));

	return {end: start + target.length, start, target};
}

/** One `links:` entry's target, and where it was written. */
export interface SceneLinkSpan {
	/** Offset just past the target text. */
	end: number;
	/** The entry name, e.g. `stay`. */
	name: string;
	/** Offset of the target text within the scanned string. */
	start: number;
	/** The target, unquoted and stripped of any trailing comment. */
	target: string;
}

/**
 * Every `links:` target in the text, in the order written, with its offsets.
 *
 * Every spelling that is legal (spec 02) is read:
 *
 * ```yaml
 * links:
 *   back: Other Passage                              # scalar shorthand
 *   onward: {to: Next Passage, if: has_weapon}        # flow entry
 *   away:                                            # block entry
 *     to: Somewhere Else
 * ```
 *
 * …and the whole block written inline, `links: {onward: {to: X}, back: Y}`. Quotes and
 * trailing `#` comments are stripped from the target.
 *
 * The offsets exist so the passage editor can make a target ctrl-clickable. Everything
 * that only wants the mapping calls {@link sceneLinkTargets}, which is built from this —
 * one scanner, so a link the map draws is a link the author can follow.
 */
export function sceneLinkTargetSpans(text: string): SceneLinkSpan[] {
	const out: SceneLinkSpan[] = [];
	const lines = text.split('\n');
	// Offset of each line's first character. `split` ate one '\n' per line.
	const lineStarts: number[] = [];

	for (let at = 0, i = 0; i < lines.length; i++) {
		lineStarts.push(at);
		at += lines[i].length + 1;
	}

	for (let i = 0; i < lines.length; i++) {
		const header = LINKS_LINE_RE.exec(lines[i]);

		if (!header) {
			continue;
		}

		const blockIndent = header[1].length;
		// `(.*)$` — the capture is the tail of the line, so its offset follows from
		// the two lengths. Same trick every group below relies on.
		const inlineBase = lineStarts[i] + lines[i].length - header[2].length;
		const inline = header[2].trim();

		if (inline.startsWith('{')) {
			// links: {stay: {to: X}, go: {to: Y}} — one regex pass over the whole flow map.
			const entryRe = /([A-Za-z0-9_][\w .-]*)\s*:\s*(\{[^{}]*\}|[^,{}]*)/g;
			let match: RegExpExecArray | null;

			while ((match = entryRe.exec(header[2])) !== null) {
				const name = match[1].trim();
				const raw = match[2];
				const rawBase = inlineBase + match.index + match[0].length - raw.length;
				const value = raw.trim();

				if (name === 'to') {
					continue;
				}

				if (value.startsWith('{')) {
					const to = TO_IN_FLOW_RE.exec(raw);

					if (to) {
						const span = unquoteSpan(
							rawBase + to.index + to[0].length - to[1].length,
							to[1]
						);

						out.push({...span, name});
					}
				} else if (value !== '') {
					out.push({...unquoteSpan(rawBase, raw), name});
				}
			}

			continue;
		}

		// Block form: consume every line indented deeper than `links:`.
		let entryIndent = -1;

		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j];

			if (line.trim() === '') {
				continue;
			}

			const indent = indentOf(line);

			if (indent <= blockIndent) {
				break;
			}

			if (entryIndent === -1) {
				entryIndent = indent;
			}

			if (indent !== entryIndent) {
				continue; // A nested `to:` line; picked up by its own entry below.
			}

			const entry = ENTRY_LINE_RE.exec(line);

			if (!entry) {
				continue;
			}

			const name = entry[2].trim();
			const restBase = lineStarts[j] + line.length - entry[3].length;
			const rest = entry[3].trim();

			if (rest.startsWith('{')) {
				const to = TO_IN_FLOW_RE.exec(entry[3]);

				if (to) {
					const span = unquoteSpan(
						restBase + to.index + to[0].length - to[1].length,
						to[1]
					);

					out.push({...span, name});
				}
			} else if (rest !== '') {
				out.push({...unquoteSpan(restBase, entry[3]), name});
			} else {
				// Nested block: look for a deeper `to:` before the next sibling entry.
				for (let k = j + 1; k < lines.length; k++) {
					if (lines[k].trim() === '') {
						continue;
					}

					if (indentOf(lines[k]) <= entryIndent) {
						break;
					}

					const nested = ENTRY_LINE_RE.exec(lines[k]);

					if (nested && nested[2].trim() === 'to') {
						const base = lineStarts[k] + lines[k].length - nested[3].length;

						out.push({...unquoteSpan(base, nested[3]), name});
						break;
					}
				}
			}
		}
	}

	return out;
}

/**
 * Map of link name -> target, harvested from any `links:` block in the text. See
 * {@link sceneLinkTargetSpans} for the forms it reads.
 *
 * Two entries with the same name collapse to the last one written, which is what the YAML
 * parser does with a duplicate key.
 */
export function sceneLinkTargets(text: string): Map<string, string> {
	const out = new Map<string, string>();

	for (const span of sceneLinkTargetSpans(text)) {
		out.set(span.name, span.target);
	}

	return out;
}

/**
 * Older name for {@link sceneLinkTargets}, kept because twine-cli's `map` and `lint`
 * import it. Same function, not a copy — the point of this file.
 */
export const scanLinkTargets = sceneLinkTargets;

/** One entity `link:` value, and where it was written. */
export interface SceneEntityLinkSpan {
	/** Offset just past the value. */
	end: number;
	/** Offset of the value within the scanned string. */
	start: number;
	/**
	 * The value as written: a passage name, or the name of a `links:` entry. Resolving
	 * which is the caller's job — {@link sceneEntityLinkTargets} drops the latter, the
	 * passage editor follows it.
	 */
	value: string;
}

/**
 * `link:` on an entity, wherever it appears — `props: {door: {link: Cellar}}`, a block
 * entry, or a beat that repoints it.
 *
 * A second scanner rather than a branch inside {@link sceneLinkTargetSpans}, because the
 * two answer different questions: that one is a NAME -> target map for `[[wiki]]` text to
 * resolve against, and an entity link has no name to be looked up by. Same line-scanner
 * discipline though — this runs on every passage on every keystroke and must survive a
 * half-typed scene.
 */
export function sceneEntityLinkSpans(text: string): SceneEntityLinkSpan[] {
	if (!text.includes('link')) {
		return [];
	}

	const out: SceneEntityLinkSpan[] = [];

	let match: RegExpExecArray | null;

	LINK_KEY_RE.lastIndex = 0;

	while ((match = LINK_KEY_RE.exec(text)) !== null) {
		const raw = match[1];
		const rawBase = match.index + match[0].length - raw.length;
		// `link: {to: Cellar, if: has_key}` — the map form states its target inside.
		const inner = raw.trim().startsWith('{') ? TO_IN_FLOW_RE.exec(raw) : null;
		const span = inner
			? unquoteSpan(
					rawBase + inner.index + inner[0].length - inner[1].length,
					inner[1]
			  )
			: unquoteSpan(rawBase, raw);

		// `~` is "no longer clickable", and an empty value is a half-typed line.
		if (span.target === '' || span.target === '~' || span.target === 'null') {
			continue;
		}

		out.push({end: span.end, start: span.start, value: span.target});
	}

	return out;
}

/**
 * The passages an entity `link:` points at, deduped.
 *
 * A value that names a `links:` entry is NOT returned: that entry's own target is already
 * in the other map, and returning both would draw the same arrow twice.
 */
export function sceneEntityLinkTargets(text: string): string[] {
	const named = sceneLinkTargets(text);
	const seen = new Set<string>();
	const out: string[] = [];

	for (const {value} of sceneEntityLinkSpans(text)) {
		if (named.has(value) || seen.has(value)) {
			continue;
		}

		seen.add(value);
		out.push(value);
	}

	return out;
}

/**
 * Every passage this passage links to, in order of first appearance, deduped.
 *
 * Handles both authored forms:
 *   `[[stay -> Tavern Fight]]`                     -> `Tavern Fight`
 *   `[[stay]]` + `links: {stay: {to: Street}}`     -> `Street`
 */
export function parsePassageReferences(text: string): string[] {
	if (!text.includes('[[')) {
		return [];
	}

	const targets = sceneLinkTargets(text);
	const seen = new Set<string>();
	const out: string[] = [];

	for (const link of scanWikiLinks(text)) {
		const target = link.target ?? targets.get(link.name);

		if (target === undefined || target === '') {
			continue;
		}

		if (!seen.has(target)) {
			seen.add(target);
			out.push(target);
		}
	}

	return out;
}
