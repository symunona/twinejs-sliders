/**
 * The pixel side of the asset editor. Kept free of React and of the DOM where
 * possible so the maths can be tested on its own.
 */
import type {
	CropRect,
	CutoutTuning,
	Frac2,
	ImageEdits
} from '@sliders/scene-types';
import {axisSize, blendSeam, seamWidth, tiledSize} from './tile-edits';

// The shapes live in scene-types because `AssetMeta` carries them: an edited asset stores
// what it was edited with, so the editor can re-open it. Re-exported here because this is
// where everything that acts on them lives.
export type {CropRect, ImageEdits};

export const GAMMA_RANGE = {max: 3, min: 0.1, step: 0.05};
export const LEVEL_RANGE = {max: 100, min: -100, step: 1};
export const HUE_RANGE = {max: 180, min: -180, step: 1};
/** One-sided: `pop` only ever adds. Taking it away is what `contrast` is for. */
export const POP_RANGE = {max: 100, min: 0, step: 1};

export function defaultEdits(width: number, height: number): ImageEdits {
	return {
		brightness: 0,
		contrast: 0,
		crop: {x: 0, y: 0, w: width, h: height},
		gamma: 1,
		height,
		width
	};
}

/** The adjustments one grey curve can express, in the order the curve applies them. */
const TONE_KEYS = [
	'brightness',
	'contrast',
	'gamma',
	'shadows',
	'highlights',
	'pop'
] as const;

/** The adjustments that need all three channels at once, and so a colour matrix. */
const MATRIX_KEYS = ['saturation', 'hue'] as const;

/** The adjustments that pull the channels apart, and so one curve per channel. */
const CHANNEL_KEYS = ['warmth', 'tint'] as const;

/** What an adjustment reads as when it is absent, which for gamma is not zero. */
function level(edits: ImageEdits, key: AdjustKey): number {
	return key === 'gamma' ? edits.gamma : edits[key] ?? 0;
}

type AdjustKey =
	| (typeof TONE_KEYS)[number]
	| (typeof MATRIX_KEYS)[number]
	| (typeof CHANNEL_KEYS)[number];

const ADJUST_KEYS: readonly AdjustKey[] = [
	...TONE_KEYS,
	...MATRIX_KEYS,
	...CHANNEL_KEYS
];

/** True when the grey curve is the identity, so one table can serve all three channels. */
function neutralTone(edits: ImageEdits): boolean {
	return TONE_KEYS.every(
		key => level(edits, key) === (key === 'gamma' ? 1 : 0)
	);
}

/** True when the adjustment sliders are all at rest, so the pixel pass can be skipped. */
export function isNeutral(edits: ImageEdits): boolean {
	return ADJUST_KEYS.every(
		key => level(edits, key) === (key === 'gamma' ? 1 : 0)
	);
}

/**
 * The size the saved picture actually comes out at.
 *
 * `edits.width`/`edits.height` are what the sizing controls ask for; a seam overlap then
 * eats into one of them, so everything that reports a size to the author has to ask here
 * rather than read the fields.
 */
export function outputSize(edits: ImageEdits): {height: number; width: number} {
	return tiledSize(edits, edits.tile, edits.tileAxis);
}

/** True when saving would only re-encode the asset, not change it. */
export function isUnedited(edits: ImageEdits, width: number, height: number) {
	return (
		isNeutral(edits) &&
		!seamWidth(axisSize(edits, edits.tileAxis), edits.tile) &&
		edits.crop.x === 0 &&
		edits.crop.y === 0 &&
		edits.crop.w === width &&
		edits.crop.h === height &&
		edits.width === width &&
		edits.height === height
	);
}

/** Keeps a crop rectangle inside the image, and at least one pixel wide. */
export function clampCrop(
	crop: CropRect,
	width: number,
	height: number
): CropRect {
	const x = Math.round(Math.min(Math.max(0, crop.x), width - 1));
	const y = Math.round(Math.min(Math.max(0, crop.y), height - 1));

	return {
		x,
		y,
		w: Math.round(Math.min(Math.max(1, crop.w), width - x)),
		h: Math.round(Math.min(Math.max(1, crop.h), height - y))
	};
}

/** The crop a drag from one point to another describes. */
export function cropFromDrag(
	from: {x: number; y: number},
	to: {x: number; y: number},
	width: number,
	height: number
): CropRect {
	return clampCrop(
		{
			h: Math.abs(to.y - from.y),
			w: Math.abs(to.x - from.x),
			x: Math.min(from.x, to.x),
			y: Math.min(from.y, to.y)
		},
		width,
		height
	);
}

/** What `buildLut` needs. Spelled out so a test can hand it three numbers. */
export type ToneEdits = Pick<ImageEdits, (typeof TONE_KEYS)[number]>;

/**
 * A 256-entry lookup table for the tonal adjustments: brightness, contrast and gamma,
 * then the three that only touch one end of the range — shadows, highlights and pop.
 *
 * One table covers every channel, which is what makes a full-size preview cheap enough to
 * redraw as a slider is dragged. The tonal half of the panel is deliberately everything
 * that can live in a table like this; hue and saturation cannot, and cost a matrix.
 */
export function buildLut(tone: ToneEdits): Uint8ClampedArray {
	const lut = new Uint8ClampedArray(256);
	const offset = ((tone.brightness ?? 0) / 100) * 255;
	// The usual contrast factor, which keeps 128 fixed and can't blow up until
	// contrast reaches its 100 limit.
	const level = Math.min(Math.max(tone.contrast ?? 0, -100), 100) * 2.55;
	const factor = (259 * (level + 255)) / (255 * (259 - level));
	const exponent =
		1 / Math.min(Math.max(tone.gamma ?? 1, GAMMA_RANGE.min), GAMMA_RANGE.max);
	// Gains chosen so that every one of these curves stays monotonic at its limit: a
	// slider that can reorder two tones turns a gradient inside out, which reads as
	// corruption rather than as a strong edit.
	const shadows = (clampLevel(tone.shadows) / 100) * 0.25;
	const highlights = (clampLevel(tone.highlights) / 100) * 0.25;
	const pop = Math.min(Math.max(tone.pop ?? 0, 0), 100) / 100;

	for (let value = 0; value < 256; value++) {
		const shifted = factor * (value + offset - 128) + 128;
		let unit = Math.pow(Math.max(0, shifted) / 255, exponent);

		// Weighted by how dark (or how light) the pixel already is, so each of these two
		// leaves the other end of the range alone -- that is the whole point of having them
		// as well as brightness.
		unit += shadows * (1 - unit) * (1 - unit);
		unit += highlights * unit * unit;
		// Smoothstep: fixed at both ends, steeper through the middle. Mixed in rather than
		// replacing, so `pop` is a dial and not a switch.
		unit += pop * 0.5 * (smoothstep(unit) - unit);

		// Uint8ClampedArray rounds and clamps on assignment.
		lut[value] = 255 * unit;
	}

	return lut;
}

/**
 * The tone curve, once per channel, with warmth and tint folded in as a push on the
 * channels that name those axes: warmth trades blue for red, tint trades magenta for
 * green. Both ride on top of the curve, so they grade the picture the sliders above them
 * produced.
 */
export function buildChannelLuts(edits: ImageEdits): {
	r: Uint8ClampedArray;
	g: Uint8ClampedArray;
	b: Uint8ClampedArray;
} {
	const tone = buildLut(edits);
	const warmth = (clampLevel(edits.warmth) / 100) * 40;
	const tint = (clampLevel(edits.tint) / 100) * 40;

	if (warmth === 0 && tint === 0) {
		// The common case, and worth catching: three references to one table cost nothing
		// and `applyChannelLuts` does not care that they are the same object.
		return {b: tone, g: tone, r: tone};
	}

	return {
		// Tint is split across red and blue against green so that it moves the hue without
		// also moving the brightness, the way warmth's opposed pair already does.
		b: shiftLut(tone, -warmth - tint / 2),
		g: shiftLut(tone, tint),
		r: shiftLut(tone, warmth - tint / 2)
	};
}

/**
 * A 3x3 colour matrix for saturation and hue, in that order.
 *
 * Both are the matrices the CSS filter spec gives for `saturate()` and `hue-rotate()`, so
 * these two sliders land where the equivalent `filter:` would. Worth keeping that way:
 * anything that wants to preview a grade without baking it can say it in CSS and get the
 * same picture.
 *
 * `pop` lifts saturation a little as well as bending the curve. Google Photos' slider of
 * that name does the same, and it is the reason it reads as "pop" rather than "contrast".
 */
export function buildColorMatrix(edits: ImageEdits): number[] {
	const pop = Math.min(Math.max(edits.pop ?? 0, 0), 100) / 100;
	const saturation =
		(1 + clampLevel(edits.saturation) / 100) * (1 + pop * 0.25);
	const radians =
		(Math.min(Math.max(edits.hue ?? 0, HUE_RANGE.min), HUE_RANGE.max) *
			Math.PI) /
		180;

	return multiply(saturateMatrix(saturation), hueMatrix(radians));
}

/** True when `buildColorMatrix` would return the identity. */
function neutralMatrix(edits: ImageEdits): boolean {
	return (
		(edits.hue ?? 0) === 0 &&
		(edits.saturation ?? 0) === 0 &&
		(edits.pop ?? 0) === 0
	);
}

/** Applies a LUT to RGB in place. Alpha is left alone. */
export function applyLut(pixels: Uint8ClampedArray, lut: Uint8ClampedArray) {
	applyChannelLuts(pixels, {b: lut, g: lut, r: lut});
}

/** Applies one LUT per channel in place. Alpha is left alone. */
export function applyChannelLuts(
	pixels: Uint8ClampedArray,
	luts: {r: Uint8ClampedArray; g: Uint8ClampedArray; b: Uint8ClampedArray}
) {
	for (let index = 0; index < pixels.length; index += 4) {
		pixels[index] = luts.r[pixels[index]];
		pixels[index + 1] = luts.g[pixels[index + 1]];
		pixels[index + 2] = luts.b[pixels[index + 2]];
	}
}

/** Applies a 3x3 colour matrix to RGB in place. Alpha is left alone. */
export function applyColorMatrix(pixels: Uint8ClampedArray, matrix: number[]) {
	for (let index = 0; index < pixels.length; index += 4) {
		const r = pixels[index];
		const g = pixels[index + 1];
		const b = pixels[index + 2];

		// Read all three out first: each output channel mixes all three inputs, so writing
		// red back before blue is read would feed a graded red into blue's sum.
		pixels[index] = matrix[0] * r + matrix[1] * g + matrix[2] * b;
		pixels[index + 1] = matrix[3] * r + matrix[4] * g + matrix[5] * b;
		pixels[index + 2] = matrix[6] * r + matrix[7] * g + matrix[8] * b;
	}
}

/** Everything the colour panel does, to one buffer, in panel order. */
export function applyAdjustments(pixels: Uint8ClampedArray, edits: ImageEdits) {
	if (
		!neutralTone(edits) ||
		(edits.warmth ?? 0) !== 0 ||
		(edits.tint ?? 0) !== 0
	) {
		applyChannelLuts(pixels, buildChannelLuts(edits));
	}

	if (!neutralMatrix(edits)) {
		applyColorMatrix(pixels, buildColorMatrix(edits));
	}
}

/** -100..100, and 0 for an absent slider. */
function clampLevel(value?: number): number {
	return Math.min(Math.max(value ?? 0, LEVEL_RANGE.min), LEVEL_RANGE.max);
}

/** The usual 3x-squared-minus-2x-cubed ease, on 0..1. Fixed at both ends. */
function smoothstep(unit: number): number {
	const clamped = Math.min(Math.max(unit, 0), 1);

	return clamped * clamped * (3 - 2 * clamped);
}

/** A copy of a LUT with every entry pushed by `offset` 0..255 units. */
function shiftLut(lut: Uint8ClampedArray, offset: number): Uint8ClampedArray {
	const shifted = new Uint8ClampedArray(256);

	for (let value = 0; value < 256; value++) {
		shifted[value] = lut[value] + offset;
	}

	return shifted;
}

/** How much each channel weighs in the luminance these two matrices preserve. */
const LUMA = {b: 0.072, g: 0.715, r: 0.213};

/** `saturate()` from the CSS filter spec. */
function saturateMatrix(amount: number): number[] {
	const s = Math.max(0, amount);

	return [
		LUMA.r + (1 - LUMA.r) * s,
		LUMA.g - LUMA.g * s,
		LUMA.b - LUMA.b * s,
		LUMA.r - LUMA.r * s,
		LUMA.g + (1 - LUMA.g) * s,
		LUMA.b - LUMA.b * s,
		LUMA.r - LUMA.r * s,
		LUMA.g - LUMA.g * s,
		LUMA.b + (1 - LUMA.b) * s
	];
}

/** `hue-rotate()` from the CSS filter spec, which is where the odd constants come from. */
function hueMatrix(radians: number): number[] {
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	return [
		0.213 + cos * 0.787 - sin * 0.213,
		0.715 - cos * 0.715 - sin * 0.715,
		0.072 - cos * 0.072 + sin * 0.928,
		0.213 - cos * 0.213 + sin * 0.143,
		0.715 + cos * 0.285 + sin * 0.14,
		0.072 - cos * 0.072 - sin * 0.283,
		0.213 - cos * 0.213 - sin * 0.787,
		0.715 - cos * 0.715 + sin * 0.715,
		0.072 + cos * 0.928 + sin * 0.072
	];
}

/** Two 3x3 matrices, as one that does `a` after `b`. */
function multiply(a: number[], b: number[]): number[] {
	const out = new Array<number>(9);

	for (let row = 0; row < 3; row++) {
		for (let column = 0; column < 3; column++) {
			out[row * 3 + column] =
				a[row * 3] * b[column] +
				a[row * 3 + 1] * b[3 + column] +
				a[row * 3 + 2] * b[6 + column];
		}
	}

	return out;
}

/**
 * Draws the source through the edits. `scale` renders a smaller copy for the
 * live preview; saving uses the default of 1.
 */
export function drawEdited(
	source: CanvasImageSource,
	edits: ImageEdits,
	target: HTMLCanvasElement,
	scale = 1
) {
	const width = Math.max(1, Math.round(edits.width * scale));
	const height = Math.max(1, Math.round(edits.height * scale));
	const context = target.getContext('2d');

	if (!context) {
		throw new Error('Could not get a 2D context to draw this image.');
	}

	target.width = width;
	target.height = height;
	context.clearRect(0, 0, width, height);
	context.imageSmoothingQuality = 'high';
	context.drawImage(
		source,
		edits.crop.x,
		edits.crop.y,
		edits.crop.w,
		edits.crop.h,
		0,
		0,
		width,
		height
	);

	// Measured against the size just drawn, not against `edits.width`/`edits.height`: a
	// preview is drawn at a scale, and an overlap held as a fraction is the same overlap at
	// any of them.
	const seam = seamWidth(axisSize({height, width}, edits.tileAxis), edits.tile);

	if (isNeutral(edits) && seam === 0) {
		return;
	}

	const image = context.getImageData(0, 0, width, height);

	if (!isNeutral(edits)) {
		applyAdjustments(image.data, edits);
	}

	if (seam === 0) {
		context.putImageData(image, 0, 0);
		return;
	}

	// The seam is folded in LAST, over the finished picture. Anything else would fold one
	// edge over the other and then brighten the two of them differently.
	const tiled = blendSeam(image.data, width, height, seam, edits.tileAxis);

	// Shrinking the canvas clears it, which is exactly what should happen: the strip that
	// went into the overlap is not part of the picture any more.
	target.width = tiled.width;
	target.height = tiled.height;
	context.putImageData(
		new ImageData(tiled.data, tiled.width, tiled.height),
		0,
		0
	);
}

/**
 * Dims everything outside the crop, on the canvas itself. Drawing it here
 * rather than as an overlay element keeps it aligned with the image no matter
 * how the canvas is letterboxed in its container.
 */
export function drawCropOverlay(
	target: HTMLCanvasElement,
	crop: CropRect,
	scale: number,
	color: string
) {
	const context = target.getContext('2d');

	if (!context) {
		return;
	}

	const x = crop.x * scale;
	const y = crop.y * scale;
	const width = crop.w * scale;
	const height = crop.h * scale;

	context.save();
	context.fillStyle = 'rgba(0, 0, 0, 0.5)';
	context.beginPath();
	context.rect(0, 0, target.width, target.height);
	context.rect(x, y, width, height);
	context.fill('evenodd');
	context.lineWidth = 2;
	context.strokeStyle = color;
	context.strokeRect(x, y, width, height);
	context.restore();
}

/**
 * An anchor, moved from the source image's coordinates into the cropped image's.
 *
 * The editor shows the whole source with the crop drawn over it, so an anchor is placed
 * against the source — but what gets saved is the crop, and the same fraction of a smaller
 * picture is a different point. Output resizing needs no part in this: scaling the crop
 * uniformly leaves every fraction of it where it was.
 *
 * An anchor outside the crop clamps to the nearest edge. It is the honest answer — the
 * point it named is not in the image any more — and it keeps the value inside 0..1, which
 * everything downstream assumes.
 */
export function anchorAfterCrop(
	origin: Frac2,
	crop: CropRect,
	sourceWidth: number,
	sourceHeight: number
): Frac2 {
	if (!(crop.w > 0) || !(crop.h > 0)) {
		return origin;
	}

	return {
		x: clampFraction((origin.x * sourceWidth - crop.x) / crop.w),
		y: clampFraction((origin.y * sourceHeight - crop.y) / crop.h)
	};
}

/**
 * The inverse of `anchorAfterCrop`: a stored anchor put back into the source image's
 * coordinates.
 *
 * Re-opening an edit shows the WHOLE original again with the crop drawn over it, but what
 * was saved is an anchor against the cropped picture. Without this the editor would place
 * the anchor as if the crop had never happened and then fold the crop in a second time on
 * the way out, walking the anchor further into the corner with every round trip.
 *
 * Not loss-free: an anchor that was clamped to a crop edge stays on that edge, because
 * the point it originally named is genuinely no longer recorded anywhere.
 */
export function anchorBeforeCrop(
	stored: Frac2,
	crop: CropRect,
	sourceWidth: number,
	sourceHeight: number
): Frac2 {
	if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
		return stored;
	}

	return {
		x: clampFraction((crop.x + stored.x * crop.w) / sourceWidth),
		y: clampFraction((crop.y + stored.y * crop.h) / sourceHeight)
	};
}

/** True when two edits would render the same picture. */
export function sameEdits(a: ImageEdits, b: ImageEdits): boolean {
	return (
		// Absent and zero are the same picture for everything but gamma, and only one of
		// them is ever written to the meta.
		ADJUST_KEYS.every(key => level(a, key) === level(b, key)) &&
		// Same for the tile axis, whose absence is `x`--and which means nothing at all when
		// there is no overlap to point anywhere.
		(a.tile ?? 0) === (b.tile ?? 0) &&
		(!a.tile || (a.tileAxis ?? 'x') === (b.tileAxis ?? 'x')) &&
		a.width === b.width &&
		a.height === b.height &&
		a.crop.x === b.crop.x &&
		a.crop.y === b.crop.y &&
		a.crop.w === b.crop.w &&
		a.crop.h === b.crop.h
	);
}

/** True when two tunings would composite the same cutout. Absent on both sides counts. */
export function sameTuning(a?: CutoutTuning, b?: CutoutTuning): boolean {
	if (!a || !b) {
		return !a && !b;
	}

	// `!!` on both sides: absent and false are the same cutout, and only one of them is
	// ever written to the meta.
	return (
		a.threshold === b.threshold &&
		a.softness === b.softness &&
		!!a.invert === !!b.invert
	);
}

/** Three decimals, the same precision the character editor's handles write. */
function clampFraction(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/** Promise-flavored `canvas.toBlob`. */
export function canvasBlob(
	canvas: HTMLCanvasElement,
	type = 'image/png'
): Promise<Blob> {
	return new Promise((resolve, reject) =>
		canvas.toBlob(blob => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error('Could not read the edited image back.'));
			}
		}, type)
	);
}
