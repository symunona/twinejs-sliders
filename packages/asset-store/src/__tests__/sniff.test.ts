import {isTranscodable, sniffImage} from '../sniff';
import {
	animatedWebpBytes,
	apngBytes,
	gifBytes,
	jpegBytes,
	pngBytes,
	pngWithDecoyAcTlBytes,
	webpBytes,
	webpWithDecoyAnimBytes
} from '../test-fixtures';

// jsdom in this Jest version has no TextEncoder.
function asciiBytes(value: string): Uint8Array {
	return new Uint8Array(Array.from(value, character => character.charCodeAt(0)));
}

describe('sniffImage()', () => {
	describe('GIF', () => {
		it('reports a single-frame GIF as still', () => {
			const result = sniffImage(gifBytes({frames: 1}));

			expect(result.format).toBe('gif');
			expect(result.mime).toBe('image/gif');
			expect(result.animated).toBe(false);
		});

		it('reports a GIF with more than one image descriptor as animated', () => {
			expect(sniffImage(gifBytes({frames: 2})).animated).toBe(true);
			expect(sniffImage(gifBytes({frames: 7})).animated).toBe(true);
		});

		it('does not mistake 0x2C bytes in a colour table for image descriptors', () => {
			expect(
				sniffImage(gifBytes({frames: 1, decoyColorTable: true})).animated
			).toBe(false);
			expect(
				sniffImage(gifBytes({frames: 3, decoyColorTable: true})).animated
			).toBe(true);
		});

		it('reads dimensions from the logical screen descriptor', () => {
			const result = sniffImage(gifBytes({frames: 1}));

			expect(result.width).toBe(64);
			expect(result.height).toBe(32);
		});

		it('does not throw on a truncated file', () => {
			const truncated = gifBytes({frames: 2}).subarray(0, 9);

			expect(() => sniffImage(truncated)).not.toThrow();
		});
	});

	describe('PNG', () => {
		it('reports a plain PNG as still', () => {
			const result = sniffImage(pngBytes());

			expect(result.format).toBe('png');
			expect(result.mime).toBe('image/png');
			expect(result.animated).toBe(false);
		});

		it('reports a PNG with an acTL chunk as animated', () => {
			expect(sniffImage(apngBytes()).animated).toBe(true);
		});

		it('does not mistake acTL bytes inside pixel data for a chunk', () => {
			expect(sniffImage(pngWithDecoyAcTlBytes()).animated).toBe(false);
		});

		it('reads dimensions from IHDR', () => {
			const result = sniffImage(pngBytes(1024, 768));

			expect(result.width).toBe(1024);
			expect(result.height).toBe(768);
		});
	});

	describe('WebP', () => {
		it('reports a lossless WebP as still', () => {
			const result = sniffImage(webpBytes());

			expect(result.format).toBe('webp');
			expect(result.mime).toBe('image/webp');
			expect(result.animated).toBe(false);
		});

		it('reports a WebP with an ANIM chunk as animated', () => {
			expect(sniffImage(animatedWebpBytes()).animated).toBe(true);
		});

		it('does not mistake ANIM bytes inside a payload for a chunk', () => {
			expect(sniffImage(webpWithDecoyAnimBytes()).animated).toBe(false);
		});

		it('reads dimensions from VP8X', () => {
			const result = sniffImage(animatedWebpBytes(640, 480));

			expect(result.width).toBe(640);
			expect(result.height).toBe(480);
		});

		it('reads dimensions from VP8L', () => {
			const result = sniffImage(webpBytes(320, 240));

			expect(result.width).toBe(320);
			expect(result.height).toBe(240);
		});
	});

	describe('other formats', () => {
		it('recognizes JPEG and reads its dimensions', () => {
			const result = sniffImage(jpegBytes(300, 150));

			expect(result.format).toBe('jpeg');
			expect(result.animated).toBe(false);
			expect(result.width).toBe(300);
			expect(result.height).toBe(150);
		});

		it('recognizes SVG', () => {
			const svg = asciiBytes('<svg xmlns="http://x"></svg>');

			expect(sniffImage(svg).format).toBe('svg');
		});

		it('falls back to unknown', () => {
			expect(sniffImage(new Uint8Array([1, 2, 3, 4])).format).toBe('unknown');
		});

		it('accepts an ArrayBuffer as well as a Uint8Array', () => {
			const view = pngBytes();
			const buffer = view.buffer.slice(
				view.byteOffset,
				view.byteOffset + view.byteLength
			);

			expect(sniffImage(buffer).format).toBe('png');
		});
	});
});

describe('isTranscodable()', () => {
	it('allows still raster formats through the canvas pipeline', () => {
		expect(isTranscodable(sniffImage(pngBytes()))).toBe(true);
		expect(isTranscodable(sniffImage(jpegBytes()))).toBe(true);
		expect(isTranscodable(sniffImage(gifBytes({frames: 1})))).toBe(true);
	});

	it('refuses animated files, which canvas would flatten', () => {
		expect(isTranscodable(sniffImage(gifBytes({frames: 4})))).toBe(false);
		expect(isTranscodable(sniffImage(apngBytes()))).toBe(false);
		expect(isTranscodable(sniffImage(animatedWebpBytes()))).toBe(false);
	});

	it('refuses vectors and unknown files', () => {
		expect(
			isTranscodable(sniffImage(asciiBytes('<svg></svg>')))
		).toBe(false);
		expect(isTranscodable(sniffImage(new Uint8Array([9, 9, 9])))).toBe(false);
	});
});
