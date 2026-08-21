/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {contentHash} from '@sliders/asset-store';
import type {AssetMeta} from '@sliders/scene-types';
import {pngBytes} from '../../../packages/asset-store/src/test-fixtures';
import {
	LEGACY_ASSET_SCOPE,
	resetAssetStoresForTests,
	slidersAssetStore
} from '../../dialogs/sliders-assets/asset-store-context';
import {migrateLegacyAssets} from '../migrate-legacy-assets';
import type {Passage, Story} from '../stories';

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

beforeEach(() => {
	window.localStorage.clear();
	resetAssetStoresForTests();
});

// jsdom has neither OPFS nor IndexedDB, so every scope gets its own in-memory store --
// which is exactly the shape being tested, one library per story id.

function passage(text: string): Passage {
	return {
		height: 100,
		highlighted: false,
		id: 'p0',
		left: 0,
		name: 'Start',
		selected: false,
		story: 'story-1',
		tags: [],
		text,
		top: 0,
		width: 100
	};
}

let storyCount = 0;

function story(text: string): Story {
	storyCount++;

	return {
		id: `story-${storyCount}`,
		ifid: 'CD3A7B4A-1BE4-4B87-B5F0-6C1C1C1C1C1C',
		lastUpdate: new Date(),
		name: `Story ${storyCount}`,
		passages: [passage(text)],
		script: '',
		selected: false,
		snapToGrid: false,
		startPassage: 'p0',
		storyFormat: 'Sliders',
		storyFormatVersion: '1.0.0',
		stylesheet: '',
		tagColors: {},
		tags: [],
		zoom: 1
	};
}

async function meta(
	bytes: Uint8Array,
	overrides: Partial<AssetMeta> = {}
): Promise<AssetMeta> {
	return {
		animated: false,
		bytes: bytes.length,
		h: 360,
		hash: await contentHash(bytes),
		id: 'a_8f21',
		kind: 'bg',
		mime: 'image/png',
		name: 'tavern/night',
		tags: [],
		w: 640,
		...overrides
	};
}

/** Fills the old shared library with a background and a character. */
async function fillLegacy() {
	const legacy = slidersAssetStore(LEGACY_ASSET_SCOPE);
	const tavern = pngBytes();
	const idle = pngBytes(100);
	const unused = pngBytes(12);

	await legacy.importAsset(await meta(tavern), new Blob([tavern]));
	await legacy.importAsset(
		await meta(idle, {id: 'a_0001', kind: 'frame', name: 'mira/idle'}),
		new Blob([idle])
	);
	await legacy.importAsset(
		await meta(unused, {id: 'a_ffff', name: 'street/day'}),
		new Blob([unused])
	);
	await legacy.putCharacter({
		frames: {idle: {asset: 'a_0001'}},
		id: 'mira',
		name: 'Mira Vale',
		origin: {x: 0.5, y: 1},
		size: {w: 512, h: 1024},
		tags: []
	});

	return legacy;
}

const SCENE = `[scene]
id: tavern-night
bg: tavern/night
cast:
  mira: {at: -0.4, frame: idle}
`;

describe('migrateLegacyAssets', () => {
	it('copies what a story references into that story’s own library', async () => {
		await fillLegacy();

		const subject = story(SCENE);
		const report = await migrateLegacyAssets([subject]);
		const target = slidersAssetStore(subject.id);

		expect(report.stories).toBe(1);

		const names = (await target.list({includeFrames: true})).map(
			asset => asset.name
		);

		// The background and the character's frame, and not the street nobody named.
		expect(names.sort()).toEqual(['mira/idle', 'tavern/night']);
		expect(await target.getCharacter('mira')).toBeDefined();
	});

	it('keeps asset ids, so scenes still resolve', async () => {
		await fillLegacy();

		const subject = story(SCENE);

		await migrateLegacyAssets([subject]);

		const target = slidersAssetStore(subject.id);

		expect(await target.meta('a_8f21')).toMatchObject({name: 'tavern/night'});
		expect((await target.getCharacter('mira'))!.frames.idle.asset).toBe('a_0001');
	});

	it('leaves the old library where it is', async () => {
		const legacy = await fillLegacy();

		await migrateLegacyAssets([story(SCENE)]);
		expect(await legacy.list({includeFrames: true})).toHaveLength(3);
	});

	it('gives a story nothing when its scenes name nothing', async () => {
		await fillLegacy();

		const subject = story('Just prose, no scene block.');

		await migrateLegacyAssets([subject]);
		expect(
			await slidersAssetStore(subject.id).list({includeFrames: true})
		).toHaveLength(0);
	});

	it('runs once', async () => {
		await fillLegacy();

		const first = story(SCENE);

		await migrateLegacyAssets([first]);

		const second = story(SCENE);

		await migrateLegacyAssets([second]);
		expect(
			await slidersAssetStore(second.id).list({includeFrames: true})
		).toHaveLength(0);
	});

	it('does not overwrite a library the story already has', async () => {
		await fillLegacy();

		const subject = story(SCENE);
		const target = slidersAssetStore(subject.id);
		const mine = pngBytes(24);

		await target.importAsset(
			await meta(mine, {id: 'a_2222', name: 'tavern/night'}),
			new Blob([mine])
		);
		await migrateLegacyAssets([subject]);

		const stored = await target.list({includeFrames: true});

		expect(stored).toHaveLength(1);
		expect(stored[0].id).toBe('a_2222');
	});
});
