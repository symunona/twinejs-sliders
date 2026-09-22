/**
 * Storing a cutout's alpha map so it survives closing the editor.
 *
 * The model hands back a `Float32Array`, one value per source pixel. Stored raw that is
 * four bytes a pixel — 16 MB for a 2048-square backdrop — which is far too much to keep
 * beside every cut-out asset. A lossless PNG of the same data is a few hundred KB, and
 * eight bits is all the precision the map ever needed: `applyTuning` thresholds it.
 */

/**
 * Alpha written into the RGB channels, with the image left fully opaque.
 *
 * NOT into the alpha channel, which is the obvious place and the wrong one: a canvas
 * un-premultiplies on the way out of `getImageData`, so a round trip through a
 * transparent PNG quantises twice and drops RGB entirely wherever alpha is zero. An
 * opaque grayscale image comes back byte for byte.
 */
export function packAlpha(alpha: Float32Array): Uint8ClampedArray {
	const pixels = new Uint8ClampedArray(alpha.length * 4);

	for (let index = 0; index < alpha.length; index++) {
		// Uint8ClampedArray rounds and clamps on assignment, which is also what keeps a
		// NaN out of the map: it stores as 0.
		const value = alpha[index] * 255;
		const at = index * 4;

		pixels[at] = value;
		pixels[at + 1] = value;
		pixels[at + 2] = value;
		pixels[at + 3] = 255;
	}

	return pixels;
}

/** The inverse of `packAlpha`. Reads the red channel and ignores the rest. */
export function unpackAlpha(pixels: Uint8ClampedArray): Float32Array {
	const alpha = new Float32Array(pixels.length / 4);

	for (let index = 0; index < alpha.length; index++) {
		alpha[index] = pixels[index * 4] / 255;
	}

	return alpha;
}

/** The alpha map as a lossless PNG, ready to store as a sidecar. */
export async function encodeCutout(
	alpha: Float32Array,
	width: number,
	height: number
): Promise<Blob> {
	if (alpha.length !== width * height) {
		throw new Error(
			`This alpha map is ${alpha.length} values, not the ${width * height} a ${width}x${height} image needs.`
		);
	}

	const canvas = document.createElement('canvas');

	canvas.width = width;
	canvas.height = height;

	const context = canvas.getContext('2d');

	if (!context) {
		throw new Error('Could not get a 2D context to store this cutout.');
	}

	context.putImageData(
		new ImageData(packAlpha(alpha), width, height),
		0,
		0
	);

	return await new Promise<Blob>((resolve, reject) =>
		canvas.toBlob(blob => {
			if (blob) {
				resolve(blob);
			} else {
				reject(new Error('Could not read this cutout back.'));
			}
			// PNG, and never WebP: `toBlob` encodes WebP lossily by default, and a lossy
			// mask frays exactly at the edge the mask exists to describe.
		}, 'image/png')
	);
}

/** Reads a stored cutout back. Rejects nothing — a map that won't decode is just absent. */
export async function decodeCutout(
	blob: Blob
): Promise<{alpha: Float32Array; height: number; width: number} | undefined> {
	try {
		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');

		canvas.width = bitmap.width;
		canvas.height = bitmap.height;

		const context = canvas.getContext('2d');

		if (!context) {
			bitmap.close?.();
			return undefined;
		}

		context.drawImage(bitmap, 0, 0);

		const {height, width} = bitmap;

		bitmap.close?.();

		return {
			alpha: unpackAlpha(
				context.getImageData(0, 0, width, height).data
			),
			height,
			width
		};
	} catch (error) {
		// A corrupt or half-written map costs the author a re-run of the model, which is
		// slow but survivable. Failing to open the asset at all would not be.
		console.warn('Could not read this asset’s stored cutout', error);
		return undefined;
	}
}
