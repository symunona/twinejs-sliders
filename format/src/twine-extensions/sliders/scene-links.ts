/**
 * Pulling passage names out of a scene's `links:` block, for Twine's story map.
 *
 * Twine asks a format for the passages a passage points at, and answers it with arrows.
 * Chapbook's own answer only knows `{link to: …}` and `[[wiki links]]`; a scene's choices
 * live under `links:` instead, so without this a scene-driven story draws as a field of
 * unconnected cards.
 *
 * This is deliberately a line scanner and not `parseScene`: it runs on every passage on
 * every keystroke, it must survive a half-typed block, and it only ever needs the `to:`
 * of each entry.
 */

/** `links:` at any indent, capturing whatever follows on the same line. */
const LINKS_LINE = /^(\s*)links\s*:\s*(.*)$/;

/** `key: value` on one line, capturing indent, key and value. */
const MAP_LINE = /^(\s*)([^\s:#][^:]*?)\s*:\s*(.*)$/;

/** `to:` inside a flow map — `{to: Somewhere, if: x}`. */
const FLOW_TO = /(?:^|[{,])\s*to\s*:\s*([^,}]*)/;

/** `key: {…}` pairs inside one flow map, values either nested flow maps or scalars. */
const FLOW_PAIR = /([A-Za-z0-9_][\w .-]*)\s*:\s*(\{[^{}]*\}|[^,{}]*)/g;

function indentOf(line: string): number {
	const match = /^[ \t]*/.exec(line);

	return match ? match[0].length : 0;
}

/** Trailing comment off, surrounding quotes off. */
function scalar(value: string): string {
	const trimmed = value
		.trim()
		.replace(/\s*(?:#.*)?$/, '')
		.trim();

	if (trimmed.length >= 2) {
		const quote = trimmed[0];

		if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
			return trimmed.slice(1, -1);
		}
	}

	return trimmed;
}

/**
 * Link name -> target passage name, for every `links:` block in the text.
 *
 * Both spellings are read, because both are legal (spec 02):
 *
 * ```yaml
 * links:
 *   back: Other Passage
 *   onward: {to: Next Passage, if: has_weapon}
 * ```
 */
export function sceneLinkTargets(text: string): Map<string, string> {
	const targets = new Map<string, string>();
	const lines = text.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const header = LINKS_LINE.exec(lines[i]);

		if (!header) {
			continue;
		}

		const headerIndent = header[1].length;
		const inline = header[2].trim();

		// `links: {onward: {to: X}, back: Y}` — the whole block on the header line.

		if (inline.startsWith('{')) {
			let pair: RegExpExecArray | null;

			FLOW_PAIR.lastIndex = 0;

			while ((pair = FLOW_PAIR.exec(inline)) !== null) {
				const name = pair[1].trim();
				const value = pair[2].trim();

				// `to` here is a key of an enclosing entry we have already recorded.
				if (name === 'to') {
					continue;
				}

				if (value.startsWith('{')) {
					const to = FLOW_TO.exec(value);

					if (to) {
						targets.set(name, scalar(to[1]));
					}
				} else if (value !== '') {
					targets.set(name, scalar(value));
				}
			}

			continue;
		}

		// Block form: the entries are the lines indented under the header, at whatever
		// depth the first of them chose.

		let entryIndent = -1;

		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j];

			if (line.trim() === '') {
				continue;
			}

			const indent = indentOf(line);

			if (indent <= headerIndent) {
				break;
			}

			if (entryIndent === -1) {
				entryIndent = indent;
			}

			// Deeper than the entries themselves: keys of an entry, handled below.
			if (indent !== entryIndent) {
				continue;
			}

			const entry = MAP_LINE.exec(line);

			if (!entry) {
				continue;
			}

			const name = entry[2].trim();
			const value = entry[3].trim();

			if (value.startsWith('{')) {
				const to = FLOW_TO.exec(value);

				if (to) {
					targets.set(name, scalar(to[1]));
				}
			} else if (value !== '') {
				targets.set(name, scalar(value));
			} else {
				// `onward:` with its keys on the lines below it.
				for (let k = j + 1; k < lines.length; k++) {
					if (lines[k].trim() === '') {
						continue;
					}

					if (indentOf(lines[k]) <= entryIndent) {
						break;
					}

					const nested = MAP_LINE.exec(lines[k]);

					if (nested && nested[2].trim() === 'to') {
						targets.set(name, scalar(nested[3]));
						break;
					}
				}
			}
		}
	}

	return targets;
}
