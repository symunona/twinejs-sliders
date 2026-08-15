import {blobBytes} from './blob-bytes';
import {isTranscodable, sniffImage, SniffResult} from './sniff';

export const WEBP_QUALITY = 0.9;

// TypeScript 4.9's lib.dom is missing OffscreenCanvas.convertToBlob, and types its 2D
// context as the union of every rendering context. Narrow both here rather than sprinkle
// casts through the pipeline.
interface OffscreenCanvasWithConvert {
	getContext(contextId: '2d'): CanvasRenderingContext2D | null;
	convertToBlob(options?: {quality?: number; type?: string}): Promise<Blob>;
}

export interface PreparedUpload {
	/** What actually gets written to storage. */
	blob: Blob;
	mime: string;
	animated: boolean;
	width: number;
	height: number;
	/** True when the bytes were re-encoded rather than stored verbatim. */
	transcoded: boolean;
	sniffed: SniffResult;
}

function canTranscode(): boolean {
	return (
		typeof createImageBitmap === 'function' &&
		typeof OffscreenCanvas === 'function'
	);
}

/**
 * Measures an image without decoding it a second time where we can avoid it. Header
 * dimensions are trusted first because they work for animated files, where
 * `createImageBitmap` would only report the first frame.
 */
async function measure(
	blob: Blob,
	sniffed: SniffResult
): Promise<{width: number; height: number}> {
	if (sniffed.width && sniffed.height) {
		return {width: sniffed.width, height: sniffed.height};
	}

	if (typeof createImageBitmap === 'function') {
		try {
			const bitmap = await createImageBitmap(blob);
			const size = {width: bitmap.width, height: bitmap.height};

			bitmap.close?.();
			return size;
		} catch (error) {
			console.warn('Could not measure asset', error);
		}
	}

	return {width: 0, height: 0};
}

/**
 * Runs spec 03's upload pipeline:
 *
 *   File -> sniff header -> still?    -> decode -> OffscreenCanvas -> WebP (q 0.9)
 *                        -> animated? -> STORE AS-IS
 *
 * The animated branch is not an optimization. Canvas hands back a single frame, so
 * transcoding an animation would silently flatten it.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
	const buffer = await blobBytes(file);
	const sniffed = sniffImage(buffer);

	if (!isTranscodable(sniffed) || !canTranscode()) {
		const size = await measure(file, sniffed);

		return {
			blob: file,
			mime: sniffed.mime === 'application/octet-stream' ? file.type : sniffed.mime,
			animated: sniffed.animated,
			transcoded: false,
			sniffed,
			...size
		};
	}

	let bitmap: ImageBitmap;

	try {
		bitmap = await createImageBitmap(file);
	} catch (error) {
		// A file we can't decode still deserves to be stored — the author can see it's
		// broken in the library rather than have the upload vanish.
		console.warn('Could not decode asset, storing as-is', error);

		const size = await measure(file, sniffed);

		return {
			blob: file,
			mime: sniffed.mime,
			animated: sniffed.animated,
			transcoded: false,
			sniffed,
			...size
		};
	}

	const canvas = new OffscreenCanvas(
		bitmap.width,
		bitmap.height
	) as unknown as OffscreenCanvasWithConvert;
	const context = canvas.getContext('2d');

	if (!context) {
		bitmap.close?.();
		throw new Error('Could not get a 2D context to convert this image.');
	}

	context.drawImage(bitmap, 0, 0);

	const size = {width: bitmap.width, height: bitmap.height};

	bitmap.close?.();

	const blob = await canvas.convertToBlob({
		type: 'image/webp',
		quality: WEBP_QUALITY
	});

	// Some browsers ignore the requested type. Don't lie about what we stored.
	if (blob.type !== 'image/webp') {
		return {
			blob: file,
			mime: sniffed.mime,
			animated: sniffed.animated,
			transcoded: false,
			sniffed,
			...size
		};
	}

	return {
		blob,
		mime: 'image/webp',
		animated: false,
		transcoded: true,
		sniffed,
		...size
	};
}
