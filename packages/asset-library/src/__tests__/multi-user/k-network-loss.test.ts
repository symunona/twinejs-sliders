/**
 * @jest-environment node
 */
import {ChangeEvent} from '../../engine';
import {team, upload} from '../../testing/scenario';
import {AssetRecord} from '../../types';

// K. Network loss with a live socket (past: "↑N stuck until the next socket message").

describe('K. network loss', () => {
	it('K1: bo offline, edits, back online with no socket message or poll → the clock alone pushes', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		bo.offline();
		bo.engine.updateAsset(night.id, {tags: ['offline']});
		world.clock.advance(1000);
		await bo.engine.idle();
		expect(bo.engine.status()).toMatchObject({pending: 1, offline: true});

		// Network is back, but nobody tells the engine: no socket, no poll, no reconnect.
		bo.isOnline = true;
		world.clock.advance(60_000);
		await bo.engine.idle();

		expect(world.server.record('asset', night.id)!.tags).toEqual(['offline']);
		expect(bo.engine.status()).toMatchObject({pending: 0, offline: false});
	});

	it('K2: retries back off 2s, 4s, 8s … cap 60s, and reset after a success', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		bo.offline();
		bo.engine.updateAsset(night.id, {tags: ['one']});

		// Every attempt fails at its first request, so one request = one attempt.
		const attemptAfter = async (ms: number) => {
			const mark = bo.mark();

			world.clock.advance(ms - 1);
			await bo.engine.idle();
			expect(bo.since(mark)).toEqual([]);
			world.clock.advance(1);
			await bo.engine.idle();
			expect(bo.since(mark)).toHaveLength(1);
		};

		await attemptAfter(1000); // the debounce
		await attemptAfter(2000);
		await attemptAfter(4000);
		await attemptAfter(8000);
		await attemptAfter(16_000);
		await attemptAfter(32_000);
		await attemptAfter(60_000);
		await attemptAfter(60_000);

		bo.isOnline = true;
		world.clock.advance(60_000);
		await bo.engine.idle();
		expect(world.server.record('asset', night.id)!.tags).toEqual(['one']);

		// Next outage starts over at 2 s.
		bo.offline();
		bo.engine.updateAsset(night.id, {tags: ['two']});
		await attemptAfter(1000);
		await attemptAfter(2000);
		await attemptAfter(4000);
	});

	it('K3: a successful pull while a retry waits drains the outbox at once', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		bo.offline();
		bo.engine.updateAsset(night.id, {tags: ['offline']});
		world.clock.advance(1000);
		await bo.engine.idle();

		bo.isOnline = true;
		await bo.engine.poll();
		await bo.engine.idle();

		expect(world.server.record('asset', night.id)!.tags).toEqual(['offline']);
		expect(bo.engine.status()).toMatchObject({pending: 0, offline: false});
	});

	it('K4: nothing pending → no retry timer, offline or not', async () => {
		const {world, bo} = await team();
		const timers = world.clock.pending;

		bo.offline();
		await bo.engine.poll();
		expect(bo.engine.status().offline).toBe(true);
		expect(world.clock.pending).toBe(timers);
	});

	it('K5: a blob fetch that failed offline is not remembered; back online, the asset is re-announced and fetches', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		expect(await bo.blobs.has(night.blob)).toBe(false);

		bo.offline();
		await expect(bo.engine.blobBytes(night.blob)).rejects.toThrow();
		expect(bo.engine.status().offline).toBe(true);

		const events: ChangeEvent[] = [];
		bo.engine.onChange(event => events.push(event));

		await bo.online();
		await bo.engine.idle();

		// Whoever showed a hole for it re-asks now.
		expect(events.some(event => event.ids.includes(night.id))).toBe(true);
		const {bytes} = await bo.engine.blobBytes(night.blob);
		expect(bytes.byteLength).toBeGreaterThan(0);
		expect(bo.get<AssetRecord>(night.id)!.blob).toBe(night.blob);
	});
});
