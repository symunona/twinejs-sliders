import {placeLabels} from '../beat-label-layout';

function layout(
	anchors: number[],
	widths: number[],
	stripWidth = 400,
	current = 0,
	maxRows?: number
) {
	return placeLabels({anchors, current, maxRows, stripWidth, widths});
}

/** Row a state landed on, or undefined when it was dropped. */
function rowOf(result: ReturnType<typeof layout>, state: number) {
	return result.boxes.find(box => box.state === state)?.row;
}

function boxOf(result: ReturnType<typeof layout>, state: number) {
	return result.boxes.find(box => box.state === state);
}

describe('placeLabels()', () => {
	it('centres a label on its dot when nothing is in the way', () => {
		const result = layout([100, 300], [40, 40]);

		expect(boxOf(result, 0)).toMatchObject({left: 80, row: 0, width: 40});
		expect(boxOf(result, 1)).toMatchObject({left: 280, row: 0});
		expect(result.rows).toBe(1);
		expect(result.hidden).toEqual([]);
	});

	// First and last label used to hang off the ends of the strip.
	it('keeps a label inside the strip', () => {
		const result = layout([2, 398], [40, 40]);

		expect(boxOf(result, 0)!.left).toBe(0);
		expect(boxOf(result, 1)!.left).toBe(360);
	});

	// The point of the slide: an elbow is cheaper to read than a whole row.
	it('slides sideways before it drops a row', () => {
		// Dots 35px apart, labels 40px wide: centred they overlap, but the second can shuffle
		// clear of the first while still covering its own dot.
		const result = layout([100, 135], [40, 40]);

		expect(rowOf(result, 0)).toBe(0);
		expect(rowOf(result, 1)).toBe(0);
		expect(boxOf(result, 0)!.left + 40).toBeLessThanOrEqual(
			boxOf(result, 1)!.left
		);
		expect(result.rows).toBe(1);
	});

	// A slide that leaves the label no longer covering its own dot is not a slide.
	it('drops a row when sliding cannot clear the collision', () => {
		const result = layout([100, 104, 108], [60, 60, 60]);

		expect(new Set([0, 1, 2].map(state => rowOf(result, state))).size).toBe(3);
		expect(result.rows).toBe(3);
	});

	// The whole reason placement is priority-ordered rather than left to right.
	it('always puts the current beat on the top row', () => {
		const result = layout([100, 104, 108], [60, 60, 60], 400, 2);

		expect(rowOf(result, 2)).toBe(0);
	});

	it('drops what does not fit rather than stacking rows forever', () => {
		const result = layout([100, 104, 108, 112], [60, 60, 60, 60], 400, 0, 2);

		expect(result.rows).toBe(2);
		expect(result.boxes).toHaveLength(2);
		expect(result.hidden).toEqual([2, 3]);
	});

	// A dropped label for the only beat on screen would be worse than a squeezed one.
	it('squeezes a label wider than the strip instead of dropping it', () => {
		const result = layout([50, 250], [500, 40], 100);

		expect(boxOf(result, 0)).toMatchObject({left: 0, width: 100});
	});

	it('leaves a zero-width label out entirely', () => {
		const result = layout([100, 300], [0, 40]);

		expect(boxOf(result, 0)).toBeUndefined();
		expect(result.hidden).toEqual([]);
	});

	it('reports boxes in state order whatever order it placed them', () => {
		const result = layout([100, 104, 108], [60, 60, 60], 400, 2);

		expect(result.boxes.map(box => box.state)).toEqual([0, 1, 2]);
	});
});
