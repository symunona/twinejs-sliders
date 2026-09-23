import {
	alignFits,
	cellIsEmpty,
	contentRuns,
	durForFps,
	feetFit,
	findFeet,
	fpsForDur,
	gridLayout,
	groupFiles,
	guessGrid,
	imagePointInBox,
	looksLikeSheet,
	Pixels,
	poseKey
} from '../import-set-logic';

/** A transparent canvas with opaque rectangles painted into it. */
function pixels(
	width: number,
	height: number,
	rects: {x: number; y: number; w: number; h: number; alpha?: number}[] = []
): Pixels {
	const data = new Uint8ClampedArray(width * height * 4);

	for (const rect of rects) {
		for (let y = rect.y; y < rect.y + rect.h; y++) {
			for (let x = rect.x; x < rect.x + rect.w; x++) {
				data[(y * width + x) * 4 + 3] = rect.alpha ?? 255;
			}
		}
	}

	return {data, height, width};
}

function file(name: string, webkitRelativePath = '') {
	return {name, webkitRelativePath};
}

describe('poseKey', () => {
	it.each([
		['idle.png', 'idle', undefined],
		['walk_01.png', 'walk', 1],
		['walk-10.png', 'walk', 10],
		['walk 3.webp', 'walk', 3],
		['walk07.png', 'walk', 7],
		['Kate Walk 003.png', 'walk', 3],
		['kate.png', 'kate', undefined],
		['cheer1.png', 'cheer', 1],
		['arms_crossed.png', 'arms-crossed', undefined]
	])('%s → %s #%s', (name, pose, index) => {
		expect(poseKey(name, 'kate')).toEqual({index, pose});
	});

	it('takes the folder name for a bare number', () => {
		expect(poseKey('0004.png', 'kate', 'renders/Walk Cycle/0004.png')).toEqual({
			index: 4,
			pose: 'walk-cycle'
		});
		expect(poseKey('0004.png', 'kate')).toEqual({index: 4, pose: 'pose'});
	});
});

describe('groupFiles', () => {
	it('groups by stem, sorts steps numerically, idle first', () => {
		const groups = groupFiles(
			[
				file('walk-10.png'),
				file('wave.png'),
				file('walk-2.png'),
				file('walk-1.webp'),
				file('idle.png')
			],
			'kate'
		);

		expect(groups.map(group => group.name)).toEqual(['idle', 'walk', 'wave']);
		expect(groups[1].items.map(item => item.name)).toEqual([
			'walk-1.webp',
			'walk-2.png',
			'walk-10.png'
		]);
		expect(groups[0].items).toHaveLength(1);
	});

	it('strips the character prefix before grouping', () => {
		const groups = groupFiles(
			[file('Kate Walk 002.png'), file('walk_1.png')],
			'kate'
		);

		expect(groups).toHaveLength(1);
		expect(groups[0].items.map(item => item.name)).toEqual([
			'walk_1.png',
			'Kate Walk 002.png'
		]);
	});

	it('puts an unnumbered file before the numbered ones', () => {
		const groups = groupFiles([file('run2.png'), file('run.png')], 'x');

		expect(groups[0].items.map(item => item.name)).toEqual(['run.png', 'run2.png']);
	});
});

describe('gridLayout', () => {
	it('count mode: margin and spacing come off before dividing', () => {
		const layout = gridLayout(
			{height: 100, width: 212},
			{by: 'count', cellH: 0, cellW: 0, cols: 4, margin: 2, rows: 2, spacing: 4}
		);

		// (212 - 4 - 3 * 4) / 4 = 49; (100 - 4 - 4) / 2 = 46
		expect(layout).toMatchObject({cellH: 46, cellW: 49, cols: 4, rows: 2});
		expect(layout.cells).toHaveLength(8);
		expect(layout.cells[1]).toEqual({col: 1, h: 46, row: 0, w: 49, x: 55, y: 2});
		expect(layout.cells[7]).toEqual({col: 3, h: 46, row: 1, w: 49, x: 161, y: 52});
	});

	it('size mode: drops a column cut short', () => {
		const layout = gridLayout(
			{height: 64, width: 100},
			{by: 'size', cellH: 32, cellW: 32, cols: 0, margin: 0, rows: 0, spacing: 2}
		);

		// 32 + 2 + 32 + 2 + 32 = 100 → 3 cols; 32 + 2 + 32 > 64 → 1 row
		expect(layout).toMatchObject({cols: 3, rows: 1});
		expect(layout.cells.map(cell => cell.x)).toEqual([0, 34, 68]);
	});

	it('returns no cells for a grid that does not fit', () => {
		expect(
			gridLayout(
				{height: 10, width: 10},
				{by: 'size', cellH: 20, cellW: 20, cols: 0, margin: 0, rows: 0, spacing: 0}
			).cells
		).toEqual([]);
	});
});

describe('cellIsEmpty', () => {
	const sheet = pixels(8, 4, [{h: 1, w: 1, x: 5, y: 3, alpha: 1}]);

	it('is empty only when every alpha is 0', () => {
		expect(cellIsEmpty(sheet, {h: 4, w: 4, x: 0, y: 0})).toBe(true);
		expect(cellIsEmpty(sheet, {h: 4, w: 4, x: 4, y: 0})).toBe(false);
	});

	it('treats pixels past the edge as empty', () => {
		expect(cellIsEmpty(sheet, {h: 4, w: 4, x: 8, y: 0})).toBe(true);
	});
});

describe('guessGrid', () => {
	it('counts the transparent gutters', () => {
		expect(contentRuns([0, 1, 1, 0, 0, 3, 0, 2])).toBe(3);
		expect(
			guessGrid(
				{height: 10, width: 30},
				{x: [0, 1, 0, 1, 0, 1], y: [1, 0, 1]},
				{h: 2, w: 1}
			)
		).toEqual({cols: 3, rows: 2});
	});

	it('falls back to one row of box-shaped cells', () => {
		expect(
			guessGrid({height: 100, width: 400}, {x: [1], y: [1]}, {h: 2, w: 1})
		).toEqual({cols: 8, rows: 1});
	});
});

describe('looksLikeSheet', () => {
	it('flags images far from the box shape', () => {
		expect(looksLikeSheet({height: 1280, width: 1728}, {h: 1024, w: 512})).toBe(true);
		expect(looksLikeSheet({height: 256, width: 192}, {h: 1024, w: 512})).toBe(false);
		expect(looksLikeSheet({height: 4000, width: 256}, {h: 1024, w: 512})).toBe(true);
	});
});

describe('align feet', () => {
	const box = {h: 200, w: 100};
	const origin = {x: 0.5, y: 1};

	it('finds the lowest opaque row and the centre of mass', () => {
		const art = pixels(10, 10, [
			{h: 6, w: 2, x: 2, y: 1},
			// faint shadow below the feet does not count as a foot
			{alpha: 20, h: 1, w: 2, x: 2, y: 9}
		]);
		const feet = findFeet(art)!;

		expect(feet.y).toBe(7);
		expect(feet.x).toBeCloseTo(3, 1);
		expect(findFeet(pixels(4, 4))).toBeUndefined();
	});

	it('puts every step’s feet on the same point', () => {
		const natural = {height: 20, width: 10};
		// Same drawing, drifting around its cell as sheet cells do.
		const steps = [
			pixels(10, 20, [{h: 10, w: 4, x: 1, y: 2}]),
			pixels(10, 20, [{h: 10, w: 4, x: 5, y: 8}]),
			pixels(10, 20, [{h: 12, w: 2, x: 3, y: 0}])
		];
		const landed = steps.map(step => {
			const feet = findFeet(step)!;
			const fit = feetFit(feet, natural, box, origin);

			return imagePointInBox(feet, natural, box, origin, fit);
		});

		for (const point of landed) {
			expect(point.x).toBeCloseTo(origin.x, 2);
			expect(point.y).toBeCloseTo(origin.y, 2);
		}
	});

	it('maps an image point as object-fit contain at the origin does', () => {
		// 10×10 art in a 100×200 box: scale 10, 100×100, bottom-aligned (origin y = 1).
		expect(
			imagePointInBox({x: 5, y: 10}, {height: 10, width: 10}, box, origin)
		).toEqual({x: 0.5, y: 1});
		expect(
			imagePointInBox({x: 0, y: 0}, {height: 10, width: 10}, box, origin)
		).toEqual({x: 0, y: 0.5});
	});
});

describe('timing', () => {
	it('stores the default hold as absent', () => {
		expect(durForFps(10)).toBeUndefined();
		expect(durForFps(12)).toBe(0.083);
		expect(durForFps(0)).toBeUndefined();
		expect(fpsForDur(undefined)).toBe(10);
		expect(fpsForDur(0.25)).toBe(4);
	});
});

describe('alignFits', () => {
	const box = {h: 200, w: 100};
	const origin = {x: 0.5, y: 1};
	const images = [
		{feet: {x: 4, y: 18}, height: 20, width: 10},
		{feet: {x: 6, y: 20}, height: 20, width: 10},
		{height: 20, width: 10}
	];

	it('off leaves the art as drawn', () => {
		expect(alignFits(images, 'off', box, origin)).toEqual([
			undefined,
			undefined,
			undefined
		]);
	});

	it('step aligns each image on its own feet', () => {
		const fits = alignFits(images, 'step', box, origin);

		expect(fits[0]).toEqual(feetFit(images[0].feet!, images[0], box, origin));
		expect(fits[1]).toEqual(feetFit(images[1].feet!, images[1], box, origin));
		expect(fits[2]).toBeUndefined();
	});

	it('pose moves every image by one shared offset', () => {
		const fits = alignFits(images, 'pose', box, origin);

		expect(fits[0]).toEqual(fits[1]);
		expect(fits[0]).toEqual(fits[2]);
		// mean x 5 → centred; lowest foot 20 → already on the floor
		expect(fits[0]).toEqual({offset: {x: 0, y: 0}, scale: 1});
	});
});
