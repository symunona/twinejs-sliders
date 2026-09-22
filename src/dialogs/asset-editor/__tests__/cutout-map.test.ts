import {packAlpha, unpackAlpha} from '../cutout-map';

describe('packAlpha', () => {
	it('writes the map into RGB and leaves the image opaque', () => {
		// Not into the alpha channel: a canvas un-premultiplies on the way back out, which
		// quantises twice and wipes RGB wherever alpha is zero.
		const packed = packAlpha(new Float32Array([0, 1]));

		expect([...packed]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
	});

	it('survives a round trip, to within the eight bits it is stored in', () => {
		// 0.25 comes back as 64/255. That is the whole trade: a quarter of a percent of
		// precision for a map small enough to keep beside every cut-out asset, on a value
		// `applyTuning` is about to threshold anyway.
		const alpha = new Float32Array([0, 0.25, 0.5, 1]);
		const roundTripped = unpackAlpha(packAlpha(alpha));

		expect(roundTripped[0]).toBe(0);
		expect(roundTripped[3]).toBe(1);
		expect(roundTripped[1]).toBeCloseTo(0.25, 2);
		expect(roundTripped[2]).toBeCloseTo(0.5, 2);
	});

	it('stores a NaN as fully transparent rather than as garbage', () => {
		expect([...unpackAlpha(packAlpha(new Float32Array([NaN])))]).toEqual([0]);
	});

	it('clamps a map that runs outside 0..1', () => {
		expect([...unpackAlpha(packAlpha(new Float32Array([-1, 2])))]).toEqual([
			0, 1
		]);
	});
});
