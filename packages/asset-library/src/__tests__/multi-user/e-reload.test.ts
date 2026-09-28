/**
 * @jest-environment node
 */
import {png} from '../../testing/fixtures';
import {team, upload} from '../../testing/scenario';
import {AssetRecord} from '../../types';

// E. Reload / persistence (past: "reload = server wins, edit lost").

describe('E. reload / persistence', () => {
	it('E0: an edit pushes after the debounce, not before', async () => {
		const {world, ana, tavern} = await team();
		const mark = ana.mark();

		await upload(ana, tavern.id, 'night', 'night');
		world.clock.advance(999);
		await ana.engine.idle();
		expect(ana.recordWrites(mark)).toEqual([]);

		world.clock.advance(1);
		await ana.engine.idle();
		expect(ana.recordWrites(mark)).toHaveLength(1);
	});

	it('E1: bo edits, reloads before the debounce fires → the edit still reaches the server', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		bo.engine.updateAsset(night.id, {tags: ['before-reload']});
		expect(world.clock.pending).toBeGreaterThan(0);

		await bo.reload();
		// The old engine's timer is gone with it.
		world.clock.advance(5000);
		expect(bo.engine.state(night.id)).toMatchObject({dirty: true});

		await world.settle();

		expect(world.server.record('asset', night.id)!.tags).toEqual([
			'before-reload'
		]);
		expect(ana.get<AssetRecord>(night.id)!.tags).toEqual(['before-reload']);
	});

	it('E2: offline, 3 edits, reload, online → all 3 on the server', async () => {
		const {world, ana, bo, tavern} = await team();
		const a = await upload(ana, tavern.id, 'a', 1);
		const b = await upload(ana, tavern.id, 'b', 2);

		await world.settle();
		bo.offline();
		bo.engine.updateAsset(a.id, {tags: ['offline']});
		await bo.engine.replaceBlob(b.id, png('red'), 'image/png');
		const c = await upload(bo, tavern.id, 'c', 3);

		await bo.engine.flush();
		await bo.reload();
		expect(bo.engine.status()).toMatchObject({pending: 3});

		await bo.online();
		await world.settle();

		expect(world.server.record('asset', a.id)!.tags).toEqual(['offline']);
		expect(world.server.record('asset', b.id)!.blob).toBe(
			bo.get<AssetRecord>(b.id)!.blob
		);
		expect(world.server.record('asset', c.id)).toMatchObject({
			name: 'c',
			rev: 1
		});
		expect(ana.get<AssetRecord>(c.id)).toBeDefined();
	});

	it('E3: clean bo reloads → zero writes, pull resumes from the saved cursor', async () => {
		const {world, ana, bo, tavern} = await team();

		await upload(ana, tavern.id, 'night', 'night');
		await world.settle();

		const cursor = bo.engine.syncCursor;

		expect(cursor).toBe(world.server.head);
		expect(cursor).toBeGreaterThan(0);

		const mark = bo.mark();

		await bo.reload();
		await world.settle();

		expect(bo.since(mark).map(r => `${r.method} ${r.path}`)).toEqual([
			`GET /changes?since=${cursor}`
		]);
		expect(bo.writes(mark)).toEqual([]);
	});

	it('E4: bo reloads mid-conflict → conflict, base, local, current intact', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		bo.offline();
		await bo.engine.replaceBlob(night.id, png('red'), 'image/png');
		await ana.engine.replaceBlob(night.id, png('blue'), 'image/png');
		await world.settle();
		await bo.online();
		await world.settle();

		const before = bo.engine.state(night.id)!;

		expect(before.conflict).toBeDefined();

		await bo.reload();

		expect(bo.engine.state(night.id)).toEqual(before);
		expect(bo.engine.conflicts()).toHaveLength(1);
		expect(bo.engine.status()).toMatchObject({conflicts: 1, pending: 0});

		const mark = bo.mark();

		await world.settle();
		expect(bo.writes(mark)).toEqual([]);
	});
});
