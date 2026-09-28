/**
 * @jest-environment node
 */
import {dHash, hamming, hashContent, pixelHash, sha256Hex} from '../hash';
import {decodePng, png, pngDecoder} from '../testing/fixtures';

describe('sha256Hex', () => {
	it('matches the known digest of "abc"', async () => {
		expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('hashes only the view, not its whole buffer', async () => {
		const buffer = new TextEncoder().encode('xxabcxx');

		expect(await sha256Hex(buffer.subarray(2, 5))).toBe(
			await sha256Hex(new TextEncoder().encode('abc'))
		);
	});
});

describe('pixelHash', () => {
	it('same pixels, different bytes → same pixelHash, different sha', async () => {
		const a = png('night', 4, 4, {level: 0});
		const b = png('night', 4, 4, {level: 9, comment: 'exported again'});

		expect(await sha256Hex(a)).not.toBe(await sha256Hex(b));
		expect(await pixelHash(decodePng(a))).toBe(await pixelHash(decodePng(b)));
	});

	it('size is part of it', async () => {
		expect(await pixelHash(decodePng(png('red', 2, 8)))).not.toBe(
			await pixelHash(decodePng(png('red', 8, 2)))
		);
	});

	it('colour under alpha 0 does not count', async () => {
		const clear = (r: number) => ({
			w: 1,
			h: 1,
			rgba: new Uint8Array([r, 0, 0, 0])
		});

		expect(await pixelHash(clear(10))).toBe(await pixelHash(clear(200)));
	});
});

describe('dHash + hamming', () => {
	function gradient(w: number, h: number, flip = false) {
		const rgba = new Uint8Array(w * h * 4);

		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const v = Math.round(((flip ? w - 1 - x : x) / (w - 1)) * 255);
				rgba.set([v, v, v, 255], (y * w + x) * 4);
			}
		}

		return {w, h, rgba};
	}

	it('is 16 hex chars', () => {
		expect(dHash(gradient(32, 32))).toMatch(/^[0-9a-f]{16}$/);
	});

	it('a resize is close, a mirror image is far', () => {
		const original = dHash(gradient(64, 48));

		expect(hamming(original, dHash(gradient(36, 27)))).toBeLessThanOrEqual(6);
		expect(hamming(original, dHash(gradient(64, 48, true)))).toBeGreaterThan(
			32
		);
	});

	it('hamming counts differing bits', () => {
		expect(hamming('00', '00')).toBe(0);
		expect(hamming('0f', '00')).toBe(4);
		expect(hamming('ff00', '00ff')).toBe(16);
		expect(() => hamming('0', '00')).toThrow();
	});
});

describe('hashContent', () => {
	it('images get all three tiers', async () => {
		const bytes = png('gold', 3, 2);
		const hashes = await hashContent(bytes, 'image/png', pngDecoder);

		expect(hashes).toMatchObject({sha: await sha256Hex(bytes), w: 3, h: 2});
		expect(hashes.pixelHash).toMatch(/^[0-9a-f]{64}$/);
		expect(hashes.phash).toMatch(/^[0-9a-f]{16}$/);
	});

	it('sounds and undecodable files get the exact tier only', async () => {
		const bytes = new Uint8Array([1, 2, 3]);

		expect(await hashContent(bytes, 'audio/ogg', pngDecoder)).toEqual({
			sha: await sha256Hex(bytes)
		});
		expect(await hashContent(bytes, 'image/png', pngDecoder)).toEqual({
			sha: await sha256Hex(bytes)
		});
	});
});
