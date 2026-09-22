/**
 * Making a picture loop: the maths behind the Seamless tool.
 *
 * `scroll_infinite_left/right` travels a whole frame and starts over, and the renderer
 * draws a second copy one frame ahead so the restart is invisible — but only if the art
 * itself tiles. A backdrop whose left and right edges do not match shows that mismatch
 * once per lap. This is the edit that makes them match.
 *
 * Kept free of the DOM, like the rest of `image-edits.ts`, so the blend can be tested on a
 * handful of pixels rather than through a canvas.
 */

/** The overlap slider's range, as a fraction of the picture's width. */
export const TILE_RANGE = {max: 0.5, min: 0, step: 0.01};

/**
 * How wide the overlap is in pixels, for a picture this wide.
 *
 * Stored as a fraction rather than a pixel count for the same reason a mask's feather is:
 * the overlap has to still mean the same thing after a resize, and it is applied to the
 * live preview at whatever scale that is being drawn at.
 *
 * Never the whole width: an overlap of everything leaves no picture to loop.
 */
export function seamWidth(width: number, blend: number | undefined): number {
	if (!blend || !(blend > 0) || !(width > 1)) {
		return 0;
	}

	return Math.min(width - 1, Math.max(1, Math.round(width * blend)));
}

/** The width the picture comes out at, once the overlap has been folded in. */
export function tiledWidth(width: number, blend: number | undefined): number {
	return Math.max(1, width - seamWidth(width, blend));
}

/**
 * Folds the right edge of a picture over its left edge, so the two ends meet.
 *
 * The overlap is not a fade to nothing at both ends — that would darken the join on any
 * picture with transparency, and lose a strip of content on every picture without. It is a
 * crossfade between two strips that are then the SAME strip: the last `seam` columns are
 * laid over the first `seam` columns and the picture is cut that much narrower, so the
 * column that used to follow the right edge is now column 0. Read round the loop, the join
 * is between two columns that were neighbours in the original.
 *
 * Blended through premultiplied alpha, so crossfading a cutout against its own other edge
 * does not drag a halo of invisible colour into the visible pixels.
 *
 * Returns fresh pixels rather than editing in place: the result is narrower than what came
 * in, and a caller holding an `ImageData` cannot resize it.
 */
export function blendSeam(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	seam: number
): {data: Uint8ClampedArray; width: number} {
	const out = Math.max(1, width - seam);

	if (seam <= 0 || out >= width) {
		return {data: pixels, width};
	}

	const data = new Uint8ClampedArray(out * height * 4);

	for (let y = 0; y < height; y++) {
		const row = y * width * 4;
		const target = y * out * 4;

		for (let x = 0; x < out; x++) {
			const at = target + x * 4;
			const left = row + x * 4;

			if (x >= seam) {
				// Past the overlap the picture is untouched, byte for byte.
				data[at] = pixels[left];
				data[at + 1] = pixels[left + 1];
				data[at + 2] = pixels[left + 2];
				data[at + 3] = pixels[left + 3];
				continue;
			}

			// The column `out` further along: the piece of the right edge that lands here.
			const right = row + (x + out) * 4;
			// Half a pixel in from each end, so the first column is nearly all right edge
			// and the last nearly all left, without either end landing exactly on a
			// weight of 1 — a one-pixel-wide overlap then still mixes.
			const mix = (x + 0.5) / seam;
			const rightAlpha = pixels[right + 3] * (1 - mix);
			const leftAlpha = pixels[left + 3] * mix;
			const alpha = rightAlpha + leftAlpha;

			if (alpha <= 0) {
				data[at] = 0;
				data[at + 1] = 0;
				data[at + 2] = 0;
				data[at + 3] = 0;
				continue;
			}

			for (let channel = 0; channel < 3; channel++) {
				data[at + channel] =
					(pixels[right + channel] * rightAlpha +
						pixels[left + channel] * leftAlpha) /
					alpha;
			}

			data[at + 3] = alpha;
		}
	}

	return {data, width: out};
}
