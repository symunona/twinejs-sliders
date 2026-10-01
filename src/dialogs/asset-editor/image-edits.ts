/**
 * The pixel side of the asset editor. Kept free of React and of the DOM where
 * possible so the maths can be tested on its own.
 */
import {
	BLUR_RANGE,
	buildChannelLuts,
	buildColorMatrix,
	buildLut,
	GAMMA_RANGE,
	HUE_RANGE,
	LEVEL_RANGE,
	POP_RANGE,
	TONE_KEYS
} from '@sliders/scene-types';
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

// The ranges and the curve/matrix maths live in scene-types (`grade.ts`) too: a scene's
// live `grade:` draws with the same functions this bakes with, and one copy is the only
// way the two cannot drift. Re-exported so the editor keeps importing them from here.
export {
	BLUR_RANGE,
	buildChannelLuts,
	buildColorMatrix,
	buildLut,
	GAMMA_RANGE,
	HUE_RANGE,
	LEVEL_RANGE,
	POP_RANGE
};

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

/** The adjustments that need all three channels at once, and so a colour matrix. */
const MATRIX_KEYS = ['saturation', 'hue'] as const;

/** The adjustments that pull the channels apart, and so one curve per channel. */
const CHANNEL_KEYS = ['warmth', 'tint'] as const;

/** The adjustments that look at neighbouring pixels, and so run over the whole buffer. */
const SPATIAL_KEYS = ['blur'] as const;

/** What an adjustment reads as when it is absent, which for gamma is not zero. */
function level(edits: ImageEdits, key: AdjustKey): number {
	return key === 'gamma' ? edits.gamma : edits[key] ?? 0;
}

type AdjustKey =
	| (typeof TONE_KEYS)[number]
	| (typeof MATRIX_KEYS)[number]
	| (typeof CHANNEL_KEYS)[number]
	| (typeof SPATIAL_KEYS)[number];

const ADJUST_KEYS: readonly AdjustKey[] = [
	...TONE_KEYS,
	...MATRIX_KEYS,
	...CHANNEL_KEYS,
	...SPATIAL_KEYS
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

/**
 * Blurs RGBA in place: three box passes each way, which is close enough to a Gaussian
 * that nobody can tell, and costs the same at any radius.
 *
 * Done on premultiplied colour, so a transparent pixel's leftover RGB cannot bleed a dark
 * fringe into a cutout's edge. Edges clamp -- the border pixel repeats outward -- so an
 * opaque backdrop stays opaque to its corners instead of fading to clear.
 */
export function applyBlur(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	radius: number
) {
	// Three boxes of width w have a variance of 3 * (w^2 - 1) / 12; solving for the sigma a
	// Gaussian of this radius would have (radius / 2) gives the half-width each box needs.
	const sigma = radius / 2;
	const half = Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2);

	if (half < 1 || width < 1 || height < 1) {
		return;
	}

	const count = width * height;
	const planes = [0, 1, 2, 3].map(() => new Float32Array(count));

	for (let index = 0; index < count; index++) {
		const alpha = pixels[index * 4 + 3] / 255;

		planes[0][index] = pixels[index * 4] * alpha;
		planes[1][index] = pixels[index * 4 + 1] * alpha;
		planes[2][index] = pixels[index * 4 + 2] * alpha;
		planes[3][index] = pixels[index * 4 + 3];
	}

	const scratch = new Float32Array(Math.max(width, height));

	for (const plane of planes) {
		for (let pass = 0; pass < 3; pass++) {
			for (let y = 0; y < height; y++) {
				boxLine(plane, y * width, 1, width, half, scratch);
			}

			for (let x = 0; x < width; x++) {
				boxLine(plane, x, width, height, half, scratch);
			}
		}
	}

	for (let index = 0; index < count; index++) {
		const alpha = planes[3][index];
		const unpremultiply = alpha > 0 ? 255 / alpha : 0;

		pixels[index * 4] = planes[0][index] * unpremultiply;
		pixels[index * 4 + 1] = planes[1][index] * unpremultiply;
		pixels[index * 4 + 2] = planes[2][index] * unpremultiply;
		pixels[index * 4 + 3] = alpha;
	}
}

/** One running-sum box pass along a row or column, edges clamped. */
function boxLine(
	plane: Float32Array,
	start: number,
	stride: number,
	length: number,
	half: number,
	scratch: Float32Array
) {
	const at = (offset: number) =>
		plane[start + Math.min(Math.max(offset, 0), length - 1) * stride];
	let sum = 0;

	for (let offset = -half; offset <= half; offset++) {
		sum += at(offset);
	}

	for (let offset = 0; offset < length; offset++) {
		scratch[offset] = sum;
		sum += at(offset + half + 1) - at(offset - half);
	}

	const span = 2 * half + 1;

	for (let offset = 0; offset < length; offset++) {
		plane[start + offset * stride] = scratch[offset] / span;
	}
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

	// After the grade, before the seam: the fold then blends two already-soft strips, and
	// the radius scales with the preview so a small copy looks like the saved one.
	const blur =
		Math.min(Math.max(edits.blur ?? 0, BLUR_RANGE.min), BLUR_RANGE.max) *
		(width / Math.max(1, edits.width));

	if (blur > 0) {
		applyBlur(image.data, width, height, blur);
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
