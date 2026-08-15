import {BackgroundMask} from './engine-types';

/**
 * Turning a small mask into a full-size alpha channel. A model reasons at
 * 320 or 1024 pixels square whatever you feed it, so the mask always has to be
 * enlarged--and enlarging is a blur, which is exactly what makes cheap cutouts
 * look like cheap cutouts.
 *
 * The fix is to enlarge, then pull the soft edge back onto the edges the
 * full-size image actually has, using a guided filter with the image's own luma
 * as the guide. It can't invent detail the model never saw, but it stops the
 * boundary from floating a few pixels away from the subject.
 */

/** Longest edge the refinement runs at. Past this the cost stops being worth it. */
const MAX_REFINE = 2048;

/**
 * Mean of a square window, done as two O(n) sliding passes. Windows are clipped
 * at the edges and divided by the count actually summed, so borders don't
 * darken.
 */
export function boxBlur(
	source: Float32Array,
	width: number,
	height: number,
	radius: number
): Float32Array {
	const horizontal = new Float32Array(source.length);
	const result = new Float32Array(source.length);

	for (let y = 0; y < height; y++) {
		const row = y * width;
		let sum = 0;
		let count = 0;

		for (let x = 0; x <= radius && x < width; x++) {
			sum += source[row + x];
			count++;
		}

		for (let x = 0; x < width; x++) {
			horizontal[row + x] = sum / count;

			const add = x + radius + 1;
			const drop = x - radius;

			if (add < width) {
				sum += source[row + add];
				count++;
			}

			if (drop >= 0) {
				sum -= source[row + drop];
				count--;
			}
		}
	}

	for (let x = 0; x < width; x++) {
		let sum = 0;
		let count = 0;

		for (let y = 0; y <= radius && y < height; y++) {
			sum += horizontal[y * width + x];
			count++;
		}

		for (let y = 0; y < height; y++) {
			result[y * width + x] = sum / count;

			const add = y + radius + 1;
			const drop = y - radius;

			if (add < height) {
				sum += horizontal[add * width + x];
				count++;
			}

			if (drop >= 0) {
				sum -= horizontal[drop * width + x];
				count--;
			}
		}
	}

	return result;
}

/**
 * He, Sun and Tang's guided filter. `input` is the enlarged mask, `guide` is
 * the image luma at the same size; the output follows the guide's edges while
 * keeping the mask's values.
 */
export function guidedFilter(
	guide: Float32Array,
	input: Float32Array,
	width: number,
	height: number,
	radius: number,
	epsilon: number
): Float32Array {
	const count = width * height;
	const guideInput = new Float32Array(count);
	const guideSquared = new Float32Array(count);

	for (let index = 0; index < count; index++) {
		guideInput[index] = guide[index] * input[index];
		guideSquared[index] = guide[index] * guide[index];
	}

	const meanGuide = boxBlur(guide, width, height, radius);
	const meanInput = boxBlur(input, width, height, radius);
	const meanGuideInput = boxBlur(guideInput, width, height, radius);
	const meanGuideSquared = boxBlur(guideSquared, width, height, radius);
	const slope = new Float32Array(count);
	const offset = new Float32Array(count);

	for (let index = 0; index < count; index++) {
		const variance =
			meanGuideSquared[index] - meanGuide[index] * meanGuide[index];
		const covariance =
			meanGuideInput[index] - meanGuide[index] * meanInput[index];

		slope[index] = covariance / (variance + epsilon);
		offset[index] = meanInput[index] - slope[index] * meanGuide[index];
	}

	const meanSlope = boxBlur(slope, width, height, radius);
	const meanOffset = boxBlur(offset, width, height, radius);
	const result = new Float32Array(count);

	for (let index = 0; index < count; index++) {
		result[index] = Math.min(
			1,
			Math.max(0, meanSlope[index] * guide[index] + meanOffset[index])
		);
	}

	return result;
}

/** Bilinear enlargement of a mask to an arbitrary size. */
export function upsampleMask(
	mask: BackgroundMask,
	width: number,
	height: number
): Float32Array {
	const result = new Float32Array(width * height);
	const scaleX = mask.width / width;
	const scaleY = mask.height / height;

	for (let y = 0; y < height; y++) {
		const sourceY = Math.min(
			mask.height - 1,
			Math.max(0, (y + 0.5) * scaleY - 0.5)
		);
		const topRow = Math.floor(sourceY);
		const bottomRow = Math.min(mask.height - 1, topRow + 1);
		const downWeight = sourceY - topRow;

		for (let x = 0; x < width; x++) {
			const sourceX = Math.min(
				mask.width - 1,
				Math.max(0, (x + 0.5) * scaleX - 0.5)
			);
			const leftColumn = Math.floor(sourceX);
			const rightColumn = Math.min(mask.width - 1, leftColumn + 1);
			const rightWeight = sourceX - leftColumn;
			const top =
				mask.data[topRow * mask.width + leftColumn] * (1 - rightWeight) +
				mask.data[topRow * mask.width + rightColumn] * rightWeight;
			const bottom =
				mask.data[bottomRow * mask.width + leftColumn] * (1 - rightWeight) +
				mask.data[bottomRow * mask.width + rightColumn] * rightWeight;

			result[y * width + x] = top * (1 - downWeight) + bottom * downWeight;
		}
	}

	return result;
}

export interface MaskBounds {
	/** Fractions of the mask, 0 to 1. */
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * Where the subject is, as fractions. Used to decide whether a second pass at
 * closer range is worth running.
 */
export function maskBounds(
	mask: BackgroundMask,
	threshold = 0.5,
	padding = 0.04
): MaskBounds | undefined {
	let left = mask.width;
	let top = mask.height;
	let right = -1;
	let bottom = -1;

	for (let y = 0; y < mask.height; y++) {
		for (let x = 0; x < mask.width; x++) {
			if (mask.data[y * mask.width + x] >= threshold) {
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
		}
	}

	if (right < 0) {
		return undefined;
	}

	return {
		bottom: Math.min(1, (bottom + 1) / mask.height + padding),
		left: Math.max(0, left / mask.width - padding),
		right: Math.min(1, (right + 1) / mask.width + padding),
		top: Math.max(0, top / mask.height - padding)
	};
}

/**
 * Pulls the alpha back to fully clear and fully solid.
 *
 * The guided filter alone does not sharpen anything--measured, it leaves the
 * error against a known edge unchanged. What it produces is a *step* whose two
 * levels are the window means of the smeared mask, so a 0-to-1 edge comes back
 * as roughly 0.25-to-0.75: correctly placed, but washed out. This is the half
 * that turns that back into an edge. Neither half is useful without the other.
 *
 * The cost is honest: genuinely translucent alpha--glass, motion blur, the
 * soft end of hair--gets crushed toward opaque or clear. For sprite art that's
 * the right trade.
 */
export function applyEdgeContrast(
	alpha: Float32Array,
	low = 0.35,
	high = 0.65
): Float32Array {
	const result = new Float32Array(alpha.length);

	for (let index = 0; index < alpha.length; index++) {
		const t = Math.min(1, Math.max(0, (alpha[index] - low) / (high - low)));

		// Smoothstep, so the edge stays anti-aliased instead of going jagged.
		result[index] = t * t * (3 - 2 * t);
	}

	return result;
}

/** Perceptual luma, 0 to 1, from RGBA bytes. */
export function lumaFrom(pixels: Uint8ClampedArray): Float32Array {
	const luma = new Float32Array(pixels.length / 4);

	for (let index = 0; index < luma.length; index++) {
		luma[index] =
			(0.2126 * pixels[index * 4] +
				0.7152 * pixels[index * 4 + 1] +
				0.0722 * pixels[index * 4 + 2]) /
			255;
	}

	return luma;
}

/**
 * Enlarges a mask to the source's size and snaps it to the source's edges.
 * Huge images are refined at a working size and then enlarged again--the
 * refined alpha carries real edges, so enlarging *it* costs far less quality
 * than enlarging the raw mask would have.
 */
export function refineMask(
	source: HTMLCanvasElement,
	mask: BackgroundMask
): Float32Array {
	const scale = Math.min(1, MAX_REFINE / Math.max(source.width, source.height));
	const width = Math.max(1, Math.round(source.width * scale));
	const height = Math.max(1, Math.round(source.height * scale));
	const guideCanvas = document.createElement('canvas');

	guideCanvas.width = width;
	guideCanvas.height = height;

	const context = guideCanvas.getContext('2d');

	if (!context) {
		return upsampleMask(mask, source.width, source.height);
	}

	context.drawImage(source, 0, 0, width, height);

	// A 1024² model against a 900px asset hands back a mask denser than the
	// image, so there is no enlargement blur to undo and the work is wasted --
	// measured, refining a 512×1024 sprite moved edge error from 0.2079 to
	// 0.2074, which is nothing, while still flattening soft alpha. At 1600px
	// the same code cut edge error by a fifth, 0.0200 to 0.0161. Both axes
	// count: the mask is square whatever shape the image is, so a tall image
	// can be stretched vertically while its width fits.
	const factor = Math.max(width / mask.width, height / mask.height);

	if (factor < 1.25) {
		return upsampleMask(mask, source.width, source.height);
	}

	const guide = lumaFrom(context.getImageData(0, 0, width, height).data);
	const enlarged = upsampleMask(mask, width, height);
	// The window has to be wider than the mask is wrong. A mask off by one of
	// its own pixels is off by `factor` of ours, and measured against a known
	// edge the error only clears once the radius is around three times that;
	// below it the filter can't see the true edge and the mask's edge at once.
	// Capped, because a very wide window starts averaging across separate
	// objects and trades a soft edge for a halo.
	const radius = Math.min(32, Math.max(4, Math.round(factor * 3)));
	const refined = applyEdgeContrast(
		guidedFilter(guide, enlarged, width, height, radius, 1e-4)
	);

	if (width === source.width && height === source.height) {
		return refined;
	}

	return upsampleMask(
		{data: refined, height, width},
		source.width,
		source.height
	);
}
