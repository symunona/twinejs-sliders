/**
 * @jest-environment node
 */
import {png} from '../../../../packages/asset-library/src/testing/fixtures';
import {World} from '../../../../packages/asset-library/src/testing/world';
import type {LibraryEngine} from '@sliders/asset-library';
import {
	attachCollections,
	attachForNames,
	collectionForTypedName,
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

async function addObject(
	engine: LibraryEngine,
	collection: string,
	name: string,
	colour: Parameters<typeof png>[0]
) {
	return (
		await engine.addAsset(png(colour), 'image/png', {
			allowDuplicate: true,
			collection,
			kind: 'object',
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

describe('collectionForTypedName', () => {
	/** `b3` is a bg in `bgs`, an object in `props`, a character in `cast`. */
	async function packs() {
		const {city, engine, forest} = await setup();
		const props = engine.createCollection({name: 'b-props'});
		const bgs = engine.createCollection({name: 'z-bgs'});
		const cast = engine.createCollection({name: 'a-cast'});

		await addObject(engine, props.id, 'b3', 'red');
		await addBg(engine, bgs.id, 'b3', 'blue');
		engine.putCharacter({charId: 'b3', collection: cast.id});

		return {bgs, cast, city, engine, forest, props};
	}

	it('attaches nothing when the attached packs already have it', async () => {
		const {engine, forest} = await packs();

		engine.createStory('S1', {name: 'Story'});
		engine.bind('S1', [forest.id]);

		expect(collectionForTypedName(engine, 'S1', 'woods', 'bg')).toBeUndefined();
		// Any kind counts: the name resolves.
		expect(collectionForTypedName(engine, 'S1', 'street', 'object')).toBeUndefined();
	});

	it('bg: backdrops first, then objects, then characters', async () => {
		const {bgs, engine} = await packs();

		// z-bgs sorts last and still wins: kind before pack order.
		expect(collectionForTypedName(engine, 'S1', 'b3', 'bg')).toBe(bgs.id);
	});

	it('object: objects first; character: characters first', async () => {
		const {cast, engine, props} = await packs();

		expect(collectionForTypedName(engine, 'S1', 'b3', 'object')).toBe(props.id);
		expect(collectionForTypedName(engine, 'S1', 'b3', 'character')).toBe(cast.id);
	});

	it('falls back down the order when the slot kind is nowhere', async () => {
		const {engine, props} = await setup().then(async t => {
			const props = t.engine.createCollection({name: 'props'});

			await addObject(t.engine, props.id, 'lamp', 'red');

			return {...t, props};
		});

		expect(collectionForTypedName(engine, 'S1', 'lamp', 'bg')).toBe(props.id);
		expect(collectionForTypedName(engine, 'S1', 'lamp', 'character')).toBe(
			props.id
		);
	});

	it('picks the first pack when two have it', async () => {
		const {city, engine, forest} = await setup();

		// city-pack sorts before forest-pack.
		expect(collectionForTypedName(engine, 'S1', 'street', 'bg')).toBe(city.id);
		expect(collectionForTypedName(engine, 'S1', 'woods', 'bg')).toBe(forest.id);
	});

	it('qualified name: its collection', async () => {
		const {engine, forest} = await setup();

		expect(
			collectionForTypedName(engine, 'S1', 'forest-pack/street', 'bg')
		).toBe(forest.id);
	});

	it('unknown name: nothing', async () => {
		const {engine} = await setup();

		expect(collectionForTypedName(engine, 'S1', 'nope', 'bg')).toBeUndefined();
	});
});
