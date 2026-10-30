/**
 * @jest-environment node
 */
import {png} from '../../../../../packages/asset-library/src/testing/fixtures';
import {World} from '../../../../../packages/asset-library/src/testing/world';
import type {LibraryEngine} from '@sliders/asset-library';
import {extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';
import {
	blankPassageScene,
	DEMO_BG_NAME,
	DEMO_PACK_NAME,
	defaultSceneBg,
	emptySceneText,
	isBlankPassageText,
	isEmptySceneCommand,
	lastUsedBg,
	viewSceneBg
} from '../empty-scene';
import {LAST_SCENE_KEY} from '../use-last-scene';

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

const storage = new Map<string, string>();

beforeEach(() => {
	storage.clear();
	(globalThis as any).window = {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			removeItem: (key: string) => storage.delete(key),
			setItem: (key: string, value: string) => storage.set(key, value)
		}
	};
});

afterAll(() => {
	delete (globalThis as any).window;
});

const scene = (bg: string) => `Prose\n[scene]\nbg: ${bg}\n\n[continued]\n`;

async function engineWith(
	setup?: (engine: LibraryEngine) => Promise<void>
): Promise<LibraryEngine> {
	const [, ana] = await World.create(['ana']);

	await setup?.(ana.engine);
	return ana.engine;
}

async function addBg(engine: LibraryEngine, collection: string, name: string) {
	return (
		await engine.addAsset(png('red'), 'image/png', {
			allowDuplicate: true,
			collection,
			kind: 'bg',
			name
		})
	).asset!;
}

describe('emptySceneText', () => {
	it('is the block and a backdrop', () => {
		expect(emptySceneText('dusk')).toBe(
			'\n[scene]\nbg: dusk\n\n\n[continued]\n'
		);
		expect(emptySceneText()).toBe('\n[scene]\n\n\n[continued]\n');
	});
});

describe('blankPassageScene', () => {
	it('is the empty-scene block without the separating newline', () => {
		expect(blankPassageScene('dusk')).toBe(
			'[scene]\nbg: dusk\n\n\n[continued]\n'
		);
		expect(blankPassageScene()).toBe('[scene]\n\n\n[continued]\n');
	});

	it.each([undefined, 'dusk'])('parses clean (bg %s)', bg => {
		const block = extractSceneBlock(blankPassageScene(bg));

		expect(block).toBeDefined();
		expect(parseScene(block!.text).errors).toEqual([]);
	});
});

describe('isBlankPassageText', () => {
	it('is true for empty and whitespace-only text', () => {
		expect(isBlankPassageText('')).toBe(true);
		expect(isBlankPassageText('  \n\t\n')).toBe(true);
	});

	it('is false for anything else', () => {
		expect(isBlankPassageText('x')).toBe(false);
		expect(isBlankPassageText('\n  Prose\n')).toBe(false);
	});
});

describe('viewSceneBg', () => {
	it('takes the last backdrop the story uses', () => {
		expect(
			viewSceneBg(undefined, {
				id: 's',
				passages: [{name: 'a', text: scene('dusk')}]
			})
		).toBe('dusk');
	});

	it('takes a backdrop the story sees', async () => {
		const engine = await engineWith(async engine => {
			const own = engine.createStory('S1', {name: 'Story'}).own;

			await addBg(engine, own, 'cellar');
		});

		expect(viewSceneBg(engine, {id: 'S1', passages: []})).toBe('cellar');
	});

	it('never reaches outside the story: no attach, no DEMO pack', async () => {
		const engine = await engineWith(async engine => {
			await addBg(engine, engine.createCollection({name: 'pack'}).id, 'woods');
		});
		const before = engine.collections().length;

		expect(viewSceneBg(engine, {id: 'S1', passages: []})).toBeUndefined();
		expect(engine.binding('S1')?.collections ?? []).toEqual([]);
		expect(engine.collections()).toHaveLength(before);
	});

	it('is undefined with no engine and no scenes, never creating the DEMO pack', () => {
		expect(viewSceneBg(undefined, {id: 's', passages: []})).toBeUndefined();
	});
});

describe('isEmptySceneCommand', () => {
	it('matches the namespaced name Twine registers', () => {
		expect(isEmptySceneCommand('sliders-0.2.0insertEmptyScene')).toBe(true);
		expect(isEmptySceneCommand('sliders-0.2.0insertScene')).toBe(false);
	});
});

describe('lastUsedBg', () => {
	it('prefers the handoff when it was written in this story', () => {
		storage.set(
			LAST_SCENE_KEY,
			JSON.stringify({passageName: 'B', text: 'bg: handoff\n'})
		);

		expect(
			lastUsedBg([
				{name: 'A', text: scene('first')},
				{name: 'B', text: scene('second')}
			])
		).toBe('handoff');
	});

	it('ignores a handoff from another story and takes the last scene with a bg', () => {
		storage.set(
			LAST_SCENE_KEY,
			JSON.stringify({passageName: 'Elsewhere', text: 'bg: handoff\n'})
		);

		expect(
			lastUsedBg([
				{name: 'A', text: scene('first')},
				{name: 'B', text: scene('second')},
				{name: 'C', text: 'no scene'}
			])
		).toBe('second');
	});
});

describe('defaultSceneBg', () => {
	const story = (passages: {name: string; text: string}[] = []) => ({
		id: 'S1',
		name: 'Story',
		passages
	});

	it('takes the last used bg over the library', async () => {
		const engine = await engineWith();

		expect(
			await defaultSceneBg(engine, story([{name: 'A', text: scene('dusk')}]))
		).toBe('dusk');
	});

	it('takes the first backdrop the story sees', async () => {
		let mine = '';
		const engine = await engineWith(async engine => {
			const own = engine.createStory('S1', {name: 'Story'}).own;

			mine = (await addBg(engine, own, 'cellar')).name;
		});

		expect(await defaultSceneBg(engine, story())).toBe(mine);
	});

	it('takes a shared pack backdrop and attaches the pack', async () => {
		let pack = '';
		const engine = await engineWith(async engine => {
			pack = engine.createCollection({name: 'forest-pack'}).id;
			await addBg(engine, pack, 'woods');
		});

		expect(await defaultSceneBg(engine, story())).toBe('woods');
		expect(engine.binding('S1')?.collections).toEqual([pack]);
	});

	it('creates the DEMO pack with a placeholder when there are no pictures', async () => {
		const engine = await engineWith();
		const bg = await defaultSceneBg(engine, story(), async () => png('blue'));
		const demo = engine.collectionByName(DEMO_PACK_NAME)!;

		expect(bg).toBe(DEMO_BG_NAME);
		expect(engine.assets(demo.id).map(asset => asset.kind)).toEqual(['bg']);
		expect(engine.binding('S1')?.collections).toEqual([demo.id]);

		// Second story: the pack is reused, not made twice.
		await defaultSceneBg(engine, {...story(), id: 'S2'}, async () =>
			png('blue')
		);
		expect(
			engine.collections().filter(c => c.name === DEMO_PACK_NAME)
		).toHaveLength(1);
	});
});
