/**
 * @jest-environment node
 */
import {png} from '../../testing/fixtures';
import {team, upload} from '../../testing/scenario';
import {AssetRecord} from '../../types';

// D. No ping-pong (past: two browsers pushing art at each other forever).

describe('D. no ping-pong', () => {
	it('D1: ana makes 20 mixed edits → settle finishes, bo issues zero writes', async () => {
		const {world, ana, bo, tavern} = await team();
		const mark = bo.mark();
		const made: AssetRecord[] = [];

		for (let i = 0; i < 5; i++) {
			made.push(await upload(ana, tavern.id, `prop-${i}`, i + 1));
		}

		// Pushed before the delete below, so it is a tombstone and restore has one to undo.
		await world.settle();

		ana.engine.updateAsset(made[0].id, {tags: ['a']});
		ana.engine.updateAsset(made[1].id, {
			recipe: {effect: {kind: 'glitch'} as never}
		});
		ana.engine.rename(made[2].id, 'renamed');
		await ana.engine.replaceBlob(made[3].id, png(99), 'image/png');
		ana.engine.delete(made[4].id);
		await world.settle();

		ana.engine.restore(made[4].id);
		ana.engine.updateAsset(made[0].id, {tags: ['a', 'b']});
		ana.engine.copy(made[0].id);
		ana.engine.putCharacter({
			collection: tavern.id,
			charId: 'mira',
			poses: {idle: {asset: made[1].id}}
		});
		await ana.engine.replaceBlob(made[1].id, png(100), 'image/png');
		await world.settle();

		const shelf = ana.engine.createCollection({name: 'shelf'});

		ana.engine.move(made[2].id, shelf.id);
		ana.engine.updateAsset(made[3].id, {recipe: {origin: {x: 0.5, y: 1}}});
		ana.engine.updateAsset(made[3].id, {tags: ['z']});
		ana.engine.rename(made[0].id, 'first');
		ana.engine.updateCollection(tavern.id, {description: 'the tavern'});

		const passes = await world.settle();

		expect(passes).toBeLessThan(10);
		expect(bo.writes(mark)).toEqual([]);
		expect(
			bo.engine
				.assets()
				.map(a => a.name)
				.sort()
		).toEqual(
			ana.engine
				.assets()
				.map(a => a.name)
				.sort()
		);
	});

	it('D2: disjoint simultaneous edits; the second settle issues zero requests', async () => {
		const {world, ana, bo, tavern} = await team();
		const one = await upload(ana, tavern.id, 'one', 1);
		const two = await upload(ana, tavern.id, 'two', 2);

		await world.settle();
		ana.engine.updateAsset(one.id, {tags: ['ana']});
		bo.engine.updateAsset(two.id, {tags: ['bo']});
		await world.settle();

		const before = world.totalRequests();
		const passes = await world.settle();

		expect(passes).toBe(1);
		expect(world.totalRequests()).toBe(before);
		expect(bo.get<AssetRecord>(one.id)!.tags).toEqual(['ana']);
		expect(ana.get<AssetRecord>(two.id)!.tags).toEqual(['bo']);
	});

	it('D3: the same socket message 3× → at most one /changes read, zero writes', async () => {
		const {world, ana, bo, tavern} = await team({socket: 'manual'});

		await world.deliver();

		const night = await upload(ana, tavern.id, 'night', 'night');

		await ana.engine.flush();
		expect(bo.inbox).toHaveLength(1);

		const message = bo.inbox[0];

		bo.inbox.push({...message}, {...message});

		const mark = bo.mark();

		await world.deliver(bo);

		expect(bo.since(mark).map(r => `${r.method} ${r.path}`)).toEqual([
			`GET /changes?since=${message.seq - 1}`
		]);
		expect(bo.get<AssetRecord>(night.id)).toBeDefined();

		// And again later: already applied, nothing to read.
		bo.inbox.push({...message});
		await world.deliver(bo);
		expect(bo.since(mark)).toHaveLength(1);
	});
});
