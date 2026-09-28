/**
 * @jest-environment node
 */
import {png} from '../../testing/fixtures';
import {byName, names, shaOf, team, upload} from '../../testing/scenario';
import {AssetRecord} from '../../types';

// B. Modified while checked out (past: "clobbered when the other had it open").
// "Checked out" = bo holds a dirty local edit not yet pushed (debounce pending, or offline).

async function nightTeam() {
	const t = await team();
	const night = await upload(t.ana, t.tavern.id, 'night', 'night', {
		tags: ['bar', 'night']
	});

	await t.world.settle();

	return {...t, night};
}

/** B2's setup: both repaint `night`, ana first; bo was offline. */
async function bothRepainted() {
	const t = await nightTeam();
	const {world, ana, bo, night} = t;

	bo.offline();
	await bo.engine.replaceBlob(night.id, png('red'), 'image/png');
	await ana.engine.replaceBlob(night.id, png('blue'), 'image/png');
	await world.settle();
	await bo.online();
	await world.settle();

	return t;
}

describe('B. modified while checked out', () => {
	it('B1: bo dirty tags, ana pushes recipe.effect → both kept, no conflict', async () => {
		const {world, ana, bo, night} = await nightTeam();

		bo.engine.updateAsset(night.id, {tags: ['bar', 'night', 'wet']});
		expect(bo.engine.state(night.id)!.dirty).toBe(true);

		ana.engine.updateAsset(night.id, {
			recipe: {effect: {kind: 'glitch'} as never}
		});
		await ana.engine.flush();
		await world.settle();

		for (const record of [
			world.server.record('asset', night.id) as AssetRecord,
			ana.get<AssetRecord>(night.id)!,
			bo.get<AssetRecord>(night.id)!
		]) {
			expect(record.tags).toEqual(['bar', 'night', 'wet']);
			expect(record.recipe).toEqual({effect: {kind: 'glitch'}});
		}

		expect(bo.engine.conflicts()).toEqual([]);
		expect(ana.engine.conflicts()).toEqual([]);
	});

	it('B2: both repaint, bo offline → bo in conflict, server = ana, bo’s blob kept', async () => {
		const {world, bo, night} = await bothRepainted();
		const state = bo.engine.state(night.id)!;

		expect(state.conflict).toMatchObject({kind: 'fields'});
		expect(state.conflict!.fields).toContain('blob');
		expect(state.conflict!.current).toMatchObject({blob: await shaOf('blue')});
		expect(state.local).toMatchObject({blob: await shaOf('red')});
		expect(world.server.record('asset', night.id)).toMatchObject({
			blob: await shaOf('blue')
		});
		expect(await bo.blobs.has(await shaOf('red'))).toBe(true);
		expect(bo.engine.status()).toMatchObject({conflicts: 1, pending: 0});
		expect(bo.notices).toContainEqual(
			expect.objectContaining({kind: 'conflict', id: night.id})
		);
	});

	it('B3: …resolve mine → server and ana get bo’s pixels at ana’s rev + 1', async () => {
		const {world, ana, bo, night} = await bothRepainted();
		const anaRev = world.server.record('asset', night.id)!.rev;

		bo.engine.resolve(night.id, 'mine');
		await world.settle();

		const red = await shaOf('red');

		expect(world.server.record('asset', night.id)).toMatchObject({
			blob: red,
			rev: anaRev + 1
		});
		expect(ana.get<AssetRecord>(night.id)!.blob).toBe(red);
		expect(Array.from((await ana.engine.blobBytes(red)).bytes)).toEqual(
			Array.from(png('red'))
		);
		expect(bo.engine.conflicts()).toEqual([]);
	});

	it('B4: …keep both → night = ana’s, night-2 = bo’s, on both browsers', async () => {
		const {world, ana, bo, night, tavern} = await bothRepainted();

		bo.engine.resolve(night.id, 'keep-both');
		await world.settle();

		const red = await shaOf('red');
		const blue = await shaOf('blue');

		for (const browser of [ana, bo]) {
			expect(names(browser, tavern.id)).toEqual(['night', 'night-2']);
			expect(byName(browser, tavern.id, 'night')).toMatchObject({
				id: night.id,
				blob: blue
			});
			expect(byName(browser, tavern.id, 'night-2')!.blob).toBe(red);
		}

		expect(bo.engine.conflicts()).toEqual([]);
	});

	it('B5: …resolve theirs → bo = ana’s, no write sent', async () => {
		const {world, bo, night} = await bothRepainted();
		const mark = bo.mark();

		bo.engine.resolve(night.id, 'theirs');
		await world.settle();

		expect(bo.get<AssetRecord>(night.id)!.blob).toBe(await shaOf('blue'));
		expect(bo.engine.state(night.id)).toMatchObject({dirty: false});
		expect(bo.writes(mark)).toEqual([]);
		expect(bo.engine.status()).toMatchObject({conflicts: 0, pending: 0});
	});

	it('B6: concurrent renames a / b → conflict on name, nothing auto-picked', async () => {
		const {world, ana, bo, night} = await nightTeam();

		bo.engine.rename(night.id, 'a');
		ana.engine.rename(night.id, 'b');
		await ana.engine.flush();
		await world.settle();

		const state = bo.engine.state(night.id)!;

		expect(state.conflict!.fields).toEqual(['name']);
		expect(state.local.name).toBe('a');
		expect(world.server.record('asset', night.id)!.name).toBe('b');
		expect(ana.get<AssetRecord>(night.id)!.name).toBe('b');

		bo.engine.resolve(night.id, {picks: {name: 'mine'}});
		await world.settle();

		expect(world.server.record('asset', night.id)!.name).toBe('a');
		expect(ana.get<AssetRecord>(night.id)!.name).toBe('a');
	});

	it('B7: bo edits, ana deletes → delete-vs-edit conflict; restore keeps bo’s edit', async () => {
		const {world, ana, bo, night} = await nightTeam();

		bo.engine.updateAsset(night.id, {tags: ['keep-me']});
		ana.engine.delete(night.id);
		await ana.engine.flush();
		await world.settle();

		expect(bo.engine.state(night.id)!.conflict!.fields).toContain('deleted');
		expect(world.server.record('asset', night.id)!.deleted).toBe(true);

		bo.engine.resolve(night.id, 'mine');
		await world.settle();

		for (const record of [
			world.server.record('asset', night.id) as AssetRecord,
			ana.get<AssetRecord>(night.id)!,
			bo.get<AssetRecord>(night.id)!
		]) {
			expect(record).toMatchObject({
				deleted: false,
				tags: ['keep-me'],
				name: 'night'
			});
		}
	});

	it('B7b: …accepting the delete sends nothing and leaves it deleted', async () => {
		const {world, ana, bo, night} = await nightTeam();

		bo.engine.updateAsset(night.id, {tags: ['keep-me']});
		ana.engine.delete(night.id);
		await ana.engine.flush();
		await world.settle();

		const mark = bo.mark();

		bo.engine.resolve(night.id, 'theirs');
		await world.settle();

		expect(bo.get<AssetRecord>(night.id)!.deleted).toBe(true);
		expect(bo.writes(mark)).toEqual([]);
	});

	it('B8: both edit tags differently → set merge, no conflict', async () => {
		const {world, ana, bo, night} = await nightTeam();

		bo.engine.updateAsset(night.id, {tags: ['night', 'wet']}); // -bar +wet
		ana.engine.updateAsset(night.id, {tags: ['bar', 'loud']}); // -night +loud
		await ana.engine.flush();
		await world.settle();

		for (const browser of [ana, bo]) {
			expect([...browser.get<AssetRecord>(night.id)!.tags!].sort()).toEqual([
				'loud',
				'wet'
			]);
		}

		expect(
			[...(world.server.record('asset', night.id) as AssetRecord).tags!].sort()
		).toEqual(['loud', 'wet']);
		expect(bo.engine.conflicts()).toEqual([]);
	});

	it('B9: recipe.edits vs recipe.mask → per-key merge, no conflict', async () => {
		const {world, ana, bo, night} = await nightTeam();

		bo.engine.updateAsset(night.id, {
			recipe: {edits: {brightness: 5} as never}
		});
		ana.engine.updateAsset(night.id, {recipe: {mask: {shapes: []} as never}});
		await ana.engine.flush();
		await world.settle();

		const expected = {edits: {brightness: 5}, mask: {shapes: []}};

		expect(world.server.record('asset', night.id)!.recipe).toEqual(expected);
		expect(ana.get<AssetRecord>(night.id)!.recipe).toEqual(expected);
		expect(bo.get<AssetRecord>(night.id)!.recipe).toEqual(expected);
		expect(bo.engine.conflicts()).toEqual([]);
	});
});
