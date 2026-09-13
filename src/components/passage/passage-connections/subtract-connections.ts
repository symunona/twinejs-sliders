import {Passage} from '../../../store/stories';

/**
 * Every pair in `connections` that none of `others` already holds.
 *
 * The map draws two passes: links, solid, and the story format's references, dashed.
 * Since core reads a scene's `links:` block as real links, the two passes overlap — the
 * Sliders format's `parsePassageText` reports scene links alongside its `{link to:}` and
 * `{embed passage:}` references. Both arrows have identical geometry, so the dashed one
 * lands exactly on top of the solid one and only shows up as a slightly wrong-looking
 * line. Subtracting here keeps a pair drawn once, as the strongest kind it qualifies for.
 *
 * `others` is a list because the link pass is itself split into draggable and fixed by
 * selection: a pair sits in only one of them, and which one is not this function's
 * business.
 */
export function subtractConnections(
	connections: Map<Passage, Set<Passage>>,
	others: Map<Passage, Set<Passage>>[]
): Map<Passage, Set<Passage>> {
	const result = new Map<Passage, Set<Passage>>();

	for (const [start, ends] of connections) {
		const remaining = new Set(ends);

		for (const other of others) {
			for (const end of other.get(start) ?? []) {
				remaining.delete(end);
			}
		}

		if (remaining.size > 0) {
			result.set(start, remaining);
		}
	}

	return result;
}
