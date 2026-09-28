/**
 * @jest-environment node
 */
import {sha256Hex} from '../../hash';
import {png} from '../../testing/fixtures';
import {shaOf, team, upload} from '../../testing/scenario';
import {LoggedRequest} from '../../testing/world';
import {AssetRecord} from '../../types';

// C. Stale writer / ordering (past: "B overwrote A's blob and manifest").

function brief(requests: LoggedRequest[]): string[] {
	return requests.map(
		r =>
			`${r.method} ${r.path.split('?')[0]} ${r.status}${
				r.code ? ' ' + r.code : ''
			}`
	);
}

describe('C. stale writer / ordering', () => {
	it('C1: base rev 3, server at 5 → 412 → merge → PUT If-Match "5"; nothing rolls back', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night', {tags: []});

		await world.settle();
		ana.engine.updateAsset(night.id, {tags: ['r2']});
		await world.settle();
		ana.engine.updateAsset(night.id, {tags: ['r2', 'r3']});
		await world.settle();
		expect(bo.engine.state(night.id)!.base!.rev).toBe(3);

		bo.offline();
		ana.engine.updateAsset(night.id, {tags: ['r2', 'r3', 'r4']});
		await world.settle();
		await ana.engine.replaceBlob(night.id, png('day'), 'image/png');
		await world.settle();
		expect(world.server.record('asset', night.id)!.rev).toBe(5);

		bo.engine.updateAsset(night.id, {
			recipe: {effect: {kind: 'glitch'} as never}
		});

		// Back online and pushing before any pull: the stale-writer case exactly.
		bo.isOnline = true;

		const mark = bo.mark();

		await bo.engine.flush();

		const puts = bo.recordWrites(mark);

		expect(puts.map(p => [p.ifMatch, p.status])).toEqual([
			['"3"', 412],
			['"5"', 200]
		]);

		const server = world.server.record('asset', night.id) as AssetRecord;

		expect(server).toMatchObject({
			rev: 6,
			blob: await shaOf('day'),
			tags: ['r2', 'r3', 'r4'],
			recipe: {effect: {kind: 'glitch'}}
		});

		await world.settle();
		expect(ana.get<AssetRecord>(night.id)).toMatchObject({
			rev: 6,
			recipe: {effect: {kind: 'glitch'}}
		});
	});

	it('C2: blobs/has and blob PUTs precede the record PUT naming them', async () => {
		const {world, bo, tavern} = await team();
		const mark = bo.mark();
		const stool = await upload(bo, tavern.id, 'stool', 'gold', {
			sidecars: {src: {bytes: png('gold', 8, 8), mime: 'image/png'}}
		});

		await world.settle();

		const log = brief(bo.since(mark)).filter(
			line => !line.startsWith('GET /changes')
		);
		const gold = await shaOf('gold');
		const src = await shaOf('gold', 8, 8);

		expect(log[0]).toBe('POST /blobs/has 200');
		expect(log.slice(1, 3).sort()).toEqual(
			[`PUT /blobs/${gold} 200`, `PUT /blobs/${src} 200`].sort()
		);
		expect(log[3]).toBe(`PUT /assets/${stool.id} 200`);

		// A repaint: the new blob again goes first.
		const repaint = bo.mark();

		await bo.engine.replaceBlob(stool.id, png('green'), 'image/png');
		await world.settle();

		expect(
			brief(bo.since(repaint)).filter(line => !line.startsWith('GET /changes'))
		).toEqual([
			'POST /blobs/has 200',
			`PUT /blobs/${await shaOf('green')} 200`,
			`PUT /assets/${stool.id} 200`
		]);
	});

	it('C3: server lost the blob → 409 blob-missing → upload → retry succeeds', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();

		const sha = await shaOf('night');

		await bo.engine.blobBytes(sha);

		// The blob vanishes after bo's has-check said it was there.
		bo.beforeRequest = ({method, path}) => {
			if (method === 'PUT' && path.startsWith('/assets/')) {
				world.server.dropBlob(sha);
				bo.beforeRequest = undefined;
			}
		};

		const mark = bo.mark();

		bo.engine.updateAsset(night.id, {tags: ['after-loss']});
		await world.settle();

		expect(
			brief(bo.since(mark)).filter(line => !line.startsWith('GET /changes'))
		).toEqual([
			'POST /blobs/has 200',
			`PUT /assets/${night.id} 409 blob-missing`,
			`PUT /blobs/${sha} 200`,
			`PUT /assets/${night.id} 200`
		]);
		expect(world.server.hasBlob(sha)).toBe(true);
		expect(world.server.record('asset', night.id)!.tags).toEqual([
			'after-loss'
		]);
	});

	it('C3b: nobody has the blob any more → parked as blob-lost, no retry loop', async () => {
		const {world, ana, bo, tavern} = await team();
		const night = await upload(ana, tavern.id, 'night', 'night');

		await world.settle();
		world.server.dropBlob(await shaOf('night'));

		bo.engine.updateAsset(night.id, {tags: ['x']});

		const passes = await world.settle();

		expect(passes).toBeLessThan(5);
		expect(bo.engine.state(night.id)!.conflict).toMatchObject({
			kind: 'blob-lost'
		});
		expect(bo.notices).toContainEqual(
			expect.objectContaining({kind: 'blob-lost'})
		);

		// Ana still has the bytes: she repaints over it and bo can drop his edit.
		bo.engine.resolve(night.id, 'theirs');
		await world.settle();
		expect(bo.engine.status()).toMatchObject({pending: 0, conflicts: 0});
	});

	it('C4: blob upload fails mid-way → record not sent; a later drain sends blob then record', async () => {
		const {world, bo, tavern} = await team();

		bo.failNext(
			({method, path}) => method === 'PUT' && path.startsWith('/blobs/')
		);

		const mark = bo.mark();
		const stool = await upload(bo, tavern.id, 'stool', 'gold');

		await bo.engine.flush();

		expect(bo.recordWrites(mark)).toEqual([]);
		expect(bo.engine.status()).toMatchObject({offline: true, pending: 1});
		expect(world.server.record('asset', stool.id)).toBeUndefined();

		await world.settle();

		const gold = await sha256Hex(png('gold'));

		expect(
			brief(bo.since(mark)).filter(line => !line.startsWith('GET /changes'))
		).toEqual([
			'POST /blobs/has 200',
			`PUT /blobs/${gold} 0`,
			'POST /blobs/has 200',
			`PUT /blobs/${gold} 200`,
			`PUT /assets/${stool.id} 200`
		]);
		expect(world.server.record('asset', stool.id)).toMatchObject({
			blob: gold,
			rev: 1
		});
		expect(bo.engine.status()).toMatchObject({offline: false, pending: 0});
	});
});
