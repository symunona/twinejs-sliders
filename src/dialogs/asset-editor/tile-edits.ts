/**
 * Making a picture loop: the maths behind the Seamless tool.
 *
 * `scroll_infinite_*` travels a whole frame and starts over, and the renderer draws a
 * second copy one frame ahead so the restart is invisible — but only if the art itself
 * tiles. A backdrop whose two facing edges do not match shows that mismatch once per lap.
 * This is the edit that makes them match.
 *
 * Kept free of the DOM, like the rest of `image-edits.ts`, so the blend can be tested on a
 * handful of pixels rather than through a canvas.
 */
import type {TileAxis} from '@sliders/scene-types';

/** The overlap slider's range, as a fraction of the edge being folded. */
export const TILE_RANGE = {max: 0.5, min: 0, step: 0.01};

/** Sideways and downwards, in the order the buttons sit in. */
export const TILE_AXES: TileAxis[] = ['x', 'y'];

/**
 * Which of an image's two sizes an overlap eats into.
 *
 * `x` folds the right edge over the left and narrows the picture, for
 * `scroll_infinite_left`/`_right`. `y` folds the bottom over the top and shortens it, for
 * `_up`/`_down`.
 */
export function axisSize(
	size: {height: number; width: number},
	axis: TileAxis | undefined
): number {
	return axis === 'y' ? size.height : size.width;
}

/**
 * How wide the overlap is in pixels, for an edge this long.
 *
 * Stored as a fraction rather than a pixel count for the same reason a mask's feather is:
 * the overlap has to still mean the same thing after a resize, and it is applied to the
 * live preview at whatever scale that is being drawn at.
 *
 * Never the whole edge: an overlap of everything leaves no picture to loop.
 */
export function seamWidth(size: number, blend: number | undefined): number {
	if (!blend || !(blend > 0) || !(size > 1)) {
		return 0;
	}

	return Math.min(size - 1, Math.max(1, Math.round(size * blend)));
}

/** The size the picture comes out at, once the overlap has been folded in. */
export function tiledSize(
	size: {height: number; width: number},
	blend: number | undefined,
	axis: TileAxis | undefined
): {height: number; width: number} {
	const seam = seamWidth(axisSize(size, axis), blend);

	if (axis === 'y') {
		return {height: Math.max(1, size.height - seam), width: size.width};
	}

	return {height: size.height, width: Math.max(1, size.width - seam)};
}

/**
 * Folds one edge of a picture over the facing one, so the two ends meet.
 *
 * The overlap is not a fade to nothing at both ends — that would darken the join on any
 * picture with transparency, and lose a strip of content on every picture without. It is a
 * crossfade between two strips that are then the SAME strip: the last `seam` columns (or
 * rows) are laid over the first `seam` of them and the picture is cut that much smaller, so
 * the line that used to follow the far edge is now line 0. Read round the loop, the join is
 * between two lines that were neighbours in the original.
 *
 * Blended through premultiplied alpha, so crossfading a cutout against its own other edge
 * does not drag a halo of invisible colour into the visible pixels.
 *
 * Returns fresh pixels rather than editing in place: the result is smaller than what came
 * in, and a caller holding an `ImageData` cannot resize it.
 */
export function blendSeam(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	seam: number,
	axis: TileAxis = 'x'
): {data: Uint8ClampedArray; height: number; width: number} {
	const vertical = axis === 'y';
	const out = Math.max(1, (vertical ? height : width) - seam);

	if (seam <= 0 || out >= (vertical ? height : width)) {
		return {data: pixels, height, width};
	}

	const outWidth = vertical ? width : out;
	const outHeight = vertical ? out : height;
	const data = new Uint8ClampedArray(outWidth * outHeight * 4);

	for (let y = 0; y < outHeight; y++) {
		for (let x = 0; x < outWidth; x++) {
			const at = (y * outWidth + x) * 4;
			// Where this pixel sits in the source. Only the axis being folded is shifted,
			// so the other one indexes into the same place it always did.
			const near = (y * width + x) * 4;
			// How far into the edge being folded this pixel is. Everything past the
			// overlap is untouched, byte for byte.
			const depth = vertical ? y : x;

			if (depth >= seam) {
				data[at] = pixels[near];
				data[at + 1] = pixels[near + 1];
				data[at + 2] = pixels[near + 2];
				data[at + 3] = pixels[near + 3];
				continue;
			}

			// The line `out` further along: the piece of the far edge that lands here.
			const far = vertical
				? ((y + out) * width + x) * 4
				: (y * width + x + out) * 4;
			// Half a pixel in from each end, so the first line is nearly all far edge and
			// the last nearly all near, without either end landing exactly on a weight of
			// 1 — a one-pixel-wide overlap then still mixes.
			const mix = (depth + 0.5) / seam;
			const farAlpha = pixels[far + 3] * (1 - mix);
			const nearAlpha = pixels[near + 3] * mix;
			const alpha = farAlpha + nearAlpha;

			if (alpha <= 0) {
				data[at] = 0;
				data[at + 1] = 0;
				data[at + 2] = 0;
				data[at + 3] = 0;
				continue;
			}

			for (let channel = 0; channel < 3; channel++) {
				data[at + channel] =
					(pixels[far + channel] * farAlpha +
						pixels[near + channel] * nearAlpha) /
					alpha;
			}

			data[at + 3] = alpha;
		}
	}

	return {data, height: outHeight, width: outWidth};
}
