import {
	EMIT_DEFAULTS,
	EMIT_PRESETS,
	EMIT_RANGES,
	emitBox,
	mergeEmit,
	normalizeEmit,
	resolveEmit,
	sameEmit
} from '../particles';

describe('normalizeEmit', () => {
	it('keeps valid keys, clamps numbers, drops junk', () => {
		expect(
			normalizeEmit({
				blend: 'glow' as never,
				color: '#F80',
				rate: 9999,
				spin: Number.NaN,
				size: 0.2,
				wobble: 3
			} as never)
		).toEqual({color: '#ff8800', rate: EMIT_RANGES.rate.max, size: 0.2, spin: 0});
	});

	it('is undefined when nothing is left', () => {
		expect(normalizeEmit({})).toBeUndefined();
		expect(normalizeEmit(null)).toBeUndefined();
	});
});

describe('mergeEmit / resolveEmit', () => {
	it('merges per key, the patch wins', () => {
		expect(mergeEmit({color: '#ff0000', rate: 10}, {rate: 0})).toEqual({
			color: '#ff0000',
			rate: 0
		});
	});

	it('layers defaults, asset, scene', () => {
		const params = resolveEmit({box: {h: 10, w: 10}, rate: 5, size: 0.5}, {rate: 7});

		expect(params).toEqual({...EMIT_DEFAULTS, rate: 7, size: 0.5});
	});

	it('defaults the box', () => {
		expect(emitBox(undefined)).toEqual({h: 320, w: 200});
		expect(emitBox({box: {h: 0, w: 5}})).toEqual({h: 320, w: 200});
		expect(emitBox({box: {h: 50, w: 40}})).toEqual({h: 50, w: 40});
	});

	it('compares by what it draws', () => {
		expect(sameEmit({rate: 5}, {rate: 5})).toBe(true);
		expect(sameEmit(undefined, {})).toBe(true);
		expect(sameEmit({rate: 5}, {rate: 6})).toBe(false);
	});
});

describe('presets', () => {
	it('are full, in-range parameter sets', () => {
		for (const {params} of Object.values(EMIT_PRESETS)) {
			expect(resolveEmit(params, undefined)).toEqual(params);
		}
	});
});
