/**
 * Where each beat's label goes under the timeline strip.
 *
 * The strip's markers sit at the times the scene plays at, so they bunch up wherever the
 * beats do — which is exactly where their labels collide. The naive answer (first label on
 * the top row, anything that collides drops a row) reads badly in practice: it packs
 * left to right, so the label the author is actually reading is on whatever row it happens
 * to land in, and one long name early in the scene pushes every later label down.
 *
 * Three rules instead:
 *
 * 1. PRIORITY. The beat the scrubber is on is placed first, so it is always on the top row
 *    and never dropped. Everything else follows left to right.
 * 2. SLIDE BEFORE DESCENDING. A label that collides first tries to shuffle sideways on the
 *    row it is on, as far as it can go while its own dot is still inside it. A short elbow is
 *    easier to read than a whole extra row.
 * 3. GIVE UP. Past `maxRows` a label is dropped rather than drawn somewhere useless; its
 *    marker still carries the full text in `title`, and hovering still says it.
 *
 * Pure, and pixels in / pixels out: the caller measures the DOM, this decides.
 */

/**
 * Clear space between two labels on the same row, px. Also the slide step past a neighbour.
 *
 * Generous on purpose: two labels a word apart read as one phrase ("tavish 0.2s wait 2s"),
 * which is worse than one of them taking a second row.
 */
const GUTTER = 12;

/** How far a label's centre may drift from its dot before a leader elbow is worth drawing. */
export const LEADER_SLACK = 2;

/** A label that found a home. */
export interface LabelBox {
	/** Left edge, px from the strip's left content edge. */
	left: number;
	/** 0 is the row directly under the markers. */
	row: number;
	/** Scrubber position this label belongs to. */
	state: number;
	width: number;
}

export interface LabelLayout {
	boxes: LabelBox[];
	/** States with no room at all. Their markers draw without a label. */
	hidden: number[];
	/** Rows actually used, so the strip grows only as far as it must. */
	rows: number;
}

export interface PlaceLabelsOptions {
	/** Marker centre x, one per state, px from the strip's left content edge. */
	anchors: number[];
	/** The state the scrubber is on. Placed first, so it always lands on row 0. */
	current: number;
	maxRows?: number;
	/** Usable width of the strip. */
	stripWidth: number;
	/** Natural (already capped and ellipsised) label width, one per state. */
	widths: number[];
}

interface Span {
	left: number;
	right: number;
}

export function placeLabels({
	anchors,
	current,
	maxRows = 3,
	stripWidth,
	widths
}: PlaceLabelsOptions): LabelLayout {
	const boxes: LabelBox[] = [];
	const hidden: number[] = [];
	const rows: Span[][] = [];

	for (const state of placementOrder(anchors.length, current)) {
		// A label wider than the strip is still drawn--it is ellipsised by CSS, and a
		// dropped label for the only beat on screen would be worse than a squeezed one.
		const width = Math.min(widths[state] ?? 0, stripWidth);
		const anchor = anchors[state];

		if (width <= 0 || anchor === undefined) {
			continue;
		}

		const wanted = clamp(anchor - width / 2, 0, Math.max(0, stripWidth - width));
		let placed = false;

		for (let row = 0; row < maxRows; row++) {
			if (!rows[row]) {
				rows[row] = [];
			}

			const left = findSlot(rows[row], wanted, width, anchor, stripWidth);

			if (left !== undefined) {
				rows[row].push({left, right: left + width});
				rows[row].sort((a, b) => a.left - b.left);
				boxes.push({left, row, state, width});
				placed = true;
				break;
			}
		}

		if (!placed) {
			hidden.push(state);
		}
	}

	boxes.sort((a, b) => a.state - b.state);
	hidden.sort((a, b) => a - b);

	return {
		boxes,
		hidden,
		rows: boxes.reduce((most, box) => Math.max(most, box.row + 1), 0)
	};
}

/**
 * The scrubber's own beat, then left to right.
 *
 * This is the whole reason the top row is never a lottery: the one label the author is
 * reading is placed into an empty row before anything can be in its way.
 */
function placementOrder(count: number, current: number): number[] {
	const rest = [];

	for (let state = 0; state < count; state++) {
		if (state !== current) {
			rest.push(state);
		}
	}

	return current >= 0 && current < count ? [current, ...rest] : rest;
}

/**
 * A free left edge on this row, or undefined if the row is full where this label may go.
 *
 * Tries the centred position, then shuffles to the near side of whatever is in the way.
 * The slide is bounded by the label having to keep its own dot inside it — past that the
 * label stops pointing at anything and a row below is the honest answer.
 */
function findSlot(
	taken: Span[],
	wanted: number,
	width: number,
	anchor: number,
	stripWidth: number
): number | undefined {
	const min = Math.max(0, anchor - width);
	const max = Math.min(stripWidth - width, anchor);

	if (min > max) {
		// The strip is narrower than the label; only the clamped position is possible.
		return free(taken, wanted, width) ? wanted : undefined;
	}

	const candidates = [clamp(wanted, min, max)];

	for (const span of taken) {
		candidates.push(clamp(span.right + GUTTER, min, max));
		candidates.push(clamp(span.left - GUTTER - width, min, max));
	}

	return candidates
		.filter(left => free(taken, left, width))
		.sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))[0];
}

function free(taken: Span[], left: number, width: number): boolean {
	return !taken.some(
		span => left < span.right + GUTTER && left + width > span.left - GUTTER
	);
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
