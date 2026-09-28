/**
 * @jest-environment node
 */
import {png} from '../../testing/fixtures';
import {names, shaOf, team, upload} from '../../testing/scenario';
import {AssetRecord} from '../../types';

// A. Edited art reaches the other browser (past: "edited never arrived").

describe('A. edited art reaches the other browser', () => {
	it('A1: a repaint reaches bo; the blob arrives on demand; server rev +1', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		expect(names(bo, tavern.id)).toEqual(['night']);

		await ana.engine.replaceBlob(night.id, png('day'), 'image/png');
		await world.settle();

		const daySha = await shaOf('day');

		expect(bo.get<AssetRecord>(night.id)!.blob).toBe(daySha);
		expect(world.server.record('asset', night.id)).toMatchObject({
			rev: 2,
			blob: daySha
		});

		// Not fetched until asked for, then fetched and cached.
		expect(await bo.blobs.has(daySha)).toBe(false);

		const fetched = await bo.engine.blobBytes(daySha);

		expect(Array.from(fetched.bytes)).toEqual(Array.from(png('day')));
		expect(await bo.blobs.has(daySha)).toBe(true);
	});

	it('A2: bo reloads after the repaint → still new sha, zero writes, rev unchanged', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		await ana.engine.replaceBlob(night.id, png('day'), 'image/png');
		await world.settle();

		const mark = bo.mark();

		await bo.reload();
		await world.settle();

		expect(bo.get<AssetRecord>(night.id)!.blob).toBe(await shaOf('day'));
		expect(bo.writes(mark)).toEqual([]);
		expect(world.server.record('asset', night.id)!.rev).toBe(2);
	});

	it.each([
		[
			'effect',
			{
				kind: 'glitch',
				amount: 40,
				rotate: 0,
				bands: 3,
				speed: 8,
				split: 20,
				period: 2,
				burst: 30,
				scanlines: 10,
				noise: 5
			}
		],
		['edits', {crop: {x: 0, y: 0, w: 2, h: 2}, brightness: 10}],
		['tuning', {threshold: 12, feather: 2}],
		['mask', {shapes: [{kind: 'rect', x: 0, y: 0, w: 1, h: 1}]}],
		[
			'walk',
			{
				polygons: [
					[
						{x: 0, y: 0.8},
						{x: 1, y: 0.8},
						{x: 1, y: 1}
					]
				]
			}
		],
		['origin', {x: 0.5, y: 1}]
	])('A3: recipe.%s alone travels', async (key, value) => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();

		const mark = bo.mark();

		ana.engine.updateAsset(night.id, {recipe: {[key]: value}});
		await world.settle();

		expect(bo.get<AssetRecord>(night.id)!.recipe).toEqual({[key]: value});
		expect(bo.writes(mark)).toEqual([]);
	});

	it('A4: an unknown recipe key travels — no whitelist', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		ana.engine.updateAsset(night.id, {recipe: {futureThing: 1}});
		await world.settle();

		expect(bo.get<AssetRecord>(night.id)!.recipe).toEqual({futureThing: 1});
		expect(world.server.record('asset', night.id)!.recipe).toEqual({
			futureThing: 1
		});
	});

	it('A5: sidecars src + cutout: named on bo, both blobs fetchable', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		await ana.engine.replaceBlob(night.id, png('blue'), 'image/png', {
			sidecars: {
				src: {bytes: png('night', 8, 8), mime: 'image/png'},
				cutout: {bytes: png('black'), mime: 'image/png'}
			}
		});
		await world.settle();

		const sidecars = bo.get<AssetRecord>(night.id)!.sidecars!;

		expect(sidecars).toEqual({
			src: await shaOf('night', 8, 8),
			cutout: await shaOf('black')
		});
		expect(Array.from((await bo.engine.blobBytes(sidecars.src)).bytes)).toEqual(
			Array.from(png('night', 8, 8))
		);
		expect(
			Array.from((await bo.engine.blobBytes(sidecars.cutout)).bytes)
		).toEqual(Array.from(png('black')));
	});

	it('A6: art no scene references still syncs', async () => {
		const {world, ana, bo, tavern} = await team();

		// No story, no binding, no refs anywhere.
		const loose = await upload(ana, tavern.id, 'unused-sketch', 'grey');

		await world.settle();

		expect(bo.get<AssetRecord>(loose.id)).toMatchObject({
			name: 'unused-sketch',
			blob: await shaOf('grey')
		});
		expect(bo.engine.usage(loose.id)).toEqual([]);
	});

	it('A7: a rename syncs: bo resolves the new name, the old one fails', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		bo.engine.createStory('S', {name: 'S'});
		await world.settle();
		bo.engine.bind('S', [tavern.id]);
		await world.settle();
		expect(bo.engine.resolver('S').asset('night')!.id).toBe(night.id);

		ana.engine.rename(night.id, 'tavern-night');
		await world.settle();

		const resolver = bo.engine.resolver('S');

		expect(resolver.asset('tavern-night')!.id).toBe(night.id);
		expect(resolver.asset('night')).toBeUndefined();
	});

	it('A7b: bo never saw the rename, edits tags → rename kept, stale name not pushed back', async () => {
		// The old per-story sync lost this one (77f72fde on sliders): a device that
		// missed a rename wrote its whole manifest back, stale name included.
		const {world, ana, bo, tavern} = await team({socket: 'dead'});
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		await bo.engine.poll();
		expect(bo.get<AssetRecord>(night.id)!.name).toBe('night');

		ana.engine.rename(night.id, 'tavern-night');
		await world.settle();
		// bo is stale: still 'night', and writes an unrelated field on it.
		expect(bo.get<AssetRecord>(night.id)!.name).toBe('night');
		bo.engine.updateAsset(night.id, {tags: ['wet']});
		await world.settle();
		await bo.engine.poll();
		await world.settle();

		expect(world.server.record('asset', night.id)).toMatchObject({
			name: 'tavern-night',
			tags: ['wet']
		});
		expect(bo.get<AssetRecord>(night.id)).toMatchObject({
			name: 'tavern-night',
			tags: ['wet']
		});
		await ana.engine.poll();
		expect(ana.get<AssetRecord>(night.id)!.name).toBe('tavern-night');
	});

	it('A8: metadata-only change, socket dead: bo gets it by polling', async () => {
		const {world, ana, bo, tavern} = await team({socket: 'dead'});
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		await bo.engine.poll();
		expect(bo.get<AssetRecord>(night.id)!.tags).toEqual([]);

		ana.engine.updateAsset(night.id, {tags: ['wet']});
		await world.settle();

		// Nothing woke bo.
		expect(bo.get<AssetRecord>(night.id)!.tags).toEqual([]);

		const mark = bo.mark();

		await bo.engine.poll();

		expect(bo.get<AssetRecord>(night.id)!.tags).toEqual(['wet']);
		expect(
			bo.since(mark).map(r => `${r.method} ${r.path.split('?')[0]}`)
		).toEqual(['GET /changes']);
	});
});
