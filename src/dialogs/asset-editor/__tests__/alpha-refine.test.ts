import {
	applyEdgeContrast,
	boxBlur,
	guidedFilter,
	lumaFrom,
	maskBounds,
	upsampleMask
} from '../alpha-refine';

describe('boxBlur', () => {
	it('leaves a flat field flat, including at the edges', () => {
		const flat = new Float32Array(64).fill(0.5);
		const blurred = boxBlur(flat, 8, 8, 2);

		for (const value of blurred) {
			expect(value).toBeCloseTo(0.5, 5);
		}
	});

	it('spreads a spike into its neighbors', () => {
		const spike = new Float32Array(25);

		spike[12] = 1;

		const blurred = boxBlur(spike, 5, 5, 1);

		expect(blurred[12]).toBeLessThan(1);
		expect(blurred[11]).toBeGreaterThan(0);
		expect(blurred[0]).toBe(0);
	});
});

describe('upsampleMask', () => {
	it('keeps the corners and interpolates between them', () => {
		const mask = {data: new Float32Array([0, 0, 0, 1]), height: 2, width: 2};
		const bigger = upsampleMask(mask, 8, 8);

		expect(bigger[0]).toBeCloseTo(0, 5);
		expect(bigger[63]).toBeCloseTo(1, 5);

		// Values rise monotonically down the diagonal.
		for (let step = 1; step < 8; step++) {
			expect(bigger[step * 8 + step]).toBeGreaterThanOrEqual(
				bigger[(step - 1) * 8 + step - 1]
			);
		}
	});
});

describe('maskBounds', () => {
	it('finds the subject and pads it', () => {
		const data = new Float32Array(100);

		// A 2×2 block at (4, 4) in a 10×10 mask.
		for (const y of [4, 5]) {
			for (const x of [4, 5]) {
				data[y * 10 + x] = 1;
			}
		}

		const bounds = maskBounds({data, height: 10, width: 10}, 0.5, 0.1)!;

		expect(bounds.left).toBeCloseTo(0.3, 5);
		expect(bounds.right).toBeCloseTo(0.7, 5);
		expect(bounds.top).toBeCloseTo(0.3, 5);
		expect(bounds.bottom).toBeCloseTo(0.7, 5);
	});

	it('gives up when the model found nothing', () => {
		expect(
			maskBounds({data: new Float32Array(100), height: 10, width: 10})
		).toBeUndefined();
	});
});

describe('guidedFilter with applyEdgeContrast', () => {
	const size = 128;
	const edge = 64;

	/** An image edge with a little texture on both sides of it. */
	function guideImage() {
		const guide = new Float32Array(size * size);

		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				guide[y * size + x] =
					(x < edge ? 0.15 : 0.75) + ((x * 7 + y * 13) % 17) / 170;
			}
		}

		return guide;
	}

	/** What an enlarged mask looks like: smeared, and off by `offset` pixels. */
	function smearedMask(offset: number, smear = 6) {
		const mask = new Float32Array(size * size);
		const center = edge + offset;

		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				mask[y * size + x] = Math.min(
					1,
					Math.max(0, (x - (center - smear / 2)) / smear)
				);
			}
		}

		return mask;
	}

	/** Alpha in the wrong place, in pixels per row. */
	function misplaced(alpha: Float32Array) {
		let total = 0;

		for (let y = 8; y < size - 8; y++) {
			for (let x = 0; x < size; x++) {
				total += Math.abs(alpha[y * size + x] - (x < edge ? 0 : 1));
			}
		}

		return total / (size - 16);
	}

	it('moves a misaligned edge onto the one the image has', () => {
		const mask = smearedMask(2);
		const refined = applyEdgeContrast(
			guidedFilter(guideImage(), mask, size, size, 8, 1e-4)
		);

		expect(misplaced(mask)).toBeGreaterThan(2);
		expect(misplaced(refined)).toBeLessThan(0.2);
	});

	it('needs a window wider than the error it is correcting', () => {
		const mask = smearedMask(4);
		const guide = guideImage();
		const narrow = applyEdgeContrast(
			guidedFilter(guide, mask, size, size, 4, 1e-4)
		);
		const wide = applyEdgeContrast(
			guidedFilter(guide, mask, size, size, 24, 1e-4)
		);

		// A radius smaller than the misalignment can't see both edges at once.
		expect(misplaced(narrow)).toBeGreaterThan(3);
		expect(misplaced(wide)).toBeLessThan(0.2);
	});

	it('does nothing useful on its own, which is why the contrast step exists', () => {
		const mask = smearedMask(0);
		const filtered = guidedFilter(guideImage(), mask, size, size, 8, 1e-4);

		// The filter alone leaves the error where it found it: what it returns
		// is a correctly placed but washed out step, around 0.25 to 0.75.
		expect(misplaced(filtered)).toBeCloseTo(misplaced(mask), 0);
		expect(misplaced(applyEdgeContrast(filtered))).toBeLessThan(0.2);
	});

	it('stays inside 0 and 1', () => {
		const refined = applyEdgeContrast(
			guidedFilter(guideImage(), smearedMask(3), size, size, 12, 1e-4)
		);

		for (const value of refined) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}
	});
});

describe('lumaFrom', () => {
	it('reads green hardest and blue softest', () => {
		const luma = lumaFrom(
			new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
		);

		expect(luma[0]).toBeCloseTo(0.2126, 3);
		expect(luma[1]).toBeCloseTo(0.7152, 3);
		expect(luma[2]).toBeCloseTo(0.0722, 3);
	});
});
