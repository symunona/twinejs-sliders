import {deflateSync, inflateSync} from 'zlib';
import type {DecodedImage, ImageDecoder} from '../hash';

/**
 * Tiny real PNGs, so hashes differ per colour and a "re-encode" really is different
 * bytes for the same pixels. Plus a decoder for exactly what `png()` writes (8-bit RGBA,
 * filter 0), standing in for createImageBitmap under jest.
 */

const NAMED: Record<string, [number, number, number, number]> = {
	red: [255, 0, 0, 255],
	green: [0, 160, 0, 255],
	blue: [0, 0, 255, 255],
	black: [0, 0, 0, 255],
	white: [255, 255, 255, 255],
	night: [20, 20, 60, 255],
	day: [250, 220, 120, 255],
	gold: [212, 175, 55, 255],
	grey: [128, 128, 128, 255]
};

export type Colour =
	| keyof typeof NAMED
	| number
	| [number, number, number, number];

function rgba(colour: Colour): [number, number, number, number] {
	if (Array.isArray(colour)) {
		return colour;
	}

	if (typeof colour === 'number') {
		// Spread a seed over the channels so neighbouring seeds differ visibly.
		const n = (colour * 2654435761) >>> 0;
		return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, 255];
	}

	return NAMED[colour];
}

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);

	for (let n = 0; n < 256; n++) {
		let c = n;

		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}

		table[n] = c >>> 0;
	}

	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;

	for (const byte of bytes) {
		c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	}

	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);

	view.setUint32(0, data.length);
	out.set(
		Array.from(type, ch => ch.charCodeAt(0)),
		4
	);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));

	return out;
}

export interface PngOptions {
	/** zlib level: 0 stores, 9 compresses. Same pixels, different bytes. */
	level?: number;
	/** A tEXt chunk: metadata that changes the bytes and nothing else. */
	comment?: string;
	/** Paint one pixel a different colour: a "slightly edited" picture. */
	dot?: Colour;
}

/** A w×h PNG filled with one colour. */
export function png(
	colour: Colour,
	w = 4,
	h = 4,
	options: PngOptions = {}
): Uint8Array {
	const [r, g, b, a] = rgba(colour);
	const raw = new Uint8Array(h * (1 + w * 4));

	for (let y = 0; y < h; y++) {
		raw[y * (1 + w * 4)] = 0;

		for (let x = 0; x < w; x++) {
			const at = y * (1 + w * 4) + 1 + x * 4;
			const [pr, pg, pb, pa] =
				options.dot !== undefined && x === 0 && y === 0
					? rgba(options.dot)
					: [r, g, b, a];

			raw[at] = pr;
			raw[at + 1] = pg;
			raw[at + 2] = pb;
			raw[at + 3] = pa;
		}
	}

	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);

	view.setUint32(0, w);
	view.setUint32(4, h);
	header[8] = 8; // bit depth
	header[9] = 6; // RGBA

	const parts = [
		new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header)
	];

	if (options.comment) {
		parts.push(
			chunk(
				'tEXt',
				new Uint8Array(
					Array.from(`Comment\0${options.comment}`, ch => ch.charCodeAt(0))
				)
			)
		);
	}

	parts.push(
		chunk('IDAT', new Uint8Array(deflateSync(raw, {level: options.level ?? 6})))
	);
	parts.push(chunk('IEND', new Uint8Array(0)));

	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;

	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
}

/** Decodes what `png()` writes. Anything else throws. */
export const pngDecoder: ImageDecoder = async bytes => decodePng(bytes);

export function decodePng(bytes: Uint8Array): DecodedImage {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 8;
	let w = 0;
	let h = 0;
	const idat: Uint8Array[] = [];

	while (offset < bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const data = bytes.subarray(offset + 8, offset + 8 + length);

		if (type === 'IHDR') {
			w = new DataView(data.buffer, data.byteOffset).getUint32(0);
			h = new DataView(data.buffer, data.byteOffset).getUint32(4);

			if (data[8] !== 8 || data[9] !== 6) {
				throw new Error('fixture decoder: 8-bit RGBA only');
			}
		} else if (type === 'IDAT') {
			idat.push(data);
		}

		offset += 12 + length;
	}

	const raw = inflateSync(Buffer.concat(idat.map(part => Buffer.from(part))));
	const out = new Uint8Array(w * h * 4);

	for (let y = 0; y < h; y++) {
		if (raw[y * (1 + w * 4)] !== 0) {
			throw new Error('fixture decoder: filter 0 only');
		}

		out.set(
			raw.subarray(y * (1 + w * 4) + 1, (y + 1) * (1 + w * 4)),
			y * w * 4
		);
	}

	return {w, h, rgba: out};
}

/** Deterministic PRNG for the property test. */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;

	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** uuid-shaped ids from a PRNG, so a seeded run is reproducible end to end. */
export function seededUuid(random: () => number): () => string {
	return () => {
		const hex = Array.from({length: 32}, () =>
			Math.floor(random() * 16).toString(16)
		).join('');

		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(
			13,
			16
		)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
	};
}
