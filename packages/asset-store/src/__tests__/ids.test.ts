import {
	contentHash,
	nameFromFilename,
	randomAssetId,
	slugify,
	uniqueAssetId,
	uniqueName
} from '../ids';

// jsdom in this Jest version has no TextEncoder.
function asciiBytes(value: string): Uint8Array {
	return new Uint8Array(Array.from(value, character => character.charCodeAt(0)));
}

// jsdom ships getRandomValues but not SubtleCrypto.
beforeAll(() => {
	if (!globalThis.crypto?.subtle) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const {webcrypto} = require('crypto');

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		});
	}
});

describe('randomAssetId()', () => {
	it('produces ids shaped like a_8f21', () => {
		for (let index = 0; index < 100; index++) {
			expect(randomAssetId()).toMatch(/^a_[0-9a-f]{4}$/);
		}
	});

	it('does not produce the same id every time', () => {
		const ids = new Set(
			Array.from({length: 200}, () => randomAssetId())
		);

		expect(ids.size).toBeGreaterThan(1);
	});
});

describe('uniqueAssetId()', () => {
	it('avoids ids already in use', () => {
		const taken = Array.from({length: 500}, () => randomAssetId());
		const id = uniqueAssetId(taken);

		expect(taken).not.toContain(id);
	});

	it('widens the id when the short space is exhausted', () => {
		const everyPossibleId: string[] = [];

		for (let index = 0; index < 0x10000; index++) {
			everyPossibleId.push('a_' + index.toString(16).padStart(4, '0'));
		}

		const id = uniqueAssetId(everyPossibleId);

		expect(everyPossibleId).not.toContain(id);
		expect(id.length).toBeGreaterThan(6);
	});
});

describe('contentHash()', () => {
	it('matches the known SHA-256 of "abc"', async () => {
		expect(await contentHash(asciiBytes('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('is stable for identical bytes', async () => {
		const first = await contentHash(new Uint8Array([1, 2, 3, 4, 5]));
		const second = await contentHash(new Uint8Array([1, 2, 3, 4, 5]));

		expect(first).toBe(second);
	});

	it('differs for different bytes', async () => {
		const first = await contentHash(new Uint8Array([1, 2, 3]));
		const second = await contentHash(new Uint8Array([1, 2, 4]));

		expect(first).not.toBe(second);
	});

	it('hashes only the bytes a view covers, not its whole buffer', async () => {
		const buffer = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
		const view = buffer.subarray(2, 5);

		expect(await contentHash(view)).toBe(
			await contentHash(new Uint8Array([1, 2, 3]))
		);
	});

	it('accepts an ArrayBuffer', async () => {
		expect(await contentHash(asciiBytes('abc').buffer)).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});

describe('nameFromFilename()', () => {
	it.each([
		['Tavern Night.png', 'tavern-night'],
		['tavern/night.webp', 'tavern/night'],
		['tavern\\night.gif', 'tavern/night'],
		['MIRA idle.PNG', 'mira-idle'],
		['  spaced  out .jpeg', 'spaced-out'],
		['no-extension', 'no-extension'],
		['!!!.png', 'untitled']
	])('turns %s into %s', (filename, expected) => {
		expect(nameFromFilename(filename)).toBe(expected);
	});
});

describe('slugify()', () => {
	it.each([
		['Mira', 'mira'],
		['Old Man Joren', 'old-man-joren'],
		['  ??  ', 'untitled']
	])('turns %s into %s', (value, expected) => {
		expect(slugify(value)).toBe(expected);
	});
});

describe('uniqueName()', () => {
	it('hands back a free name untouched', () => {
		expect(uniqueName('lamp', new Set())).toBe('lamp');
		expect(uniqueName('lamp', new Set(['torch']))).toBe('lamp');
	});

	it('numbers from 2 — the original already is the first one', () => {
		expect(uniqueName('lamp', new Set(['lamp']))).toBe('lamp-2');
	});

	it('keeps counting past a run of taken numbers', () => {
		expect(uniqueName('lamp', new Set(['lamp', 'lamp-2', 'lamp-3']))).toBe('lamp-4');
	});

	it('skips a gap rather than filling it — the first free number wins', () => {
		expect(uniqueName('lamp', new Set(['lamp', 'lamp-3']))).toBe('lamp-2');
	});

	it('does not care what kind of thing took the name', () => {
		// The taken set is asset names AND character ids: one namespace, because a scene
		// resolves an `entities:` entry against both.
		expect(uniqueName('mira', new Set(['mira']))).toBe('mira-2');
	});
});
