import {
	TILE_RANGE,
	axisSize,
	blendSeam,
	seamWidth,
	tiledSize
} from '../tile-edits';

/** A row of opaque greys, one per column, so a pixel can be read back as a number. */
function greys(values: number[], height = 1): Uint8ClampedArray {
	const data = new Uint8ClampedArray(values.length * height * 4);

	for (let y = 0; y < height; y++) {
		values.forEach((value, x) => {
			const at = (y * values.length + x) * 4;

			data[at] = value;
			data[at + 1] = value;
			data[at + 2] = value;
			data[at + 3] = 255;
		});
	}

	return data;
}

/** A column of opaque greys, one per row: the same picture, stood on its end. */
function greyRows(values: number[], width = 1): Uint8ClampedArray {
	const data = new Uint8ClampedArray(values.length * width * 4);

	values.forEach((value, y) => {
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;

			data[at] = value;
			data[at + 1] = value;
			data[at + 2] = value;
			data[at + 3] = 255;
		}
	});

	return data;
}

/** The red channel of one row, which `greys` makes the whole pixel. */
function row(
	result: {data: Uint8ClampedArray; width: number},
	y = 0
): number[] {
	return Array.from({length: result.width}, (_unused, x) =>
		Number(result.data[(y * result.width + x) * 4])
	);
}

describe('seamWidth', () => {
	it('is zero when the overlap is off', () => {
		expect(seamWidth(100, 0)).toBe(0);
		expect(seamWidth(100, undefined)).toBe(0);
	});

	it('is the fraction of the width, rounded', () => {
		expect(seamWidth(100, 0.25)).toBe(25);
		expect(seamWidth(80, 0.1)).toBe(8);
	});

	it('never eats the whole picture', () => {
		expect(seamWidth(10, 1)).toBe(9);
		expect(seamWidth(10, 5)).toBe(9);
	});

	it('rounds up to a pixel rather than down to nothing', () => {
		// A 0.01 overlap on a narrow picture rounds to zero, which would leave the slider
		// off its rest position and doing nothing at all.
		expect(seamWidth(20, 0.01)).toBe(1);
	});

	it('ignores a picture too narrow to have two edges', () => {
		expect(seamWidth(1, 0.5)).toBe(0);
	});
});

describe('axisSize', () => {
	it('reads the width sideways and the height downwards', () => {
		expect(axisSize({height: 60, width: 100}, 'x')).toBe(100);
		expect(axisSize({height: 60, width: 100}, 'y')).toBe(60);
	});

	it('treats an absent axis as sideways', () => {
		expect(axisSize({height: 60, width: 100}, undefined)).toBe(100);
	});
});

describe('tiledSize', () => {
	const size = {height: 60, width: 100};

	it('is the size itself when nothing overlaps', () => {
		expect(tiledSize(size, 0, 'x')).toEqual(size);
		expect(tiledSize(size, undefined, 'y')).toEqual(size);
	});

	it('takes the overlap off the width, sideways', () => {
		expect(tiledSize(size, 0.25, 'x')).toEqual({height: 60, width: 75});
	});

	it('takes it off the height instead, downwards', () => {
		expect(tiledSize(size, 0.25, 'y')).toEqual({height: 45, width: 100});
	});

	it('folds sideways when no axis was named', () => {
		expect(tiledSize(size, 0.25, undefined)).toEqual({height: 60, width: 75});
	});

	it('stays at a pixel', () => {
		expect(tiledSize({height: 2, width: 2}, 0.5, 'y')).toEqual({
			height: 1,
			width: 2
		});
	});
});

/** The red channel down one column, for the pictures `greyRows` builds. */
function column(
	result: {data: Uint8ClampedArray; height: number; width: number},
	x = 0
): number[] {
	return Array.from({length: result.height}, (_unused, y) =>
		Number(result.data[(y * result.width + x) * 4])
	);
}

describe('blendSeam', () => {
	it('hands the pixels straight back when nothing overlaps', () => {
		const pixels = greys([10, 20, 30, 40]);
		const result = blendSeam(pixels, 4, 1, 0);

		expect(result.width).toBe(4);
		expect(result.data).toBe(pixels);
	});

	it('narrows the picture by the overlap', () => {
		const result = blendSeam(greys([0, 0, 0, 0, 0, 0]), 6, 1, 2);

		expect(result.width).toBe(4);
		expect(result.data).toHaveLength(4 * 4);
	});

	it('leaves everything past the overlap untouched', () => {
		const result = blendSeam(greys([0, 100, 200, 220, 240, 250]), 6, 1, 2);

		expect(row(result).slice(2)).toEqual([200, 220]);
	});

	/*
	The whole point of the edit: read round the loop, the last column of the output and its
	first have to be neighbours in the original. With a two-pixel overlap on a six-wide
	picture the output is four wide, so column 0 is mostly the old column 4 -- and the old
	column 3 is what the output now ends on.
	*/
	it('lands the far edge next to the near one', () => {
		const result = blendSeam(greys([0, 10, 20, 30, 200, 210]), 6, 1, 2);
		const out = row(result);

		// Column 0 is three quarters of the old column 4, one quarter of the old column 0.
		expect(out[0]).toBe(Math.round(200 * 0.75 + 0 * 0.25));
		// Column 1 is the other way round: mostly the old column 1.
		expect(out[1]).toBe(Math.round(210 * 0.25 + 10 * 0.75));
		// And the output ends on the column that used to sit just before the strip that
		// has now become its start.
		expect(out[out.length - 1]).toBe(30);
	});

	it('crossfades rather than cutting', () => {
		// Black on the left, white on the right: every column of a wide overlap has to be
		// strictly between the two, and marching one way.
		const source = greys([0, 0, 0, 0, 255, 255, 255, 255]);
		const out = row(blendSeam(source, 8, 1, 4));

		expect(out).toHaveLength(4);

		for (let x = 1; x < out.length; x++) {
			expect(out[x]).toBeLessThan(out[x - 1]);
		}

		expect(out[0]).toBeLessThan(255);
		expect(out[out.length - 1]).toBeGreaterThan(0);
	});

	it('blends every row the same way', () => {
		const result = blendSeam(greys([0, 10, 20, 30, 200, 210], 3), 6, 3, 2);

		expect(row(result, 1)).toEqual(row(result, 0));
		expect(row(result, 2)).toEqual(row(result, 0));
	});

	/*
	Straight RGBA blending drags the colour of invisible pixels into visible ones -- a
	cutout whose transparent side is black would darken the surviving edge. Premultiplying
	is what keeps the colour of a fully transparent column out of the answer entirely.
	*/
	it('does not pull colour out of transparent pixels', () => {
		const data = greys([0, 0, 0, 0, 180, 180]);

		// The two columns that will be folded over the start are transparent black.
		for (const x of [4, 5]) {
			data[x * 4] = 0;
			data[x * 4 + 1] = 0;
			data[x * 4 + 2] = 0;
			data[x * 4 + 3] = 0;
		}

		// ...and the columns they land on are opaque white.
		for (const x of [0, 1]) {
			data[x * 4] = 255;
			data[x * 4 + 1] = 255;
			data[x * 4 + 2] = 255;
		}

		const result = blendSeam(data, 6, 1, 2);

		// White, still. Only the alpha fades.
		expect(row(result).slice(0, 2)).toEqual([255, 255]);
		expect(result.data[3]).toBeLessThan(result.data[7]);
	});

	it('writes nothing where both sides are transparent', () => {
		const data = new Uint8ClampedArray(6 * 4);
		const result = blendSeam(data, 6, 1, 2);

		expect(Array.from(result.data)).toEqual(new Array(4 * 4).fill(0));
	});

	it('mixes even a one-pixel overlap', () => {
		const out = row(blendSeam(greys([0, 10, 20, 200]), 4, 1, 1));

		expect(out[0]).toBeGreaterThan(0);
		expect(out[0]).toBeLessThan(200);
	});

	it('offers an overlap range that cannot swallow the picture', () => {
		expect(TILE_RANGE.min).toBe(0);
		expect(TILE_RANGE.max).toBeLessThanOrEqual(0.5);
	});
});

describe('blendSeam, downwards', () => {
	it('shortens the picture by the overlap and keeps its width', () => {
		const result = blendSeam(greyRows([0, 0, 0, 0, 0, 0], 3), 3, 6, 2, 'y');

		expect(result.height).toBe(4);
		expect(result.width).toBe(3);
		expect(result.data).toHaveLength(3 * 4 * 4);
	});

	it('leaves everything past the overlap untouched', () => {
		const result = blendSeam(
			greyRows([0, 100, 200, 220, 240, 250]),
			1,
			6,
			2,
			'y'
		);

		expect(column(result).slice(2)).toEqual([200, 220]);
	});

	it('lands the bottom edge next to the top one', () => {
		const result = blendSeam(greyRows([0, 10, 20, 30, 200, 210]), 1, 6, 2, 'y');
		const out = column(result);

		expect(out[0]).toBe(Math.round(200 * 0.75 + 0 * 0.25));
		expect(out[1]).toBe(Math.round(210 * 0.25 + 10 * 0.75));
		expect(out[out.length - 1]).toBe(30);
	});

	it('crossfades rather than cutting', () => {
		const source = greyRows([0, 0, 0, 0, 255, 255, 255, 255]);
		const out = column(blendSeam(source, 1, 8, 4, 'y'));

		expect(out).toHaveLength(4);

		for (let y = 1; y < out.length; y++) {
			expect(out[y]).toBeLessThan(out[y - 1]);
		}
	});

	it('blends every column the same way', () => {
		const result = blendSeam(
			greyRows([0, 10, 20, 30, 200, 210], 3),
			3,
			6,
			2,
			'y'
		);

		expect(column(result, 1)).toEqual(column(result, 0));
		expect(column(result, 2)).toEqual(column(result, 0));
	});

	/*
	The one mistake this shape of code invites: reading the far edge with the SOURCE width
	when the output is narrower, or the other way about. Sideways the two differ, downwards
	they do not -- so a picture wider than one pixel, folded downwards, is what catches a
	stride taken from the wrong size.
	*/
	it('does not mix neighbouring columns into each other', () => {
		const data = new Uint8ClampedArray(2 * 4 * 4);

		// Left column black all the way down, right column white all the way down.
		for (let y = 0; y < 4; y++) {
			const at = y * 2 * 4;

			data[at + 3] = 255;
			data[at + 4] = 255;
			data[at + 5] = 255;
			data[at + 6] = 255;
			data[at + 7] = 255;
		}

		const result = blendSeam(data, 2, 4, 2, 'y');

		expect(column(result, 0)).toEqual([0, 0]);
		expect(column(result, 1)).toEqual([255, 255]);
	});

	it('does not pull colour out of transparent pixels', () => {
		const data = greyRows([255, 255, 0, 0, 0, 0]);

		// The two rows that will be folded over the start are transparent black.
		for (const y of [4, 5]) {
			data[y * 4 + 3] = 0;
		}

		const result = blendSeam(data, 1, 6, 2, 'y');

		expect(column(result).slice(0, 2)).toEqual([255, 255]);
		expect(result.data[3]).toBeLessThan(result.data[7]);
	});
});
