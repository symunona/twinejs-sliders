/**
 * @jest-environment node
 */
import {describeChange} from '../../engine';
import {png} from '../../testing/fixtures';
import {shaOf, team, upload} from '../../testing/scenario';
import {AssetRecord} from '../../types';

// J. History: Versions…, Activity, downloads.

describe('J. history', () => {
	it('J1: revs lists server revs newest first; never-pushed record has none', async () => {
		const {world, ana, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		expect(await ana.engine.revs(night.id, 'asset')).toEqual([]);
		await world.settle();
		await ana.engine.replaceBlob(night.id, png('blue'), 'image/png');
		await world.settle();

		const revs = await ana.engine.revs(night.id, 'asset');

		expect(revs.map(entry => entry.rev)).toEqual([2, 1]);
		expect((revs[1].record as AssetRecord).blob).toBe(await shaOf('night'));
	});

	it('J2: restoreRev picture = new rev on the old blob, name kept', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		await ana.engine.replaceBlob(night.id, png('blue'), 'image/png');
		ana.engine.rename(night.id, 'late');
		await world.settle();

		const [, first] = await bo.engine.revs(night.id, 'asset');
		const restored = (await bo.engine.restoreRev(first.record)) as AssetRecord;

		expect(restored.blob).toBe(await shaOf('night'));
		expect(restored.name).toBe('late');
		await world.settle();
		expect(ana.get<AssetRecord>(night.id)!.blob).toBe(await shaOf('night'));
		expect(ana.get<AssetRecord>(night.id)!.rev).toBe(3);
	});

	it('J3: activity lists a collection’s changes, newest first, with what changed', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		bo.engine.rename(night.id, 'late');
		await world.settle();
		ana.engine.delete(night.id, 'asset');
		await world.settle();

		const feed = await bo.engine.activity(tavern.id);
		const actions = feed
			.filter(entry => entry.id === night.id)
			.map(entry => [entry.action, entry.by, entry.detail]);

		expect(actions).toEqual([
			['deleted', 'ana', undefined],
			['renamed', 'bo', 'night → late'],
			['created', 'ana', undefined]
		]);
		expect(feed.some(entry => entry.type === 'collection')).toBe(true);

		// Revert the delete = restore the rev before it.
		const deleted = feed[0];

		await bo.engine.restoreRev(deleted.previous!, 'all');
		await world.settle();
		expect(ana.get<AssetRecord>(night.id)).toMatchObject({
			deleted: false,
			name: 'late'
		});
	});

	it('J4: describeChange names the edit', () => {
		const base = {
			id: 'a',
			type: 'asset',
			rev: 1,
			by: 'x',
			at: '',
			deleted: false,
			collection: 'c',
			name: 'n',
			blob: 's'
		} as AssetRecord;

		expect(describeChange({...base}, {...base, tags: ['x']})).toEqual({
			action: 'edited',
			detail: 'tags'
		});
		expect(describeChange(base, {...base, blob: 't'}).action).toBe('repainted');
		expect(describeChange(base, {...base, collection: 'd'}).action).toBe('moved');
	});

	it('J5: status reports downloading while a blob is fetched', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();

		const seen: (number | undefined)[] = [];

		bo.engine.onStatus(status => seen.push(status.downloading));

		await bo.engine.blobBytes(night.blob);
		expect(bo.engine.downloading()).toEqual([]);
		expect(seen).toEqual([1, undefined]);
	});
});
