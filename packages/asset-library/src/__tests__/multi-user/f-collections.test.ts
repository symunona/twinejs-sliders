/**
 * @jest-environment node
 */
import {CollectionNotEmptyError, NameTakenError} from '../../transport';
import {png} from '../../testing/fixtures';
import {byName, names, shaOf, team, upload} from '../../testing/scenario';
import {World} from '../../testing/world';
import {AssetRecord} from '../../types';

// F. Collections and sharing.

describe('F. collections and sharing', () => {
	it('F1: bo lists a new collection and its assets; blobs not fetched', async () => {
		const [world, ana, bo] = await World.create(['ana', 'bo']);
		const tavern = ana.engine.createCollection({name: 'tavern-set'});

		await upload(ana, tavern.id, 'night', 'night');
		await upload(ana, tavern.id, 'day', 'day');
		await world.settle();

		expect(bo.engine.collections().map(c => c.name)).toEqual(['tavern-set']);
		expect(names(bo, tavern.id)).toEqual(['day', 'night']);
		expect(await bo.blobs.list()).toEqual([]);
		expect(bo.requests.filter(r => r.path.startsWith('/blobs/'))).toEqual([]);
	});

	it('F2: bind to a story, resolve, blob fetched once', async () => {
		const {world, ana, bo, tavern} = await team();

		await upload(ana, tavern.id, 'night', 'night');
		bo.engine.createStory('S', {name: 'S'});
		await world.settle();
		bo.engine.bind('S', [tavern.id]);

		const night = bo.engine.resolver('S').asset('night')!;

		expect(night).toBeDefined();

		const mark = bo.mark();

		await bo.engine.blobBytes(night.blob);
		await bo.engine.blobBytes(night.blob);
		await Promise.all([
			bo.engine.blobBytes(night.blob),
			bo.engine.blobBytes(night.blob)
		]);

		expect(bo.since(mark).filter(r => r.path.startsWith('/blobs/'))).toEqual([
			{method: 'GET', path: `/blobs/${night.blob}`, status: 200}
		]);
	});

	it('F2b: an open story prefetches its bound collections’ blobs, not others', async () => {
		const {world, ana, bo, tavern} = await team();
		const other = ana.engine.createCollection({name: 'other'});

		await upload(ana, tavern.id, 'night', 'night');
		await upload(ana, other.id, 'elsewhere', 'green');
		bo.engine.createStory('S', {name: 'S'});
		await world.settle();
		bo.engine.bind('S', [tavern.id]);
		await bo.engine.openStory('S');
		await world.settle();

		expect(await bo.blobs.has(await shaOf('night'))).toBe(true);
		expect(await bo.blobs.has(await shaOf('green'))).toBe(false);

		// New art in a bound collection arrives with the next pull.
		await upload(ana, tavern.id, 'door', 'gold');
		await world.settle();
		expect(await bo.blobs.has(await shaOf('gold'))).toBe(true);
	});

	it('F3: both create collection `props` offline → second becomes props-2, reported', async () => {
		const [world, ana, bo] = await World.create(['ana', 'bo']);

		ana.offline();
		bo.offline();

		const anas = ana.engine.createCollection({name: 'props'});
		const bos = bo.engine.createCollection({name: 'props'});

		await ana.online();
		await world.settle();
		await bo.online();
		await world.settle();

		expect(world.server.record('collection', anas.id)!.name).toBe('props');
		expect(world.server.record('collection', bos.id)!.name).toBe('props-2');

		for (const browser of [ana, bo]) {
			expect(
				browser.engine
					.collections()
					.map(c => c.name)
					.sort()
			).toEqual(['props', 'props-2']);
		}

		expect(bo.notices).toContainEqual({
			kind: 'renamed-on-clash',
			type: 'collection',
			id: bos.id,
			from: 'props',
			to: 'props-2',
			holder: {type: 'collection', id: anas.id}
		});
	});

	it('F4: both add `stool` offline → second becomes stool-2, reported, both present', async () => {
		const {world, ana, bo, tavern} = await team();

		ana.offline();
		bo.offline();

		const anas = await upload(ana, tavern.id, 'stool', 'gold');
		const bos = await upload(bo, tavern.id, 'stool', 'grey');

		await ana.online();
		await world.settle();
		await bo.online();
		await world.settle();

		for (const browser of [ana, bo]) {
			expect(byName(browser, tavern.id, 'stool')!.id).toBe(anas.id);
			expect(byName(browser, tavern.id, 'stool-2')!.id).toBe(bos.id);
		}

		expect(bo.notices).toContainEqual(
			expect.objectContaining({
				kind: 'renamed-on-clash',
				id: bos.id,
				from: 'stool',
				to: 'stool-2'
			})
		);
	});

	it('F4b: three-way clash → stool, stool-2, stool-3', async () => {
		const {world, ana, bo, cy, tavern} = await team({
			names: ['ana', 'bo', 'cy']
		});

		for (const browser of [ana, bo, cy]) {
			browser.offline();
			await upload(
				browser,
				tavern.id,
				'stool',
				browser.name === 'ana' ? 1 : browser.name === 'bo' ? 2 : 3
			);
		}

		for (const browser of [ana, bo, cy]) {
			await browser.online();
			await world.settle();
		}

		for (const browser of [ana, bo, cy]) {
			expect(names(browser, tavern.id)).toEqual([
				'stool',
				'stool-2',
				'stool-3'
			]);
		}
	});

	it('F5: same bytes as two assets → one blob on the server, two records', async () => {
		const {world, ana, bo, tavern} = await team();

		ana.offline();
		bo.offline();

		const blobsBefore = world.server.blobCount();
		const a = await upload(ana, tavern.id, 'bench', 'gold');
		const b = await upload(bo, tavern.id, 'seat', 'gold');

		await ana.online();
		await bo.online();
		await world.settle();

		expect(world.server.blobCount()).toBe(blobsBefore + 1);
		expect(world.server.record('asset', a.id)!.blob).toBe(
			world.server.record('asset', b.id)!.blob
		);
		// Bo's has-check found it: bo never uploaded it.
		expect(bo.blobPuts()).toEqual([]);
	});

	it('F6: exact dupe reported before creating', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();

		const result = await bo.engine.addAsset(png('night'), 'image/png', {
			collection: tavern.id,
			name: 'night-again'
		});

		expect(result.asset).toBeUndefined();
		expect(result.duplicates.exact.map(a => a.id)).toEqual([night.id]);
		expect(names(bo, tavern.id)).toEqual(['night']);
		expect(
			(await bo.engine.findDuplicates(png('night'), 'image/png')).exact
		).toHaveLength(1);

		const forced = await bo.engine.addAsset(png('night'), 'image/png', {
			collection: tavern.id,
			name: 'night-again',
			allowDuplicate: true
		});

		expect(forced.asset!.blob).toBe(night.blob);
	});

	it('F7: pixel dupe (same image re-encoded) and a similar one reported', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night', {});

		await world.settle();

		const reencoded = png('night', 4, 4, {level: 0, comment: 're-exported'});
		const report = await bo.engine.findDuplicates(reencoded, 'image/png');

		expect(report.exact).toEqual([]);
		expect(report.pixel.map(a => a.id)).toEqual([night.id]);

		const result = await bo.engine.addAsset(reencoded, 'image/png', {
			collection: tavern.id,
			name: 'night-png0'
		});

		expect(result.asset).toBeUndefined();

		// One pixel changed: not the same picture, but it looks like it.
		const touched = await bo.engine.findDuplicates(
			png('night', 16, 16, {dot: 'white'}),
			'image/png'
		);
		const big = await upload(ana, tavern.id, 'night-big', 'night', {});

		await ana.engine.replaceBlob(big.id, png('night', 16, 16), 'image/png');
		await world.settle();

		const again = await bo.engine.findDuplicates(
			png('night', 16, 16, {dot: 'white'}),
			'image/png'
		);

		expect(touched.pixel).toEqual([]);
		expect(again.pixel).toEqual([]);
		expect(again.similar.map(s => s.asset.id)).toContain(big.id);
	});

	it('F8: move to another collection; name clash in the target checked', async () => {
		const {world, ana, bo, tavern} = await team();
		const binding = bo.engine.createStory('S', {name: 'Mine'});
		const stool = await upload(bo, binding.own, 'stool', 'gold');

		await upload(ana, tavern.id, 'lamp', 'white');
		await world.settle();

		bo.engine.move(stool.id, tavern.id);
		await world.settle();

		expect(world.server.record('asset', stool.id)!.collection).toBe(tavern.id);
		expect(byName(ana, tavern.id, 'stool')!.id).toBe(stool.id);

		const lamp = await upload(bo, binding.own, 'lamp', 'gold');

		expect(() => bo.engine.move(lamp.id, tavern.id)).toThrow(NameTakenError);
		expect(bo.get<AssetRecord>(lamp.id)!.collection).toBe(binding.own);

		// A clash bo could not see (ana's `rug` not pulled yet) is settled by the server.
		const rug = await upload(bo, binding.own, 'rug', 'grey');

		await world.settle();
		bo.offline();
		await upload(ana, tavern.id, 'rug', 'red');
		await world.settle();
		bo.engine.move(rug.id, tavern.id);
		bo.isOnline = true;
		await bo.engine.flush();
		await world.settle();

		expect(world.server.record('asset', rug.id)).toMatchObject({
			collection: tavern.id,
			name: 'rug-2'
		});
	});

	it('F9: copy → new id, same sha, sourceAsset set, zero blob uploads', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();

		const mark = bo.mark();
		const copy = bo.engine.copy(night.id);

		await world.settle();

		expect(copy.id).not.toBe(night.id);
		expect(copy).toMatchObject({
			name: 'night-2',
			blob: night.blob,
			sourceAsset: night.id
		});
		expect(world.server.record('asset', copy.id)).toMatchObject({
			blob: night.blob,
			sourceAsset: night.id
		});
		expect(bo.blobPuts(mark)).toEqual([]);
		expect(await bo.blobs.has(night.blob)).toBe(false);
	});

	it('F10: deleting a collection a story binds is refused, nothing deleted', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		ana.engine.createStory('S', {name: 'S'});
		await world.settle();
		ana.engine.bind('S', [tavern.id]);
		await world.settle();

		// Bo knows about the binding: refused locally, nothing sent.
		const mark = bo.mark();

		expect(() =>
			bo.engine.deleteCollection(tavern.id, {cascade: true})
		).toThrow(CollectionNotEmptyError);
		await world.settle();
		expect(bo.writes(mark)).toEqual([]);
		expect(bo.get(night.id)!.deleted).toBe(false);
		expect(world.server.record('collection', tavern.id)!.deleted).toBe(false);
	});

	it('F10b: the binding not pulled yet → server 409, bo reverts, nothing deleted', async () => {
		const {world, ana, bo} = await team({socket: 'manual'});
		const empty = ana.engine.createCollection({name: 'empty-set'});

		await world.settle();
		await world.deliver();
		ana.engine.createStory('S', {name: 'S'});
		await world.settle();
		ana.engine.bind('S', [empty.id]);
		await world.settle();

		// Bo never heard about the binding.
		expect(bo.engine.binding('S')).toBeUndefined();

		bo.engine.deleteCollection(empty.id);
		await bo.engine.flush();

		expect(
			bo.recordWrites().filter(r => r.path === `/collections/${empty.id}`)
		).toEqual([
			expect.objectContaining({
				method: 'DELETE',
				status: 409,
				code: 'collection-not-empty'
			})
		]);
		expect(bo.get(empty.id)!.deleted).toBe(false);
		expect(bo.engine.status()).toMatchObject({pending: 0});
		expect(bo.notices).toContainEqual(
			expect.objectContaining({kind: 'delete-refused', id: empty.id})
		);
		expect(world.server.record('collection', empty.id)!.deleted).toBe(false);
	});
});
