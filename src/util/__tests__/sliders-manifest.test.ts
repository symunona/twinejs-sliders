import {
	BackedAssetStore,
	MemoryBackend,
	defaultCharacter
} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
// Not re-exported from the package index -- fixtures are test-only.
import {
	pngBytes,
	webpBytes
} from '../../../packages/asset-store/src/test-fixtures';
import type {Passage, Story} from '../../store/stories';
import {
	ASSETS_PASSAGE_NAME,
	CAST_PASSAGE_NAME,
	withSlidersManifests
} from '../sliders-manifest';

// jsdom ships getRandomValues but not SubtleCrypto, and implements neither
// URL.createObjectURL nor its revoke.
beforeAll(() => {
	if (!globalThis.crypto?.subtle) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const {webcrypto} = require('crypto');

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		});
	}

	let objectUrls = 0;

	URL.createObjectURL = () => `blob:mock/${objectUrls++}`;
	URL.revokeObjectURL = () => {};
});

function passage(name: string, text: string): Passage {
	return {
		height: 100,
		highlighted: false,
		id: `p-${name}`,
		left: 0,
		name,
		selected: false,
		story: 'story-id',
		tags: [],
		text,
		top: 0,
		width: 100
	};
}

function story(passages: Passage[]): Story {
	return {
		id: 'story-id',
		ifid: 'C0FFEE00-0000-4000-8000-000000000000',
		lastUpdate: new Date('2026-01-02T03:04:05.000Z'),
		name: 'Lighthouse',
		passages,
		script: '',
		selected: false,
		snapToGrid: false,
		startPassage: passages[0]?.id ?? '',
		storyFormat: 'Sliders',
		storyFormatVersion: '0.1.0',
		stylesheet: '',
		tagColors: {},
		tags: [],
		zoom: 1
	};
}

function scenePassage(name: string, block: string): Passage {
	return passage(name, `[scene]\nid: ${name.toLowerCase()}\n${block}`);
}

const CLIFF = scenePassage(
	'Cliff',
	['bg: lighthouse-night', 'cast:', '  nell: {at: 0, frame: idle}'].join('\n')
);

function file(bytes: Uint8Array, name: string, type: string) {
	return new File([bytes], name, {type});
}

interface Seeded {
	bg: string;
	character: Character;
	store: BackedAssetStore;
}

async function seed(): Promise<Seeded> {
	const store = new BackedAssetStore(new MemoryBackend());
	const bg = await store.put(
		file(webpBytes(640, 360), 'lighthouse.webp', 'image/webp'),
		{kind: 'bg', name: 'lighthouse-night', tags: ['night']}
	);
	const character: Character = defaultCharacter('nell', 'Nell');

	character.frames.idle = {
		anchors: {},
		asset: await store.put(file(pngBytes(40, 90), 'nell.png', 'image/png'), {
			kind: 'frame',
			name: 'nell/idle',
			ownerCharacter: 'nell'
		})
	};

	// A 40 MB library must not follow a two-passage story.
	await store.put(file(pngBytes(4, 4), 'unused.png', 'image/png'), {
		kind: 'bg',
		name: 'unused'
	});

	return {bg, character: await store.putCharacter(character), store};
}

function manifests(published: Story) {
	const named = (name: string) =>
		published.passages.find(p => p.name === name);

	return {
		assets: JSON.parse(named(ASSETS_PASSAGE_NAME)?.text ?? 'null') as {
			assets: AssetMeta[];
			urls: Record<string, string>;
		},
		cast: JSON.parse(named(CAST_PASSAGE_NAME)?.text ?? 'null') as {
			characters: Character[];
		}
	};
}

describe('withSlidersManifests', () => {
	it('emits nothing when the story references no assets', async () => {
		const {store} = await seed();
		const original = story([passage('Prose', 'Just text, no scene block.')]);
		const published = await withSlidersManifests(original, store, {
			urls: 'blob'
		});

		expect(published).toBe(original);
	});

	it('emits nothing when every reference is unresolved', async () => {
		// The stub resolver's labelled boxes are better than a manifest that says nothing:
		// `manifests().empty` goes false as soon as either passage exists.
		const {store} = await seed();
		const original = story([scenePassage('Cliff', 'bg: never-uploaded')]);

		expect(await withSlidersManifests(original, store, {urls: 'blob'})).toBe(
			original
		);
	});

	it('keys every asset url by both its id and the name scene YAML writes', async () => {
		const {bg, character, store} = await seed();
		const published = await withSlidersManifests(story([CLIFF]), store, {
			urls: 'blob'
		});
		const {assets} = manifests(published);
		const frameAsset = character.frames.idle.asset;

		// `bg: lighthouse-night` resolves by name; a character frame carries an id.
		expect(assets.urls['lighthouse-night']).toMatch(/^blob:/);
		expect(assets.urls[bg]).toBe(assets.urls['lighthouse-night']);
		expect(assets.urls[frameAsset]).toMatch(/^blob:/);
		expect(assets.urls['nell/idle']).toBe(assets.urls[frameAsset]);
		// The unreferenced asset stays home.
		expect(Object.keys(assets.urls)).toHaveLength(4);
	});

	it('carries the cast and a name-keyed meta for every asset', async () => {
		const {bg, store} = await seed();
		const published = await withSlidersManifests(story([CLIFF]), store, {
			urls: 'blob'
		});
		const {assets, cast} = manifests(published);

		expect(cast.characters.map(c => c.id)).toEqual(['nell']);

		// Props are sized from `resolver.meta(ref)`, and ref is the name.
		const byName = assets.assets.find(meta => meta.id === 'lighthouse-night');

		expect(byName).toMatchObject({h: 360, name: 'lighthouse-night', w: 640});
		expect(assets.assets.find(meta => meta.id === bg)).toMatchObject({
			name: 'lighthouse-night'
		});
	});

	it('inlines bytes as data URIs when asked', async () => {
		const {bg, store} = await seed();
		const published = await withSlidersManifests(story([CLIFF]), store, {
			urls: 'data'
		});
		const {assets} = manifests(published);

		expect(assets.urls[bg]).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);
		expect(assets.urls['lighthouse-night']).toBe(assets.urls[bg]);
	});

	it('appends the manifests without disturbing the story it was given', async () => {
		const {store} = await seed();
		const original = story([CLIFF]);
		const published = await withSlidersManifests(original, store, {
			urls: 'blob'
		});

		expect(original.passages).toEqual([CLIFF]);
		expect(published.passages.map(p => p.name)).toEqual([
			'Cliff',
			CAST_PASSAGE_NAME,
			ASSETS_PASSAGE_NAME
		]);
		// Start passage indices have to survive: publishStory numbers passages by position.
		expect(published.passages[0].id).toBe(published.startPassage);
	});

	it('replaces a hand-written manifest passage rather than duplicating it', async () => {
		const {store} = await seed();
		const published = await withSlidersManifests(
			story([CLIFF, passage(ASSETS_PASSAGE_NAME, '{"urls": {"a": "b"}}')]),
			store,
			{urls: 'blob'}
		);

		expect(
			published.passages.filter(p => p.name === ASSETS_PASSAGE_NAME)
		).toHaveLength(1);
		expect(manifests(published).assets.urls.a).toBeUndefined();
	});

	it('publishes without manifests when the library cannot be read', async () => {
		const store = {
			character: jest.fn(),
			list: jest.fn(() => Promise.reject(new Error('no storage'))),
			meta: jest.fn()
		} as unknown as BackedAssetStore;
		const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
		const original = story([CLIFF]);

		expect(await withSlidersManifests(original, store, {urls: 'blob'})).toBe(
			original
		);
		expect(warn).toHaveBeenCalled();
	});
});
