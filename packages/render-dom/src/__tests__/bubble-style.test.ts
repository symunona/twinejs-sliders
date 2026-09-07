import {pinnedRect, tailToward} from '../dialogue';

const box = {left: 100, top: 50, width: 400, height: 200};

describe('pinnedRect', () => {
	it('is undefined when the author pinned nothing', () => {
		expect(pinnedRect(undefined, box, 80, 40, 10)).toBeUndefined();
		expect(pinnedRect({place: 'auto'}, box, 80, 40, 10)).toBeUndefined();
	});

	it('centres the bubble on an explicit at:', () => {
		expect(pinnedRect({at: {x: 0.5, y: 0.5}}, box, 80, 40, 10)).toEqual({
			left: 100 + 200 - 40,
			top: 50 + 100 - 20
		});
	});

	it('clamps a position outside the box back inside it', () => {
		expect(pinnedRect({at: {x: 2, y: -1}}, box, 80, 40, 10)).toEqual({
			left: 100 + 400 - 80 - 10,
			top: 50 + 10
		});
	});

	it('puts a zone in its corner', () => {
		expect(pinnedRect({place: 'top-right'}, box, 80, 40, 10)).toEqual({
			left: 100 + 400 - 80 - 10,
			top: 50 + 10
		});
		expect(pinnedRect({place: 'bottom-left'}, box, 80, 40, 10)).toEqual({
			left: 110,
			top: 50 + 200 - 40 - 10
		});
	});

	it('at: beats place:', () => {
		expect(
			pinnedRect({at: {x: 0, y: 0}, place: 'bottom-right'}, box, 80, 40, 10)
		).toEqual({left: 110, top: 60});
	});
});

describe('tailToward', () => {
	const rect = {left: 200, top: 100};

	it('hangs the tail off the edge that faces the speaker', () => {
		// Anchor below the bubble: the bubble sits above it.
		expect(tailToward({x: 240, y: 400}, rect, 80, 40)?.side).toBe('above');
		expect(tailToward({x: 240, y: 10}, rect, 80, 40)?.side).toBe('below');
		expect(tailToward({x: 20, y: 120}, rect, 80, 40)?.side).toBe('right');
		expect(tailToward({x: 900, y: 120}, rect, 80, 40)?.side).toBe('left');
	});

	it('draws no tail when the bubble already covers the anchor', () => {
		expect(tailToward({x: 240, y: 120}, rect, 80, 40)).toBeUndefined();
	});

	it('keeps the tail off the rounded corners', () => {
		// Far below and far to the left: the bubble is to the anchor's right, so the tail
		// rides its left edge and slides as far DOWN that edge as the corner inset allows.
		const far = tailToward({x: -500, y: 400}, rect, 80, 40);

		expect(far).toEqual({offset: 23, side: 'right'});

		// The same clamp at the other end.
		expect(tailToward({x: -500, y: -400}, rect, 80, 40)).toEqual({
			offset: 17,
			side: 'right'
		});
	});
});
