/**
 * Import set: the browser half. Decoding, reading pixels, cutting slices. Nothing here is
 * provable under jest (jest-canvas-mock draws nothing) — the rules it feeds live in
 * `import-set-logic.ts`, and the pixels are checked in a real browser.
 */
import {blobBytes, sniffImage} from '@sliders/asset-store';
import {Pixels} from './import-set-logic';

export interface DecodedImage {
	/** Object URL, owned by whoever decoded it — `URL.revokeObjectURL` when done. */
	url: string;
	image: HTMLImageElement;
	width: number;
	height: number;
	animated: boolean;
}

export async function decodeImage(blob: Blob): Promise<DecodedImage> {
	let animated = false;

	try {
		animated = sniffImage(new Uint8Array(await blobBytes(blob))).animated;
	} catch {
		// Unknown bytes: let the <img> decide below.
	}

	const url = URL.createObjectURL(blob);
	const image = new Image();

	await new Promise<void>((resolve, reject) => {
		image.onload = () => resolve();
		image.onerror = () => reject(new Error('Could not decode image'));
		image.src = url;
	});

	return {
		animated,
		height: image.naturalHeight,
		image,
		url,
		width: image.naturalWidth
	};
}

/** RGBA of the whole image, or of one rect of it. */
export function readPixels(
	image: CanvasImageSource,
	rect: {x: number; y: number; w: number; h: number}
): Pixels | undefined {
	const canvas = document.createElement('canvas');

	canvas.width = rect.w;
	canvas.height = rect.h;

	const context = canvas.getContext('2d', {willReadFrequently: true});

	if (!context || rect.w < 1 || rect.h < 1) {
		return undefined;
	}

	context.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

	const data = context.getImageData(0, 0, rect.w, rect.h);

	return {data: data.data, height: data.height, width: data.width};
}

/** One cell of a sheet as its own PNG. */
export function sliceToBlob(
	image: CanvasImageSource,
	rect: {x: number; y: number; w: number; h: number}
): Promise<Blob> {
	const canvas = document.createElement('canvas');

	canvas.width = rect.w;
	canvas.height = rect.h;
	canvas
		.getContext('2d')
		?.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

	return new Promise((resolve, reject) =>
		canvas.toBlob(
			blob => (blob ? resolve(blob) : reject(new Error('Could not cut slice'))),
			'image/png'
		)
	);
}
