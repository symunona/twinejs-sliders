/**
 * Inline markup in beat text: `*bold*`, `**bold**`, `_italic_`, `==highlight==`,
 * `~strike~`, `~~strike~~`.
 *
 * Chat spelling, not CommonMark: a single `*` is BOLD. A bubble is one inline run, so there
 * are no blocks, headings, lists, code or markdown links — `[[links]]` stay the only links.
 *
 * Output is a tree the dialogue layer turns into DOM nodes itself. Never an HTML string:
 * beat text must not be able to inject markup (D3).
 *
 * The flanking rule keeps ordinary text ordinary. A mark opens only after the start of the
 * text, a space or punctuation, and before something that is not a space. It closes only
 * after a non-space and before the end, a space or punctuation. So `snake_case`, `2*3*4`,
 * `a==b` and `x == y` all stay as written. An unclosed mark is just its characters.
 * `\*` `\_` `\=` `\~` `\\` spell the character itself.
 */

import type {LinkToken} from './dialogue';

export type MarkKind = 'strong' | 'em' | 'mark' | 's';

export type MarkupNode =
	| LinkToken
	| {kind: MarkKind; children: MarkupNode[]};

/** Longest first: `**` must win over `*`, `~~` over `~`. */
const DELIMITERS: [string, MarkKind][] = [
	['**', 'strong'],
	['==', 'mark'],
	['~~', 's'],
	['*', 'strong'],
	['_', 'em'],
	['~', 's']
];

const ESCAPABLE = new Set(['*', '_', '=', '~', '\\']);

/** A link stands in as a letter: it can sit inside a mark and next to one. */
type Unit = string | LinkToken;

interface Opener {
	delim: string;
	kind: MarkKind;
	/** Index of the opener's own text node in `out`. */
	at: number;
}

export function parseMarkup(tokens: LinkToken[]): MarkupNode[] {
	const units: Unit[] = [];

	for (const token of tokens) {
		if (token.kind === 'text') {
			units.push(...Array.from(token.value));
		} else {
			units.push(token);
		}
	}

	const out: MarkupNode[] = [];
	const stack: Opener[] = [];
	let i = 0;

	const text = (value: string) => out.push({kind: 'text', value});

	while (i < units.length) {
		const unit = units[i];

		if (typeof unit !== 'string') {
			out.push(unit);
			i++;
			continue;
		}

		if (unit === '\\' && ESCAPABLE.has(units[i + 1] as string)) {
			text(units[i + 1] as string);
			i += 2;
			continue;
		}

		const match = DELIMITERS.find(([delim]) => startsAt(units, i, delim));

		if (!match) {
			text(unit);
			i++;
			continue;
		}

		const [delim, kind] = match;
		const before = units[i - 1];
		const after = units[i + delim.length];
		const canOpen = isBoundary(before) && after !== undefined && !isSpace(after);
		const canClose = before !== undefined && !isSpace(before) && isBoundary(after);
		const opener = canClose ? findOpener(stack, delim) : -1;

		// An opener with nothing after it yet cannot close: `****` stays four stars.
		if (opener >= 0 && out.length > stack[opener].at + 1) {
			const {at} = stack[opener];
			const children = mergeText(out.splice(at + 1));

			out.pop();
			out.push({kind, children});
			stack.length = opener;
		} else {
			if (canOpen) {
				stack.push({delim, kind, at: out.length});
			}

			text(delim);
		}

		i += delim.length;
	}

	return mergeText(out);
}

function startsAt(units: Unit[], i: number, delim: string): boolean {
	for (let k = 0; k < delim.length; k++) {
		if (units[i + k] !== delim[k]) {
			return false;
		}
	}

	return true;
}

function findOpener(stack: Opener[], delim: string): number {
	for (let k = stack.length - 1; k >= 0; k--) {
		if (stack[k].delim === delim) {
			return k;
		}
	}

	return -1;
}

function isSpace(unit: Unit): boolean {
	return typeof unit === 'string' && /\s/u.test(unit);
}

/** Start or end of the text, a space, or punctuation. A link is a letter. */
function isBoundary(unit: Unit | undefined): boolean {
	return unit === undefined || (typeof unit === 'string' && /[\s\p{P}\p{S}]/u.test(unit));
}

function mergeText(nodes: MarkupNode[]): MarkupNode[] {
	const merged: MarkupNode[] = [];

	for (const node of nodes) {
		const last = merged[merged.length - 1];

		if (node.kind === 'text' && last?.kind === 'text') {
			merged[merged.length - 1] = {kind: 'text', value: last.value + node.value};
		} else {
			merged.push(node);
		}
	}

	return merged;
}
