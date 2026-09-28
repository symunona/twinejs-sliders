/**
 * The three dedup tiers (plan 1, "Dedup and the content → hash function").
 *
 * - exact: sha256 of the bytes. The storage key.
 * - pixel: sha256 of the decoded RGBA. Same picture, any encoding.
 * - perceptual: 64-bit dHash. Resized or recompressed. Advisory only.
 *
 * Decoding is injected: the browser decodes through createImageBitmap, tests hand in a
 * decoder that needs neither a canvas nor a GPU.
 */

export interface DecodedImage {
	w: number;
	h: number;
	/** Row-major RGBA, 4 bytes a pixel. */
	rgba: Uint8Array | Uint8ClampedArray;
}

export type ImageDecoder = (
	bytes: Uint8Array,
	mime: string
) => Promise<DecodedImage>;

function webCrypto(): Crypto {
	const crypto = globalThis.crypto;

	if (!crypto?.subtle) {
		throw new Error(
			'This environment has no SubtleCrypto. Asset hashing requires a secure context.'
		);
	}

	return crypto;
}

function toHex(bytes: Uint8Array): string {
	let hex = '';

	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, '0');
	}

	return hex;
}

/** Lowercase hex sha256, 64 chars. */
export async function sha256Hex(
	source: Uint8Array | ArrayBuffer
): Promise<string> {
	const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
	// Copy into a standalone buffer: a view may not span its whole buffer.
	const digest = await webCrypto().subtle.digest(
		'SHA-256',
		new Uint8Array(bytes).buffer
	);

	return toHex(new Uint8Array(digest));
}

export const SHA_PATTERN = /^[0-9a-f]{64}$/;

export function isSha(value: unknown): value is string {
	return typeof value === 'string' && SHA_PATTERN.test(value);
}

/**
 * sha256 over width, height and the pixels.
 *
 * Fully transparent pixels hash as transparent black: encoders are free to keep or drop
 * the colour under alpha 0, and a re-encode that changes nothing visible must still match.
 */
export async function pixelHash(image: DecodedImage): Promise<string> {
	const {w, h, rgba} = image;
	const buffer = new Uint8Array(8 + w * h * 4);
	const view = new DataView(buffer.buffer);

	view.setUint32(0, w, true);
	view.setUint32(4, h, true);

	for (let i = 0; i < w * h * 4; i += 4) {
		if (rgba[i + 3] === 0) {
			continue;
		}

		buffer[8 + i] = rgba[i];
		buffer[8 + i + 1] = rgba[i + 1];
		buffer[8 + i + 2] = rgba[i + 2];
		buffer[8 + i + 3] = rgba[i + 3];
	}

	return sha256Hex(buffer);
}

/** Luma of one pixel, alpha-weighted against white so a cutout reads as its shape. */
function luma(rgba: DecodedImage['rgba'], index: number): number {
	const a = rgba[index + 3] / 255;
	const y =
		0.299 * rgba[index] + 0.587 * rgba[index + 1] + 0.114 * rgba[index + 2];

	return y * a + 255 * (1 - a);
}

/**
 * 64-bit difference hash: shrink to 9×8 greyscale by box average, then one bit per
 * horizontally adjacent pair, set when the left is darker than the right. 16 hex chars.
 */
export function dHash(image: DecodedImage): string {
	const {w, h, rgba} = image;
	const grid = new Float64Array(9 * 8);

	for (let gy = 0; gy < 8; gy++) {
		const y0 = Math.floor((gy * h) / 8);
		const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / 8));

		for (let gx = 0; gx < 9; gx++) {
			const x0 = Math.floor((gx * w) / 9);
			const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / 9));
			let sum = 0;
			let count = 0;

			for (let y = y0; y < Math.min(y1, h); y++) {
				for (let x = x0; x < Math.min(x1, w); x++) {
					sum += luma(rgba, (y * w + x) * 4);
					count++;
				}
			}

			grid[gy * 9 + gx] = count ? sum / count : 255;
		}
	}

	let hex = '';

	for (let gy = 0; gy < 8; gy++) {
		let byte = 0;

		for (let gx = 0; gx < 8; gx++) {
			byte = (byte << 1) | (grid[gy * 9 + gx] < grid[gy * 9 + gx + 1] ? 1 : 0);
		}

		hex += byte.toString(16).padStart(2, '0');
	}

	return hex;
}

/** Bits that differ between two equal-length hex strings. */
export function hamming(a: string, b: string): number {
	if (a.length !== b.length) {
		throw new Error(`Cannot compare hashes of different length: ${a} / ${b}`);
	}

	let distance = 0;

	for (let i = 0; i < a.length; i++) {
		let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);

		while (diff) {
			distance += diff & 1;
			diff >>= 1;
		}
	}

	return distance;
}

/** dHash distance at or under which two images are "probably the same picture". */
export const SIMILAR_DISTANCE = 6;

export function isImageMime(mime: string): boolean {
	return /^image\//.test(mime) && mime !== 'image/svg+xml';
}

/** Browser decoder: createImageBitmap + OffscreenCanvas. Not available under jest. */
export const browserDecoder: ImageDecoder = async (bytes, mime) => {
	const bitmap = await createImageBitmap(
		new Blob([new Uint8Array(bytes)], {type: mime})
	);
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext(
		'2d'
	) as OffscreenCanvasRenderingContext2D | null;

	if (!context) {
		throw new Error('OffscreenCanvas has no 2d context here.');
	}

	context.drawImage(bitmap, 0, 0);
	bitmap.close?.();

	const data = context.getImageData(0, 0, canvas.width, canvas.height);

	return {w: data.width, h: data.height, rgba: data.data};
};

/** What the three tiers say about one file. Sounds and undecodable files get sha only. */
export interface ContentHashes {
	sha: string;
	w?: number;
	h?: number;
	pixelHash?: string;
	phash?: string;
}

export async function hashContent(
	bytes: Uint8Array,
	mime: string,
	decoder?: ImageDecoder
): Promise<ContentHashes> {
	const sha = await sha256Hex(bytes);

	if (!decoder || !isImageMime(mime)) {
		return {sha};
	}

	try {
		const image = await decoder(bytes, mime);

		return {
			sha,
			w: image.w,
			h: image.h,
			pixelHash: await pixelHash(image),
			phash: dHash(image)
		};
	} catch {
		// An image the decoder cannot read still stores and syncs by its sha.
		return {sha};
	}
}
