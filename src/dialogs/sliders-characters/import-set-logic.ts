/**
 * Import set: the arithmetic. Grouping files into poses by name, slicing a sprite sheet
 * into a grid, spotting empty cells, and the offsets that stand every step on the same
 * feet.
 *
 * No DOM, no canvas. Pixels come in as a plain RGBA array so the rules can be tested on
 * hand-made data — jest-canvas-mock hands back blank ImageData whatever was drawn.
 */
import {slugify} from '@sliders/asset-store';
import {DEFAULT_STEP_SECONDS, Frac2, PoseFit} from '@sliders/scene-types';

// ---------------------------------------------------------------------------
// Grouping by filename
// ---------------------------------------------------------------------------

export interface PoseKey {
	/** Pose name, slugged. */
	pose: string;
	/** The trailing number, if the stem had one. Absent sorts first. */
	index?: number;
}

/** `walk_01.png` → `walk_01`. Folders dropped. */
function stemOf(filename: string): string {
	const base = filename.replace(/\\/g, '/').split('/').pop() ?? filename;

	return base.replace(/\.[^.]+$/, '');
}

/** Parent folder of a `webkitRelativePath`, or undefined for a loose file. */
function folderOf(path: string | undefined): string | undefined {
	const parts = (path ?? '').replace(/\\/g, '/').split('/').filter(Boolean);

	return parts.length > 1 ? parts[parts.length - 2] : undefined;
}

/**
 * Which pose a file belongs to, and where in it.
 *
 * Slugify the stem. Strip a trailing `[_-\s]?\d+`. Strip a leading `<character id>-`. A
 * stem that is ONLY a number (`0001.png`, what Blender writes) takes its folder's name —
 * a render into `walk/` is the walk.
 */
export function poseKey(
	filename: string,
	characterId: string,
	path?: string
): PoseKey {
	// Separators become `-` here, so the trailing-number rule has one separator to know.
	const slug = slugify(stemOf(filename));
	const numbered = /^(.*?)-?(\d+)$/.exec(slug);
	let pose = numbered ? numbered[1] : slug;
	const index = numbered ? parseInt(numbered[2], 10) : undefined;

	if (!pose) {
		const folder = folderOf(path);

		pose = folder ? slugify(folder) : 'pose';
	}

	const prefix = `${characterId}-`;

	if (pose.startsWith(prefix) && pose.length > prefix.length) {
		pose = pose.slice(prefix.length);
	}

	return {index, pose};
}

export interface FileGroup<T> {
	name: string;
	items: T[];
}

/**
 * Files into poses. Same key = same pose; steps in NUMERIC order (walk-2 before walk-10),
 * unnumbered first. Poses come out `idle` first, then by name — a folder picker hands
 * files over in no order worth keeping.
 *
 * A group of one is a still pose; the caller decides that, not this.
 */
export function groupFiles<T extends {name: string; webkitRelativePath?: string}>(
	files: T[],
	characterId: string
): FileGroup<T>[] {
	const groups = new Map<string, {index?: number; item: T}[]>();

	for (const item of files) {
		const key = poseKey(item.name, characterId, item.webkitRelativePath);
		const group = groups.get(key.pose) ?? [];

		group.push({index: key.index, item});
		groups.set(key.pose, group);
	}

	const names = [...groups.keys()].sort((a, b) =>
		a === 'idle' ? -1 : b === 'idle' ? 1 : a.localeCompare(b)
	);

	return names.map(name => ({
		items: groups
			.get(name)!
			.slice()
			.sort(
				(a, b) =>
					(a.index ?? -1) - (b.index ?? -1) || a.item.name.localeCompare(b.item.name)
			)
			.map(entry => entry.item),
		name
	}));
}

// ---------------------------------------------------------------------------
// Sprite sheet grid
// ---------------------------------------------------------------------------

export interface GridSpec {
	/** `count`: cols × rows given, cell size follows. `size`: cell w × h given. */
	by: 'count' | 'size';
	cols: number;
	rows: number;
	cellW: number;
	cellH: number;
	/** Around the whole sheet, px. */
	margin: number;
	/** Between cells, px. */
	spacing: number;
}

export interface CellRect {
	col: number;
	row: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface GridLayout {
	cols: number;
	rows: number;
	cellW: number;
	cellH: number;
	/** Row-major. */
	cells: CellRect[];
}

export interface Size {
	width: number;
	height: number;
}

function whole(value: number, min = 0): number {
	return Number.isFinite(value) ? Math.max(min, Math.floor(value)) : min;
}

/**
 * Where every cell is. Cells that would run off the sheet are not cells: a `size` grid
 * whose last column is cut short drops that column.
 */
export function gridLayout(image: Size, spec: GridSpec): GridLayout {
	const margin = whole(spec.margin);
	const spacing = whole(spec.spacing);
	const innerW = image.width - 2 * margin;
	const innerH = image.height - 2 * margin;
	let cols: number;
	let rows: number;
	let cellW: number;
	let cellH: number;

	if (spec.by === 'count') {
		cols = whole(spec.cols, 1);
		rows = whole(spec.rows, 1);
		cellW = whole((innerW - (cols - 1) * spacing) / cols);
		cellH = whole((innerH - (rows - 1) * spacing) / rows);
	} else {
		cellW = whole(spec.cellW, 1);
		cellH = whole(spec.cellH, 1);
		cols = whole((innerW + spacing) / (cellW + spacing));
		rows = whole((innerH + spacing) / (cellH + spacing));
	}

	if (cellW < 1 || cellH < 1 || cols < 1 || rows < 1) {
		return {cells: [], cellH: 0, cellW: 0, cols: 0, rows: 0};
	}

	const cells: CellRect[] = [];

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			cells.push({
				col,
				h: cellH,
				row,
				w: cellW,
				x: margin + col * (cellW + spacing),
				y: margin + row * (cellH + spacing)
			});
		}
	}

	return {cellH, cellW, cells, cols, rows};
}

/** RGBA pixels, as `ImageData` has them. */
export interface Pixels {
	data: Uint8ClampedArray | number[];
	width: number;
	height: number;
}

/** True when every pixel in `rect` has alpha 0. Out-of-sheet pixels count as empty. */
export function cellIsEmpty(pixels: Pixels, rect: {x: number; y: number; w: number; h: number}): boolean {
	const x1 = Math.min(pixels.width, rect.x + rect.w);
	const y1 = Math.min(pixels.height, rect.y + rect.h);

	for (let y = Math.max(0, rect.y); y < y1; y++) {
		for (let x = Math.max(0, rect.x); x < x1; x++) {
			if (pixels.data[(y * pixels.width + x) * 4 + 3] !== 0) {
				return false;
			}
		}
	}

	return true;
}

/** Alpha summed down each column (`axis: 'x'`) or across each row (`'y'`). */
export function alphaProfile(pixels: Pixels, axis: 'x' | 'y'): number[] {
	const profile = new Array(axis === 'x' ? pixels.width : pixels.height).fill(0);

	for (let y = 0; y < pixels.height; y++) {
		for (let x = 0; x < pixels.width; x++) {
			const alpha = pixels.data[(y * pixels.width + x) * 4 + 3];

			if (alpha) {
				profile[axis === 'x' ? x : y] += alpha;
			}
		}
	}

	return profile;
}

/** How many separate stretches of non-zero there are. */
export function contentRuns(profile: number[]): number {
	let runs = 0;
	let inside = false;

	for (const value of profile) {
		if (value > 0 && !inside) {
			runs++;
		}

		inside = value > 0;
	}

	return runs;
}

/**
 * A first guess at cols × rows: the transparent gutters that run the whole way across the
 * sheet. Right for most sheets whose sprites do not touch; the author corrects the rest.
 * Falls back to one row of cells shaped like the character's box.
 */
export function guessGrid(
	image: Size,
	profiles: {x: number[]; y: number[]} | undefined,
	box: {w: number; h: number}
): {cols: number; rows: number} {
	const cols = profiles ? contentRuns(profiles.x) : 0;
	const rows = profiles ? contentRuns(profiles.y) : 0;

	if (cols >= 1 && rows >= 1 && cols * rows > 1) {
		return {cols, rows};
	}

	const cellW = image.height * (box.w / box.h);

	return {
		cols: Math.max(1, Math.round(image.width / Math.max(1, cellW))),
		rows: 1
	};
}

/**
 * Does one image look like a sheet rather than one pose? Its shape against the
 * character's box: a pose is roughly box-shaped, a sheet of 8 is not. Only a suggestion —
 * the dialog has a toggle.
 */
export function looksLikeSheet(image: Size, box: {w: number; h: number}): boolean {
	if (!(image.width > 0) || !(image.height > 0) || !(box.w > 0) || !(box.h > 0)) {
		return false;
	}

	const ratio = image.width / image.height / (box.w / box.h);

	return ratio >= 1.75 || ratio <= 1 / 1.75;
}

// ---------------------------------------------------------------------------
// Align feet
// ---------------------------------------------------------------------------

/** Image pixels. `y` is the BOTTOM edge of the lowest opaque row. */
export interface Feet {
	x: number;
	y: number;
}

/**
 * Lowest opaque row (alpha ≥ `threshold`, so a faint shadow or an antialiased edge does
 * not count as a foot) and the alpha-weighted horizontal centre of mass.
 */
export function findFeet(pixels: Pixels, threshold = 128): Feet | undefined {
	let lowest = -1;
	let mass = 0;
	let moment = 0;

	for (let y = 0; y < pixels.height; y++) {
		for (let x = 0; x < pixels.width; x++) {
			const alpha = pixels.data[(y * pixels.width + x) * 4 + 3];

			if (alpha) {
				mass += alpha;
				moment += alpha * (x + 0.5);

				if (alpha >= threshold) {
					lowest = y;
				}
			}
		}
	}

	if (lowest < 0 || mass === 0) {
		return undefined;
	}

	return {x: moment / mass, y: lowest + 1};
}

/**
 * Where an image pixel lands in the character box, as a fraction of it — the way the
 * renderer draws a sprite: `object-fit: contain`, `object-position` at the origin, then
 * the fit's translate (fractions of the box) and a scale about the origin.
 */
export function imagePointInBox(
	point: {x: number; y: number},
	natural: Size,
	box: {w: number; h: number},
	origin: Frac2,
	fit?: PoseFit
): Frac2 {
	const s = Math.min(box.w / natural.width, box.h / natural.height);
	const left = (box.w - natural.width * s) * origin.x;
	const top = (box.h - natural.height * s) * origin.y;
	const scale = fit?.scale ?? 1;
	let x = left + point.x * s;
	let y = top + point.y * s;

	// Scale about the origin, then translate — CSS applies `translate(...) scale(...)`
	// right to left.
	x = origin.x * box.w + (x - origin.x * box.w) * scale;
	y = origin.y * box.h + (y - origin.y * box.h) * scale;

	return {
		x: x / box.w + (fit?.offset.x ?? 0),
		y: y / box.h + (fit?.offset.y ?? 0)
	};
}

function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/**
 * The fit that stands `feet` on the character's origin. Every step aligned this way shares
 * one origin, which is what stops a walk from wobbling. Scale stays 1.
 *
 * Clamped to a box either way, like a drag in the editor.
 */
export function feetFit(
	feet: Feet,
	natural: Size,
	box: {w: number; h: number},
	origin: Frac2
): PoseFit {
	const at = imagePointInBox(feet, natural, box, origin);
	const clamp = (value: number) => round3(Math.min(1, Math.max(-1, value)));

	return {
		offset: {x: clamp(origin.x - at.x), y: clamp(origin.y - at.y)},
		scale: 1
	};
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** fps → seconds per step, three decimals. Undefined when it is the default hold. */
export function durForFps(fps: number): number | undefined {
	if (!(fps > 0)) {
		return undefined;
	}

	const dur = round3(1 / fps);

	return dur === DEFAULT_STEP_SECONDS ? undefined : dur;
}

/** Seconds per step → the fps a person would type. */
export function fpsForDur(dur: number | undefined): number {
	const seconds = dur && dur > 0 ? dur : DEFAULT_STEP_SECONDS;

	return Math.round((1 / seconds) * 10) / 10;
}

/**
 * `step`: every image stands on its own feet (the plan's rule — fixes sheet cells that
 * drift, but a walk whose arms swing gets a little sideways sway from the centre of mass).
 * `pose`: one shared feet point — the images' mean centre, their lowest foot — so art that
 * was already registered keeps its registration and only moves as a whole.
 */
export type AlignMode = 'off' | 'pose' | 'step';

export interface AlignImage extends Size {
	feet?: Feet;
}

/** The fit for each image of one pose, or undefined where there is nothing to align. */
export function alignFits(
	images: AlignImage[],
	mode: AlignMode,
	box: {w: number; h: number},
	origin: Frac2
): (PoseFit | undefined)[] {
	if (mode === 'off') {
		return images.map(() => undefined);
	}

	if (mode === 'step') {
		return images.map(image =>
			image.feet ? feetFit(image.feet, image, box, origin) : undefined
		);
	}

	const found = images.filter(image => image.feet);

	if (found.length === 0) {
		return images.map(() => undefined);
	}

	const shared: Feet = {
		x: found.reduce((sum, image) => sum + image.feet!.x, 0) / found.length,
		y: Math.max(...found.map(image => image.feet!.y))
	};

	return images.map(image => feetFit(shared, image, box, origin));
}
