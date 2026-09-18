import {
	BUBBLE_SHAPE_FNS,
	bubbleShape,
	cssColour,
	hashSeed,
	isBubbleShape,
	spliceTail
} from '../bubble-shapes';
import type {BubbleShapeInput} from '../bubble-shapes';

const base: BubbleShapeInput = {
	width: 240,
	height: 120,
	side: 'above',
	anchor: {x: 120, y: 200},
	color: '#ffffff',
	accent: '#3fc1cd',
	seed: 4242
};

describe('bubbleShape', () => {
	it('draws every name in the registry', () => {
		for (const name of Object.keys(BUBBLE_SHAPE_FNS)) {
			const drawn = bubbleShape(name, base);

			expect(drawn?.svg.startsWith('<svg')).toBe(true);
			expect(drawn?.svg.endsWith('</svg>')).toBe(true);
			expect(drawn!.margin).toBeGreaterThan(0);
			expect(drawn!.padding.top).toBeGreaterThan(0);
		}
	});

	it('is nothing for a name it does not know', () => {
		expect(bubbleShape('ghostly', base)).toBeUndefined();
		expect(isBubbleShape('ghostly')).toBe(false);
		expect(isBubbleShape(undefined)).toBe(false);
	});

	// The whole reason a shape is a pure function: it is redrawn on every reposition, and
	// an outline that wobbled differently each time would shimmer.
	it('is deterministic', () => {
		for (const name of Object.keys(BUBBLE_SHAPE_FNS)) {
			expect(bubbleShape(name, base)!.svg).toBe(bubbleShape(name, base)!.svg);
		}
	});

	it('gives two seeds two outlines', () => {
		expect(bubbleShape('comic', base)!.svg).not.toBe(
			bubbleShape('comic', {...base, seed: 7})!.svg
		);
	});

	it('leaves the tail out when there is nothing to point at', () => {
		const withTail = bubbleShape('comic', base)!;
		const without = bubbleShape('comic', {...base, anchor: null})!;

		expect(without.svg).not.toBe(withTail.svg);
		// No tail, no overshoot beyond the outline itself.
		expect(without.margin).toBeLessThan(withTail.margin);
	});

	it('reaches out to the anchor', () => {
		const near = bubbleShape('comic', {...base, anchor: {x: 120, y: 150}})!;
		const far = bubbleShape('comic', {...base, anchor: {x: 120, y: 260}})!;

		expect(far.margin).toBeGreaterThan(near.margin);
	});

	it('only draws the impact mark for impact', () => {
		// The mark is the one thing that tells the two apart, so the two must differ.
		expect(bubbleShape('impact', base)!.svg).not.toBe(
			bubbleShape('shard', base)!.svg
		);
	});

	it('paints with the colours it is given', () => {
		const drawn = bubbleShape('shard', {
			...base,
			color: '#101820',
			accent: 'rgb(255, 0, 128)'
		})!;

		expect(drawn.svg).toContain('#101820');
		expect(drawn.svg).toContain('rgb(255, 0, 128)');
	});

	it('survives a zero-sized box', () => {
		const drawn = bubbleShape('thought', {...base, width: 0, height: 0});

		expect(drawn?.svg.startsWith('<svg')).toBe(true);
		expect(drawn!.svg).not.toContain('NaN');
	});
});

describe('cssColour', () => {
	it('takes the CSS colour spellings', () => {
		expect(cssColour('#abc', 'x')).toBe('#abc');
		expect(cssColour('#a1b2c3ff', 'x')).toBe('#a1b2c3ff');
		expect(cssColour('rebeccapurple', 'x')).toBe('rebeccapurple');
		expect(cssColour('rgba(1, 2, 3, 0.5)', 'x')).toBe('rgba(1, 2, 3, 0.5)');
		expect(cssColour('  #fff  ', 'x')).toBe('#fff');
	});

	// These strings come out of story YAML and go into innerHTML.
	it('refuses anything else rather than escaping it', () => {
		expect(cssColour('"><script>bad()</script>', 'fallback')).toBe('fallback');
		expect(cssColour('url(http://example.com/x.png)', 'fallback')).toBe(
			'fallback'
		);
		expect(cssColour('', 'fallback')).toBe('fallback');
		expect(cssColour(undefined, 'fallback')).toBe('fallback');
	});

	it('keeps an injected colour out of the markup', () => {
		const drawn = bubbleShape('comic', {
			...base,
			color: '"/><script>bad()</script>'
		})!;

		expect(drawn.svg).not.toContain('script');
	});
});

describe('spliceTail', () => {
	const square = [
		{x: 0, y: 0},
		{x: 10, y: 0},
		{x: 20, y: 0},
		{x: 20, y: 10},
		{x: 20, y: 20},
		{x: 10, y: 20},
		{x: 0, y: 20},
		{x: 0, y: 10}
	];

	it('keeps the long way round and replaces the short one', () => {
		const out = spliceTail(
			square,
			{x: 2, y: 20},
			{x: 18, y: 20},
			[{x: 10, y: 30}]
		);

		// One point of the bottom edge is replaced; both bases and the tip are in.
		expect(out.tail).toEqual([{x: 10, y: 30}]);
		expect(out.closed).toContainEqual({x: 10, y: 30});
		expect(out.closed.length).toBeGreaterThan(square.length - 2);
		expect(out.body).not.toContainEqual({x: 10, y: 20});
	});

	// Both bases nearest the same outline point: the arc to drop is empty, and the shape
	// must survive whole rather than collapse to a tail with nothing behind it.
	it('keeps the outline when the base spans no points', () => {
		const out = spliceTail(square, {x: 9, y: 20}, {x: 11, y: 20}, [
			{x: 10, y: 30}
		]);

		expect(out.body.length).toBe(square.length + 2);
		expect(out.closed).toContainEqual({x: 10, y: 30});
	});

	it('does not care which base came first', () => {
		const a = spliceTail(square, {x: 2, y: 20}, {x: 18, y: 20}, [
			{x: 10, y: 30}
		]);
		const b = spliceTail(square, {x: 18, y: 20}, {x: 2, y: 20}, [
			{x: 10, y: 30}
		]);

		expect(b.closed.length).toBe(a.closed.length);
	});
});

describe('hashSeed', () => {
	it('is stable and spreads', () => {
		expect(hashSeed('mira:comic')).toBe(hashSeed('mira:comic'));
		expect(hashSeed('mira:comic')).not.toBe(hashSeed('tav:comic'));
	});
});
