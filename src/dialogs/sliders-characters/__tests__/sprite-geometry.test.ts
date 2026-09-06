import {containRect, fractionLimits} from '../sprite-geometry';

describe('containRect', () => {
	it('letterboxes art that is wider than its box', () => {
		expect(
			containRect({height: 100, width: 200}, {height: 400, width: 400})
		).toEqual({height: 200, left: 0, top: 100, width: 400});
	});

	it('pillarboxes art that is taller than its box', () => {
		expect(
			containRect({height: 200, width: 100}, {height: 400, width: 400})
		).toEqual({height: 400, left: 100, top: 0, width: 200});
	});

	it('fills a box art already matches', () => {
		expect(
			containRect({height: 512, width: 256}, {height: 400, width: 200})
		).toEqual({height: 400, left: 0, top: 0, width: 200});
	});

	it('has no answer before the image or the box has a size', () => {
		expect(
			containRect({height: 0, width: 0}, {height: 400, width: 400})
		).toBeUndefined();
		expect(
			containRect({height: 100, width: 100}, {height: 0, width: 0})
		).toBeUndefined();
	});
});

describe('fractionLimits', () => {
	function rect(left: number, top: number, width: number, height: number): DOMRect {
		return {
			bottom: top + height,
			height,
			left,
			right: left + width,
			top,
			width,
			x: left,
			y: top
		} as DOMRect;
	}

	it('reaches past the box to the edges of the area around it', () => {
		// A 100-wide box centred in a 300-wide area: a full box of room each side.
		expect(fractionLimits(rect(100, 0, 100, 100), rect(0, 0, 300, 100))).toEqual({
			maxX: 2,
			maxY: 1,
			minX: -1,
			minY: 0
		});
	});

	it('stops at the box when there is no room around it', () => {
		expect(fractionLimits(rect(0, 0, 100, 100), rect(0, 0, 100, 100))).toEqual({
			maxX: 1,
			maxY: 1,
			minX: 0,
			minY: 0
		});
	});

	it('falls back to the box itself before it has been laid out', () => {
		expect(fractionLimits(rect(0, 0, 0, 0), rect(0, 0, 300, 300))).toEqual({
			maxX: 1,
			maxY: 1,
			minX: 0,
			minY: 0
		});
	});
});
