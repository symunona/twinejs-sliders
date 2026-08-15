/**
 * Header sniffing for uploaded images.
 *
 * The whole point of this module is spec 03's trap: canvas cannot re-encode an animated
 * image. It silently hands back a single frame. So before anything touches
 * `createImageBitmap`, we look at the bytes and decide whether the file is animated. If it
 * is, the upload pipeline stores it verbatim.
 */

export type SniffedFormat = 'gif' | 'png' | 'webp' | 'jpeg' | 'svg' | 'unknown';

export interface SniffResult {
	format: SniffedFormat;
	mime: string;
	/** True when the file contains more than one frame. Never guessed — always parsed. */
	animated: boolean;
	/** Intrinsic size, when it can be read from the header. */
	width?: number;
	height?: number;
}

const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38]; // "GIF8"
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
	if (bytes.length < offset + signature.length) {
		return false;
	}

	return signature.every((byte, index) => bytes[offset + index] === byte);
}

function fourCc(bytes: Uint8Array, offset: number): string {
	if (bytes.length < offset + 4) {
		return '';
	}

	return String.fromCharCode(
		bytes[offset],
		bytes[offset + 1],
		bytes[offset + 2],
		bytes[offset + 3]
	);
}

function readU16LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24LE(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset] |
			(bytes[offset + 1] << 8) |
			(bytes[offset + 2] << 16) |
			(bytes[offset + 3] << 24)) >>>
		0
	);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
	return (
		((bytes[offset] << 24) |
			(bytes[offset + 1] << 16) |
			(bytes[offset + 2] << 8) |
			bytes[offset + 3]) >>>
		0
	);
}

/**
 * Walks a GIF's block structure and counts image descriptors (0x2C). Scanning for the
 * byte on its own would produce false positives — colour tables and LZW data are full of
 * 0x2C — so this actually parses.
 */
function sniffGif(bytes: Uint8Array): SniffResult {
	const result: SniffResult = {
		format: 'gif',
		mime: 'image/gif',
		animated: false,
		width: bytes.length >= 8 ? readU16LE(bytes, 6) : undefined,
		height: bytes.length >= 10 ? readU16LE(bytes, 8) : undefined
	};

	if (bytes.length < 13) {
		return result;
	}

	const packed = bytes[10];
	let offset = 13;

	// Global colour table.

	if (packed & 0x80) {
		offset += 3 * (1 << ((packed & 0x07) + 1));
	}

	let descriptors = 0;

	// Skips a chain of length-prefixed sub-blocks, ending at the zero-length one.

	function skipSubBlocks(from: number): number {
		let at = from;

		while (at < bytes.length) {
			const size = bytes[at];

			at += 1;

			if (size === 0) {
				return at;
			}

			at += size;
		}

		return at;
	}

	while (offset < bytes.length) {
		const introducer = bytes[offset];

		if (introducer === 0x3b) {
			// Trailer.
			break;
		} else if (introducer === 0x21) {
			// Extension: introducer, label, then sub-blocks.
			offset = skipSubBlocks(offset + 2);
		} else if (introducer === 0x2c) {
			descriptors += 1;

			if (descriptors > 1) {
				result.animated = true;
				return result;
			}

			// Image descriptor is 10 bytes including the introducer.
			const imagePacked = bytes[offset + 9];

			offset += 10;

			if (imagePacked & 0x80) {
				offset += 3 * (1 << ((imagePacked & 0x07) + 1));
			}

			// LZW minimum code size, then image data sub-blocks.
			offset = skipSubBlocks(offset + 1);
		} else {
			// Not a structure we recognize; stop rather than guess.
			break;
		}
	}

	return result;
}

/** APNG is a PNG carrying an `acTL` chunk. */
function sniffPng(bytes: Uint8Array): SniffResult {
	const result: SniffResult = {
		format: 'png',
		mime: 'image/png',
		animated: false
	};
	let offset = 8;

	while (offset + 8 <= bytes.length) {
		const length = readU32BE(bytes, offset);
		const type = fourCc(bytes, offset + 4);

		if (type === 'IHDR' && offset + 16 <= bytes.length) {
			result.width = readU32BE(bytes, offset + 8);
			result.height = readU32BE(bytes, offset + 12);
		} else if (type === 'acTL') {
			result.animated = true;
			return result;
		} else if (type === 'IDAT' || type === 'IEND') {
			// `acTL` must precede the first IDAT, so there is nothing left to find.
			break;
		}

		offset += 12 + length;
	}

	return result;
}

/**
 * WebP is a RIFF container. Animated files carry an `ANIM` chunk, and their `VP8X` header
 * sets the animation flag.
 */
function sniffWebp(bytes: Uint8Array): SniffResult {
	const result: SniffResult = {
		format: 'webp',
		mime: 'image/webp',
		animated: false
	};
	let offset = 12;

	while (offset + 8 <= bytes.length) {
		const type = fourCc(bytes, offset);
		const length = readU32LE(bytes, offset + 4);
		const payload = offset + 8;

		if (type === 'ANIM') {
			result.animated = true;
		} else if (type === 'VP8X' && payload + 10 <= bytes.length) {
			if (bytes[payload] & 0x02) {
				result.animated = true;
			}

			result.width = readU24LE(bytes, payload + 4) + 1;
			result.height = readU24LE(bytes, payload + 7) + 1;
		} else if (type === 'VP8 ' && payload + 10 <= bytes.length) {
			if (result.width === undefined) {
				result.width = readU16LE(bytes, payload + 6) & 0x3fff;
				result.height = readU16LE(bytes, payload + 8) & 0x3fff;
			}
		} else if (type === 'VP8L' && payload + 5 <= bytes.length) {
			if (result.width === undefined) {
				const bits = readU32LE(bytes, payload + 1);

				result.width = (bits & 0x3fff) + 1;
				result.height = ((bits >>> 14) & 0x3fff) + 1;
			}
		}

		// Chunk payloads are padded to an even length.
		offset = payload + length + (length % 2);
	}

	return result;
}

function sniffJpeg(bytes: Uint8Array): SniffResult {
	const result: SniffResult = {
		format: 'jpeg',
		mime: 'image/jpeg',
		animated: false
	};
	let offset = 2;

	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) {
			break;
		}

		const marker = bytes[offset + 1];
		const length = (bytes[offset + 2] << 8) | bytes[offset + 3];

		// Start-of-frame markers, excluding the two that aren't frames.
		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc &&
			offset + 9 <= bytes.length
		) {
			result.height = (bytes[offset + 5] << 8) | bytes[offset + 6];
			result.width = (bytes[offset + 7] << 8) | bytes[offset + 8];
			break;
		}

		offset += 2 + length;
	}

	return result;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
	const head = String.fromCharCode(...bytes.subarray(0, 256)).trimStart();

	return head.startsWith('<svg') || head.startsWith('<?xml');
}

/**
 * Identifies an image from its header bytes. Never throws — unrecognized input comes back
 * as `unknown` so the caller can store it untouched.
 */
export function sniffImage(source: ArrayBuffer | Uint8Array): SniffResult {
	const bytes =
		source instanceof Uint8Array ? source : new Uint8Array(source);

	if (startsWith(bytes, GIF_SIGNATURE)) {
		return sniffGif(bytes);
	}

	if (startsWith(bytes, PNG_SIGNATURE)) {
		return sniffPng(bytes);
	}

	if (
		startsWith(bytes, RIFF_SIGNATURE) &&
		startsWith(bytes, WEBP_SIGNATURE, 8)
	) {
		return sniffWebp(bytes);
	}

	if (startsWith(bytes, JPEG_SIGNATURE)) {
		return sniffJpeg(bytes);
	}

	if (looksLikeSvg(bytes)) {
		return {format: 'svg', mime: 'image/svg+xml', animated: false};
	}

	return {format: 'unknown', mime: 'application/octet-stream', animated: false};
}

/**
 * Can this format be safely round-tripped through canvas? Animated files and vectors must
 * not be — canvas would flatten or rasterize them.
 */
export function isTranscodable(sniffed: SniffResult): boolean {
	if (sniffed.animated) {
		return false;
	}

	return (
		sniffed.format === 'gif' ||
		sniffed.format === 'png' ||
		sniffed.format === 'jpeg'
	);
}
