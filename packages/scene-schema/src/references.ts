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
 * Map of link name -> target, harvested from any `links:` block in the text.
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
 */
export function sceneLinkTargets(text: string): Map<string, string> {
	const out = new Map<string, string>();
	const lines = text.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const header = LINKS_LINE_RE.exec(lines[i]);

		if (!header) {
			continue;
		}

		const blockIndent = header[1].length;
		const inline = header[2].trim();

		if (inline.startsWith('{')) {
			// links: {stay: {to: X}, go: {to: Y}} — one regex pass over the whole flow map.
			const entryRe = /([A-Za-z0-9_][\w .-]*)\s*:\s*(\{[^{}]*\}|[^,{}]*)/g;
			let match: RegExpExecArray | null;

			while ((match = entryRe.exec(inline)) !== null) {
				const name = match[1].trim();
				const value = match[2].trim();

				if (name === 'to') {
					continue;
				}

				if (value.startsWith('{')) {
					const to = TO_IN_FLOW_RE.exec(value);

					if (to) {
						out.set(name, unquote(to[1]));
					}
				} else if (value !== '') {
					out.set(name, unquote(value));
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
			const rest = entry[3].trim();

			if (rest.startsWith('{')) {
				const to = TO_IN_FLOW_RE.exec(rest);

				if (to) {
					out.set(name, unquote(to[1]));
				}
			} else if (rest !== '') {
				out.set(name, unquote(rest));
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
						out.set(name, unquote(nested[3]));
						break;
					}
				}
			}
		}
	}

	return out;
}

/**
 * Older name for {@link sceneLinkTargets}, kept because twine-cli's `map` and `lint`
 * import it. Same function, not a copy — the point of this file.
 */
export const scanLinkTargets = sceneLinkTargets;

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
