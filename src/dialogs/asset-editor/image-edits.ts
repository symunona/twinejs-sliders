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

/** True when the adjustment sliders are all at rest, so the LUT can be skipped. */
export function isNeutral(edits: ImageEdits): boolean {
	return (
		edits.brightness === 0 && edits.contrast === 0 && edits.gamma === 1
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

/**
 * A 256-entry lookup table for brightness, then contrast, then gamma. One table
 * covers every channel, which is what makes a full-size preview cheap enough to
 * redraw as a slider is dragged.
 */
export function buildLut(
	brightness: number,
	contrast: number,
	gamma: number
): Uint8ClampedArray {
	const lut = new Uint8ClampedArray(256);
	const offset = (brightness / 100) * 255;
	// The usual contrast factor, which keeps 128 fixed and can't blow up until
	// contrast reaches its 100 limit.
	const level = Math.min(Math.max(contrast, -100), 100) * 2.55;
	const factor = (259 * (level + 255)) / (255 * (259 - level));
	const exponent = 1 / Math.min(Math.max(gamma, GAMMA_RANGE.min), GAMMA_RANGE.max);

	for (let value = 0; value < 256; value++) {
		const shifted = factor * (value + offset - 128) + 128;

		// Uint8ClampedArray rounds and clamps on assignment.
		lut[value] = 255 * Math.pow(Math.max(0, shifted) / 255, exponent);
	}

	return lut;
}

/** Applies a LUT to RGB in place. Alpha is left alone. */
export function applyLut(pixels: Uint8ClampedArray, lut: Uint8ClampedArray) {
	for (let index = 0; index < pixels.length; index += 4) {
		pixels[index] = lut[pixels[index]];
		pixels[index + 1] = lut[pixels[index + 1]];
		pixels[index + 2] = lut[pixels[index + 2]];
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
		applyLut(
			image.data,
			buildLut(edits.brightness, edits.contrast, edits.gamma)
		);
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
		a.brightness === b.brightness &&
		a.contrast === b.contrast &&
		a.gamma === b.gamma &&
		// Absent and zero are the same picture, and only one of them is ever written to
		// the meta. Same for the axis, whose absence is `x`--and which means nothing at all
		// when there is no overlap to point anywhere.
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
