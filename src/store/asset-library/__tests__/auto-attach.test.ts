/**
 * @jest-environment node
 */
import {png} from '../../../../packages/asset-library/src/testing/fixtures';
import {World} from '../../../../packages/asset-library/src/testing/world';
import type {LibraryEngine} from '@sliders/asset-library';
import {
	attachCollections,
	attachForNames,
	collectionsToAttach
} from '../auto-attach';

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

async function addBg(
	engine: LibraryEngine,
	collection: string,
	name: string,
	colour: Parameters<typeof png>[0]
) {
	return (
		await engine.addAsset(png(colour), 'image/png', {
			allowDuplicate: true,
			collection,
			kind: 'bg',
			name
		})
	).asset!;
}

async function setup() {
	const [, ana] = await World.create(['ana']);
	const engine = ana.engine;
	const forest = engine.createCollection({name: 'forest-pack'});
	const city = engine.createCollection({name: 'city-pack'});

	await addBg(engine, forest.id, 'woods', 'green');
	await addBg(engine, forest.id, 'street', 'red');
	await addBg(engine, city.id, 'street', 'blue');

	return {city, engine, forest};
}

describe('collectionsToAttach', () => {
	it('attaches the one shared pack that has a plain name', async () => {
		const {engine, forest} = await setup();

		expect(collectionsToAttach(engine, 'S1', ['woods'])).toEqual([forest.id]);
	});

	it('leaves a name two packs share to the author', async () => {
		const {engine} = await setup();

		expect(collectionsToAttach(engine, 'S1', ['street'])).toEqual([]);
	});

	it('attaches the collection a qualified name points at', async () => {
		const {city, engine} = await setup();

		expect(collectionsToAttach(engine, 'S1', ['city-pack/street'])).toEqual([
			city.id
		]);
	});

	it('attaches nothing for a name the view already resolves', async () => {
		const {engine, forest} = await setup();

		engine.createStory('S1', {name: 'Story'});
		engine.bind('S1', [forest.id]);

		expect(collectionsToAttach(engine, 'S1', ['woods', 'street'])).toEqual([]);
	});

	it('never auto-attaches another story by a plain name', async () => {
		const {engine} = await setup();
		const other = engine.createStory('S2', {name: 'Other'});

		await addBg(engine, other.own, 'attic', 'white');

		expect(collectionsToAttach(engine, 'S1', ['attic'])).toEqual([]);
	});
});

describe('attachCollections', () => {
	it('creates the binding when the story has none, then appends', async () => {
		const {city, engine, forest} = await setup();

		expect(attachForNames(engine, 'S1', ['woods'], 'My Story')).toEqual([
			forest.id
		]);
		expect(engine.binding('S1')?.collections).toEqual([forest.id]);
		expect(engine.get(engine.binding('S1')!.own, 'collection')?.name).toBe(
			'My Story'
		);

		expect(attachCollections(engine, 'S1', [forest.id, city.id])).toEqual([
			city.id
		]);
		expect(engine.binding('S1')?.collections).toEqual([forest.id, city.id]);
	});
});
