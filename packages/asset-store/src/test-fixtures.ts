/**
 * Minimal, hand-built image files. They are not valid enough to decode, but they are
 * structurally correct in exactly the places the sniffer looks.
 */

function bytes(...values: (number | number[])[]): number[] {
	return values.flat();
}

function u16le(value: number): number[] {
	return [value & 0xff, (value >> 8) & 0xff];
}

function u32be(value: number): number[] {
	return [
		(value >>> 24) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 8) & 0xff,
		value & 0xff
	];
}

function u32le(value: number): number[] {
	return [
		value & 0xff,
		(value >>> 8) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 24) & 0xff
	];
}

function ascii(value: string): number[] {
	return Array.from(value, character => character.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

const GIF_TRAILER = 0x3b;

function gifImageBlock(): number[] {
	return bytes(
		0x2c, // Image descriptor.
		u16le(0), // Left.
		u16le(0), // Top.
		u16le(4), // Width.
		u16le(4), // Height.
		0x00, // Packed: no local colour table.
		0x02, // LZW minimum code size.
		0x02, // Sub-block, 2 bytes.
		[0x4c, 0x01],
		0x00 // Sub-block terminator.
	);
}

/** Graphic control extension — what a real animated GIF puts before each frame. */
function gifGraphicControl(): number[] {
	return bytes(0x21, 0xf9, 0x04, [0x00, 0x0a, 0x00, 0x00], 0x00);
}

export interface GifOptions {
	frames: number;
	/**
	 * Include a global colour table containing 0x2C bytes. Anything that scans for the
	 * image-descriptor byte rather than parsing blocks trips over this.
	 */
	decoyColorTable?: boolean;
}

export function gifBytes(options: GifOptions): Uint8Array {
	const {frames, decoyColorTable} = options;
	const packed = decoyColorTable ? 0x80 : 0x00; // GCT flag, size 0 -> 2 entries.
	const colorTable = decoyColorTable
		? [0x2c, 0x2c, 0x2c, 0x2c, 0x2c, 0x2c]
		: [];
	const body: number[] = [];

	for (let frame = 0; frame < frames; frame++) {
		body.push(...gifGraphicControl(), ...gifImageBlock());
	}

	return new Uint8Array(
		bytes(
			ascii('GIF89a'),
			u16le(64), // Logical screen width.
			u16le(32), // Logical screen height.
			packed,
			0x00, // Background colour index.
			0x00, // Pixel aspect ratio.
			colorTable,
			body,
			GIF_TRAILER
		)
	);
}

// ---------------------------------------------------------------------------
// PNG / APNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** CRCs are never checked by the sniffer, so a placeholder is fine. */
function pngChunk(type: string, data: number[]): number[] {
	return bytes(u32be(data.length), ascii(type), data, u32be(0));
}

function ihdr(width: number, height: number): number[] {
	return pngChunk(
		'IHDR',
		bytes(u32be(width), u32be(height), 0x08, 0x06, 0x00, 0x00, 0x00)
	);
}

export function pngBytes(width = 120, height = 80): Uint8Array {
	return new Uint8Array(
		bytes(PNG_SIGNATURE, ihdr(width, height), pngChunk('IDAT', [0x00]))
	);
}

export function apngBytes(width = 120, height = 80): Uint8Array {
	return new Uint8Array(
		bytes(
			PNG_SIGNATURE,
			ihdr(width, height),
			// acTL: 2 frames, 0 plays.
			pngChunk('acTL', bytes(u32be(2), u32be(0))),
			pngChunk('IDAT', [0x00])
		)
	);
}

/**
 * A still PNG whose IDAT payload happens to contain the bytes `acTL`. Only a real chunk
 * walk gets this right.
 */
export function pngWithDecoyAcTlBytes(): Uint8Array {
	return new Uint8Array(
		bytes(
			PNG_SIGNATURE,
			ihdr(10, 10),
			pngChunk('IDAT', bytes(ascii('acTL'), [0x00, 0x01, 0x02]))
		)
	);
}

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

function riffChunk(type: string, data: number[]): number[] {
	const padding = data.length % 2 === 1 ? [0x00] : [];

	return bytes(ascii(type), u32le(data.length), data, padding);
}

function u24le(value: number): number[] {
	return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
}

function riff(chunks: number[]): Uint8Array {
	const body = bytes(ascii('WEBP'), chunks);

	return new Uint8Array(bytes(ascii('RIFF'), u32le(body.length), body));
}

export function webpBytes(width = 200, height = 100): Uint8Array {
	// VP8L: signature byte, then 14 bits width-1 and 14 bits height-1.
	const packed = (width - 1) | ((height - 1) << 14);

	return riff(riffChunk('VP8L', bytes(0x2f, u32le(packed))));
}

export function animatedWebpBytes(width = 200, height = 100): Uint8Array {
	return riff(
		bytes(
			riffChunk(
				'VP8X',
				bytes(
					0x02, // Animation flag.
					[0x00, 0x00, 0x00],
					u24le(width - 1),
					u24le(height - 1)
				)
			),
			riffChunk('ANIM', bytes(u32le(0xffffffff), u16le(0))),
			riffChunk('ANMF', [0x00, 0x01])
		)
	);
}

/** Still WebP whose payload contains the literal bytes `ANIM`. */
export function webpWithDecoyAnimBytes(): Uint8Array {
	return riff(riffChunk('VP8L', bytes(0x2f, ascii('ANIM'), [0x00, 0x00])));
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

export function jpegBytes(width = 300, height = 150): Uint8Array {
	return new Uint8Array(
		bytes(
			[0xff, 0xd8], // SOI.
			[0xff, 0xc0], // SOF0.
			[0x00, 0x11], // Segment length.
			0x08, // Precision.
			[(height >> 8) & 0xff, height & 0xff],
			[(width >> 8) & 0xff, width & 0xff],
			0x03,
			new Array(9).fill(0x00),
			[0xff, 0xd9] // EOI.
		)
	);
}
