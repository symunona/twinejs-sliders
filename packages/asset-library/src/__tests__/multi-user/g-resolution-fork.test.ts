/**
 * @jest-environment node
 */
import {LockedError} from '../../engine';
import {png} from '../../testing/fixtures';
import {shaOf, team, upload} from '../../testing/scenario';
import {AssetRecord} from '../../types';

// G. Resolution, fork, update-all.

async function twoStories() {
	const t = await team();
	const {world, ana, bo, tavern} = t;
	const night = await upload(ana, tavern.id, 'night', 'night');

	ana.engine.createStory('S1', {name: 'Night Market'});
	bo.engine.createStory('S2', {name: 'Old Mill'});
	await world.settle();
	ana.engine.bind('S1', [tavern.id]);
	bo.engine.bind('S2', [tavern.id]);
	await world.settle();

	return {...t, night};
}

describe('G. resolution, fork, update-all', () => {
	it('G1 + G2: first attached collection wins, lint says ambiguous; qualified picks', async () => {
		const {world, ana, tavern} = await team();
		const fantasy = ana.engine.createCollection({name: 'fantasy'});
		const tNight = await upload(ana, tavern.id, 'night', 'night');
		const fNight = await upload(ana, fantasy.id, 'night', 'blue');

		ana.engine.createStory('S', {name: 'S'});
		await world.settle();
		ana.engine.bind('S', [tavern.id, fantasy.id]);

		const resolver = ana.engine.resolver('S');

		expect(resolver.asset('night')!.id).toBe(tNight.id);
		expect(resolver.lint(['night'])).toEqual([
			expect.objectContaining({
				code: 'ambiguous',
				collections: ['tavern-set', 'fantasy']
			})
		]);
		expect(resolver.asset('fantasy/night')!.id).toBe(fNight.id);
		expect(resolver.lint(['fantasy/night'])).toEqual([]);
	});

	it('G3: fork into S1 and repaint → S1 sees the fork, S2 the original; names unchanged', async () => {
		const {world, ana, bo, night} = await twoStories();
		const fork = ana.engine.fork(night.id, 'S1');

		await ana.engine.replaceBlob(fork.id, png('red'), 'image/png');
		await world.settle();

		const red = await shaOf('red');

		expect(fork).toMatchObject({name: 'night', sourceAsset: night.id});

		for (const browser of [ana, bo]) {
			expect(browser.engine.resolver('S1').asset('night')).toMatchObject({
				id: fork.id,
				blob: red
			});
			expect(browser.engine.resolver('S2').asset('night')).toMatchObject({
				id: night.id,
				blob: night.blob
			});
			expect(browser.engine.resolver('S1').lint(['night'])).toEqual([
				expect.objectContaining({code: 'shadowed', level: 'info'})
			]);
		}

		// The original is untouched on the server.
		expect(world.server.record('asset', night.id)).toMatchObject({
			rev: 1,
			blob: night.blob
		});
	});

	it('G4: unfork → S1 sees the original again', async () => {
		const {world, ana, bo, night} = await twoStories();
		const fork = ana.engine.fork(night.id, 'S1');

		await world.settle();
		ana.engine.unfork(fork.id);
		await world.settle();

		for (const browser of [ana, bo]) {
			expect(browser.engine.resolver('S1').asset('night')!.id).toBe(night.id);
		}
	});

	it('G5: usage = stories whose bindings reference the asset, on both browsers', async () => {
		const {world, ana, bo, night, tavern} = await twoStories();
		const other = await upload(ana, tavern.id, 'day', 'day');

		ana.engine.setRefs('S1', [night.id, other.id]);
		bo.engine.setRefs('S2', [night.id]);
		await world.settle();

		for (const browser of [ana, bo]) {
			expect(browser.engine.usage(night.id)).toEqual(['S1', 'S2']);
			expect(browser.engine.usage(other.id)).toEqual(['S1']);
		}

		// Re-deriving the same refs is not an edit.
		const mark = ana.mark();

		ana.engine.setRefs('S1', [other.id, night.id, night.id]);
		await world.settle();
		expect(ana.writes(mark)).toEqual([]);
	});

	it('G6: update-all repaint → both stories see the new pixels', async () => {
		const {world, ana, bo, night} = await twoStories();

		await ana.engine.replaceBlob(night.id, png('gold'), 'image/png');
		await world.settle();

		const gold = await shaOf('gold');

		for (const browser of [ana, bo]) {
			expect(browser.engine.resolver('S1').asset('night')!.blob).toBe(gold);
			expect(browser.engine.resolver('S2').asset('night')!.blob).toBe(gold);
		}
	});

	it('G7: locked collection refuses update-all without override; fork allowed', async () => {
		const {world, ana, bo, night, tavern} = await twoStories();

		ana.engine.updateCollection(tavern.id, {locked: true});
		await world.settle();

		await expect(
			bo.engine.replaceBlob(night.id, png('red'), 'image/png')
		).rejects.toThrow(LockedError);
		expect(() =>
			bo.engine.updateAsset(night.id, {
				recipe: {effect: {kind: 'glitch'} as never}
			})
		).toThrow(LockedError);
		expect(bo.engine.status().pending).toBe(0);

		// Tags are not pixels: allowed.
		bo.engine.updateAsset(night.id, {tags: ['curated']});

		// Fork is the way.
		const fork = bo.engine.fork(night.id, 'S2');

		await bo.engine.replaceBlob(fork.id, png('red'), 'image/png');

		// Explicit override still works.
		await bo.engine.replaceBlob(night.id, png('green'), 'image/png', {
			override: true
		});
		await world.settle();

		expect(world.server.record('asset', night.id)).toMatchObject({
			blob: await shaOf('green'),
			tags: ['curated']
		});
		expect(ana.engine.resolver('S2').asset('night')!.blob).toBe(
			await shaOf('red')
		);
		expect(ana.get<AssetRecord>(fork.id)!.sourceAsset).toBe(night.id);
	});
});
