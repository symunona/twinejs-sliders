import {World} from '../../../../packages/asset-library/src/testing/world';
import {setLibraryEngine, unbindStory} from '../engine-registry';
import {followStoryRename} from '../library-provider';

// jsdom has neither SubtleCrypto nor TextEncoder; the real engine needs both.
beforeAll(() => {
	if (typeof globalThis.TextEncoder === 'undefined') {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const util = require('util');

		Object.assign(globalThis, {
			TextDecoder: util.TextDecoder,
			TextEncoder: util.TextEncoder
		});
	}

	if (!globalThis.crypto?.subtle) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const {webcrypto} = require('crypto');

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		});
	}
});

/** Story rename → own collection rename; story delete → binding tombstoned, collection kept. */
describe('story ↔ own collection', () => {
	it('renames the own collection, numbered when the name is taken', async () => {
		const [, ana] = await World.create(['ana']);
		const own = ana.engine.createStory('S', {name: 'Old Mill'}).own;

		ana.engine.createCollection({name: 'New Mill'});
		followStoryRename(ana.engine, 'S', 'Old Mill', 'New Mill');
		expect(ana.engine.get(own, 'collection')!.name).toBe('New Mill-2');

		// Follows again from the numbered form.
		followStoryRename(ana.engine, 'S', 'New Mill', 'Mill');
		expect(ana.engine.get(own, 'collection')!.name).toBe('Mill');
	});

	it('leaves a collection somebody named by hand alone', async () => {
		const [, ana] = await World.create(['ana']);
		const own = ana.engine.createStory('S', {name: 'Old Mill'}).own;

		ana.engine.updateCollection(own, {name: 'mill-art'});
		followStoryRename(ana.engine, 'S', 'Old Mill', 'New Mill');
		expect(ana.engine.get(own, 'collection')!.name).toBe('mill-art');
	});

	it('unbindStory tombstones the binding and keeps the collection', async () => {
		const [world, ana] = await World.create(['ana']);
		const own = ana.engine.createStory('S', {name: 'Old Mill'}).own;

		await world.settle();
		await setLibraryEngine(ana.engine);
		await unbindStory('S');
		expect(ana.engine.binding('S')).toBeUndefined();
		expect(ana.engine.get(own, 'collection')!.deleted).toBe(false);
	});
});
