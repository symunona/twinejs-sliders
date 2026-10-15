/**
 * Ctrl+B / Ctrl+I in the beat panel's text box: toggle a mark around the selection.
 *
 * The marks are beat text's own (`packages/render-dom/src/markup.ts`): `**bold**` and
 * `_italic_`. A single `*` is bold there too, so an existing `*word*` counts as bold and
 * unwraps.
 *
 * No selection means the word under the caret; no word there inserts an empty pair with the
 * caret between. Edge spaces are left outside the mark: the flanking rule will not open a
 * mark before a space or close one after it, so `** word**` would render as written.
 */

export type MarkupToggle = 'bold' | 'italic';

export interface TextEdit {
	text: string;
	start: number;
	end: number;
}

/** Longest first, so `**` is found before `*`. The first one is what wrapping writes. */
const DELIMITERS: Record<MarkupToggle, string[]> = {
	bold: ['**', '*'],
	italic: ['_']
};

function isSpace(char: string | undefined): boolean {
	return char === undefined || /\s/.test(char);
}

/** The run of non-space characters around the caret, minus any marks already on it. */
function wordAt(text: string, at: number): [number, number] {
	let start = at;
	let end = at;

	while (start > 0 && !isSpace(text[start - 1])) {
		start--;
	}

	while (end < text.length && !isSpace(text[end])) {
		end++;
	}

	return [start, end];
}

export function toggleMarkup(
	text: string,
	selStart: number,
	selEnd: number,
	mark: MarkupToggle
): TextEdit {
	let start = Math.min(selStart, selEnd);
	let end = Math.max(selStart, selEnd);

	if (start === end) {
		[start, end] = wordAt(text, start);
	}

	while (start < end && isSpace(text[start])) {
		start++;
	}

	while (end > start && isSpace(text[end - 1])) {
		end--;
	}

	for (const delim of DELIMITERS[mark]) {
		const n = delim.length;
		const inner = text.slice(start, end);

		// Marks inside the range: `**word**` selected whole, or the caret's own word.
		if (
			inner.length > 2 * n &&
			inner.startsWith(delim) &&
			inner.endsWith(delim)
		) {
			return {
				text: text.slice(0, start) + inner.slice(n, -n) + text.slice(end),
				start,
				end: end - 2 * n
			};
		}

		// Marks just outside it: the word inside `**word**` selected.
		if (
			start >= n &&
			start < end &&
			text.slice(start - n, start) === delim &&
			text.slice(end, end + n) === delim
		) {
			return {
				text: text.slice(0, start - n) + inner + text.slice(end + n),
				start: start - n,
				end: end - n
			};
		}
	}

	const delim = DELIMITERS[mark][0];
	const n = delim.length;

	return {
		text:
			text.slice(0, start) +
			delim +
			text.slice(start, end) +
			delim +
			text.slice(end),
		start: start + n,
		end: end + n
	};
}
