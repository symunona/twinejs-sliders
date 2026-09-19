/**
 * How a link target finds its passage.
 *
 * ONE rule, in the one place the player, the editor and the CLI can all import, because a
 * link that resolves in one of them and not the others is the worst kind of bug: the story
 * map draws an arrow, the lint says nothing, and the reader gets an error screen. That is
 * exactly what `Back: Start` against a passage called `start` used to do — Chapbook's
 * `go()` throws on an unknown name, and the throw reaches `window.onerror`.
 *
 * The rule: an exact match always wins; otherwise the target matches a passage whose name
 * differs only in case (and in surrounding whitespace). Nothing else is folded — accents,
 * punctuation and inner spacing are part of the name.
 *
 * Case is the ONLY looseness on purpose. It is the mistake authors actually make, because
 * a passage name is prose (`Start`) and a YAML value is typed in a hurry (`start`), and
 * both spellings name the same room in the author's head. Matching on anything fuzzier
 * would start guessing which room they meant.
 */

/** The form two passage names are compared in: trimmed, case-folded. */
export function foldPassageName(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * The real passage name a link target resolves to, or `undefined` when nothing matches.
 *
 * Returns the NAME rather than a boolean so every caller can report, draw or navigate to
 * the passage that actually exists — the story map needs the real card, the player needs
 * the real passage, and a warning needs to be able to say which spelling won.
 *
 * Ambiguity (`Start` and `START`, target `start`) resolves to the first in iteration
 * order, which for a story is passage order. Deterministic rather than clever: a story
 * with two names one case apart has a problem no resolver can solve for it, and the lint
 * says so.
 */
export function matchPassageName(
	names: Iterable<string>,
	target: string
): string | undefined {
	const folded = foldPassageName(target);
	let loose: string | undefined;

	for (const name of names) {
		if (name === target) {
			return name;
		}

		if (loose === undefined && foldPassageName(name) === folded) {
			loose = name;
		}
	}

	return loose;
}

/**
 * True when the target only found its passage by case — i.e. it works, but it is not what
 * the passage is called.
 *
 * The editor squiggles this as a warning with a one-click fix and the CLI lints it. The
 * player does not care: it has already navigated.
 */
export function isCaseOnlyMatch(matched: string, target: string): boolean {
	return (
		matched !== target && foldPassageName(matched) === foldPassageName(target)
	);
}
