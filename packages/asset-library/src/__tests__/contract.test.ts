/**
 * @jest-environment node
 */
import {FakeLibServer} from '../fake-server';
import {sha256Hex} from '../hash';
import {
	BadRecordError,
	BadRequestError,
	BlobMissingError,
	CollectionMissingError,
	CollectionNameTakenError,
	CollectionNotEmptyError,
	FetchLike,
	HashMismatchError,
	HttpTransport,
	LibError,
	NameTakenError,
	NotFoundError,
	StaleError
} from '../transport';
import {LibRecord, LibSocketMessage} from '../types';

/**
 * Transport-level contract (asset-library-contract.md). The same file runs against the
 * in-memory FakeLibServer and, when LIB_SERVER_URL + LIB_TOKEN are set, against the Go
 * server (`LIB_PORT=29101 scripts/lib-server-test.sh -- npx jest contract`). That is what
 * keeps the fake honest: every rule the engine tests lean on is pinned here too.
 */

const REAL_URL = process.env.LIB_SERVER_URL;
const REAL_TOKEN = process.env.LIB_TOKEN;
const targets: [string, boolean][] = [
	['fake', true],
	['go', !!(REAL_URL && REAL_TOKEN)]
];

function uuid(): string {
	return globalThis.crypto.randomUUID();
}

const encoder = new TextEncoder();
const run = Math.random().toString(36).slice(2, 8);

describe.each(targets)('contract against %s server', (target, enabled) => {
	const maybe = enabled ? it : it.skip;
	let fake: FakeLibServer;
	let fetcher: FetchLike;
	let base: string;
	let token: string;
	let lib: HttpTransport;
	let other: HttpTransport;

	beforeEach(() => {
		if (target === 'fake') {
			fake = new FakeLibServer();
			fetcher = fake.fetch;
			base = 'http://fake.test';
			token = fake.token;
		} else {
			fetcher = (url, init) => fetch(url, init as RequestInit);
			base = REAL_URL!;
			token = REAL_TOKEN!;
		}

		lib = new HttpTransport(base, token, 'ana', fetcher, `ana-${run}`);
		other = new HttpTransport(base, token, 'bo', fetcher, `bo-${run}`);
	});

	async function rejects<T extends LibError>(
		promise: Promise<unknown>,
		type: new (...args: never[]) => T
	): Promise<T> {
		try {
			await promise;
		} catch (error) {
			expect(error).toBeInstanceOf(type);
			return error as T;
		}

		throw new Error(`expected ${type.name}, got success`);
	}

	async function blob(text: string): Promise<string> {
		const bytes = encoder.encode(`${run}:${text}`);
		const sha = await sha256Hex(bytes);

		await lib.putBlob(sha, bytes, 'image/png');
		return sha;
	}

	async function collection(name: string, extra: Record<string, unknown> = {}) {
		const id = uuid();
		const {record} = await lib.putRecord(
			{
				id,
				type: 'collection',
				name: `${name}-${run}`,
				kind: 'shared',
				...extra
			} as never,
			{create: true}
		);

		return record;
	}

	async function asset(
		collectionId: string,
		name: string,
		sha: string,
		extra = {}
	) {
		const {record} = await lib.putRecord(
			{
				id: uuid(),
				type: 'asset',
				collection: collectionId,
				name,
				blob: sha,
				...extra
			} as never,
			{create: true}
		);

		return record;
	}

	describe('blobs', () => {
		maybe('has → PUT → has: missing, stored, idempotent', async () => {
			const bytes = encoder.encode(`${run}:blob-a`);
			const sha = await sha256Hex(bytes);

			expect(await lib.hasBlobs([sha])).toEqual([sha]);
			expect(await lib.putBlob(sha, bytes, 'image/png')).toEqual({
				sha,
				bytes: bytes.length,
				mime: 'image/png'
			});
			// Exists already → 200 same; first upload's mime wins.
			expect(await lib.putBlob(sha, bytes, 'image/webp')).toEqual({
				sha,
				bytes: bytes.length,
				mime: 'image/png'
			});
			expect(await lib.hasBlobs([sha])).toEqual([]);
			expect(await lib.headBlob(sha)).toBe(true);

			const got = await lib.getBlob(sha);

			expect(Array.from(got.bytes)).toEqual(Array.from(bytes));
			expect(got.mime).toBe('image/png');
		});

		maybe('GET carries immutable cache headers', async () => {
			const sha = await blob('cache');
			const response = await fetcher(`${base}/api/v1/lib/blobs/${sha}`, {
				method: 'GET',
				headers: {Authorization: `Bearer ${token}`}
			});

			expect(response.status).toBe(200);
			expect(response.headers.get('ETag')).toBe(`"${sha}"`);
			expect(response.headers.get('Cache-Control')).toBe(
				'private, max-age=31536000, immutable'
			);
		});

		maybe('hash mismatch → 422', async () => {
			const sha = await sha256Hex(encoder.encode(`${run}:not-these-bytes`));

			await rejects(
				lib.putBlob(sha, encoder.encode('other'), 'image/png'),
				HashMismatchError
			);
		});

		maybe('unknown → 404, bad sha → 400 bad-request', async () => {
			const sha = await sha256Hex(encoder.encode(`${run}:never-uploaded`));

			await rejects(lib.getBlob(sha), NotFoundError);
			expect(await lib.headBlob(sha)).toBe(false);
			await rejects(
				lib.putBlob('NOTASHA', encoder.encode('x'), 'image/png'),
				BadRequestError
			);
		});
	});

	describe('records', () => {
		maybe('create: rev 1, by = X-Client-Name, at in seconds', async () => {
			const record = await collection('create');

			expect(record.rev).toBe(1);
			expect(record.by).toBe('ana');
			expect(record.deleted).toBe(false);
			expect(record.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
			expect(await lib.getRecord('collection', record.id)).toEqual(record);
		});

		maybe('client rev/by/at are ignored', async () => {
			const id = uuid();
			const {record} = await lib.putRecord(
				{
					id,
					type: 'collection',
					name: `ignored-${run}`,
					kind: 'shared',
					rev: 99,
					by: 'mallory',
					at: 'x'
				} as never,
				{create: true}
			);

			expect(record).toMatchObject({rev: 1, by: 'ana'});
			expect(record.at).not.toBe('x');
		});

		maybe('create on an existing id → 412 with current', async () => {
			const record = await collection('twice');
			const error = await rejects(
				lib.putRecord({...record, name: `twice-b-${run}`}, {create: true}),
				StaleError
			);

			expect(error.current).toEqual(record);
		});

		maybe('no precondition → 428', async () => {
			const response = await fetcher(
				`${base}/api/v1/lib/collections/${uuid()}`,
				{
					method: 'PUT',
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						type: 'collection',
						name: `no-pre-${run}`,
						kind: 'shared'
					})
				}
			);

			expect(response.status).toBe(428);
			expect(JSON.parse(await response.text())).toMatchObject({
				error: 'precondition-required'
			});
		});

		maybe('stale If-Match → 412 with current; right rev → rev+1', async () => {
			const record = await collection('stale');
			const {record: second} = await lib.putRecord(
				{...record, description: 'one'},
				{rev: 1}
			);

			expect(second.rev).toBe(2);

			const error = await rejects(
				other.putRecord({...record, description: 'two'}, {rev: 1}),
				StaleError
			);

			expect(error.current).toEqual(second);
		});

		maybe('If-Match on an unknown id → 412, current null', async () => {
			const error = await rejects(
				lib.putRecord(
					{
						id: uuid(),
						type: 'collection',
						name: `ghost-${run}`,
						kind: 'shared'
					} as never,
					{rev: 3}
				),
				StaleError
			);

			expect(error.current).toBeNull();
		});

		maybe('unknown fields round-trip verbatim', async () => {
			const coll = await collection('verbatim');
			const sha = await blob('verbatim');
			const created = await asset(coll.id, 'thing', sha, {
				recipe: {futureThing: 1, effect: {kind: 'glitch', amount: 3}},
				somethingNew: {nested: [1, 'two']}
			});

			const fetched = (await lib.getRecord('asset', created.id)) as LibRecord;

			expect(fetched.recipe).toEqual({
				futureThing: 1,
				effect: {kind: 'glitch', amount: 3}
			});
			expect(fetched.somethingNew).toEqual({nested: [1, 'two']});
		});

		maybe(
			'bad-record: invalid id, bad kind, id mismatch, missing blob field',
			async () => {
				await rejects(
					lib.putRecord(
						{
							id: 'NOT-A-UUID',
							type: 'collection',
							name: 'x',
							kind: 'shared'
						} as never,
						{create: true}
					),
					BadRecordError
				);
				await rejects(
					lib.putRecord(
						{
							id: uuid(),
							type: 'collection',
							name: `k-${run}`,
							kind: 'weird'
						} as never,
						{create: true}
					),
					BadRecordError
				);

				const response = await fetcher(
					`${base}/api/v1/lib/collections/${uuid()}`,
					{
						method: 'PUT',
						headers: {
							Authorization: `Bearer ${token}`,
							'Content-Type': 'application/json',
							'If-None-Match': '*'
						},
						body: JSON.stringify({
							id: uuid(),
							name: `mismatch-${run}`,
							kind: 'shared'
						})
					}
				);

				expect(response.status).toBe(400);

				const coll = await collection('shape');

				await rejects(
					lib.putRecord(
						{
							id: uuid(),
							type: 'asset',
							collection: coll.id,
							name: 'noblob'
						} as never,
						{create: true}
					),
					BadRecordError
				);
			}
		);

		maybe('revs: newest first', async () => {
			const record = await collection('revs');

			await lib.putRecord({...record, description: 'b'}, {rev: 1});
			await lib.putRecord({...record, description: 'c'}, {rev: 2});

			const revs = await lib.revs('collection', record.id);

			expect(revs.map(rev => rev.rev)).toEqual([3, 2, 1]);
			expect(revs[0].record.description).toBe('c');
			await rejects(lib.revs('collection', uuid()), NotFoundError);
		});

		maybe('GET unknown → 404', async () => {
			await rejects(lib.getRecord('asset', uuid()), NotFoundError);
		});
	});

	describe('validation', () => {
		maybe(
			'collection names unique team-wide → collection-name-taken with holder',
			async () => {
				const first = await collection('same');
				const error = await rejects(
					other.putRecord(
						{
							id: uuid(),
							type: 'collection',
							name: first.name,
							kind: 'shared'
						} as never,
						{create: true}
					),
					CollectionNameTakenError
				);

				expect(error.holder).toEqual({type: 'collection', id: first.id});
			}
		);

		maybe(
			'asset in an unknown or deleted collection → collection-missing',
			async () => {
				const sha = await blob('orphan');

				await rejects(asset(uuid(), 'orphan', sha), CollectionMissingError);

				const coll = await collection('gone');

				await lib.deleteRecord('collection', coll.id, 1);
				await rejects(asset(coll.id, 'orphan', sha), CollectionMissingError);
			}
		);

		maybe('blob not on server → blob-missing listing it', async () => {
			const coll = await collection('missing-blob');
			const known = await blob('known');
			const unknown = await sha256Hex(encoder.encode(`${run}:unknown`));
			const error = await rejects(
				asset(coll.id, 'thing', known, {sidecars: {src: unknown}}),
				BlobMissingError
			);

			expect(error.missing).toEqual([unknown]);
		});

		maybe(
			'name unique in collection, shared with charId → name-taken with holder',
			async () => {
				const coll = await collection('names');
				const sha = await blob('names');
				const first = await asset(coll.id, 'stool', sha);
				const clash = await rejects(
					asset(coll.id, 'stool', sha),
					NameTakenError
				);

				expect(clash.holder).toEqual({type: 'asset', id: first.id});

				const characterClash = await rejects(
					lib.putRecord(
						{
							id: uuid(),
							type: 'character',
							collection: coll.id,
							charId: 'stool'
						} as never,
						{create: true}
					),
					NameTakenError
				);

				expect(characterClash.holder).toEqual({type: 'asset', id: first.id});

				// Same name, another collection: fine.
				const elsewhere = await collection('names-2');

				await asset(elsewhere.id, 'stool', sha);
			}
		);

		maybe(
			'validation order: collection-missing before name-taken before blob-missing',
			async () => {
				const coll = await collection('order');
				const sha = await blob('order');
				const unknown = await sha256Hex(encoder.encode(`${run}:order-unknown`));

				await asset(coll.id, 'taken', sha);
				await rejects(asset(uuid(), 'taken', unknown), CollectionMissingError);
				await rejects(asset(coll.id, 'taken', unknown), NameTakenError);
				await rejects(asset(coll.id, 'free', unknown), BlobMissingError);
			}
		);

		maybe(
			'binding: story-id pattern, own must be a live collection',
			async () => {
				const coll = await collection('bind');
				const storyId = `story-${run}.1`;
				const {record} = await lib.putRecord(
					{
						id: storyId,
						type: 'binding',
						own: coll.id,
						collections: [],
						refs: []
					} as never,
					{create: true}
				);

				expect(record.id).toBe(storyId);
				await rejects(
					lib.putRecord(
						{id: `s-${run}-2`, type: 'binding', own: uuid()} as never,
						{create: true}
					),
					CollectionMissingError
				);
				await rejects(
					lib.putRecord(
						{id: '-bad id', type: 'binding', own: coll.id} as never,
						{create: true}
					),
					BadRecordError
				);
			}
		);
	});

	describe('delete and restore', () => {
		maybe(
			'DELETE tombstones, rev+1, GET still 200; name is free again',
			async () => {
				const coll = await collection('del');
				const sha = await blob('del');
				const a = await asset(coll.id, 'lamp', sha);
				const {record: tomb} = await lib.deleteRecord('asset', a.id, 1);

				expect(tomb).toMatchObject({deleted: true, rev: 2, name: 'lamp'});
				expect(await lib.getRecord('asset', a.id)).toMatchObject({
					deleted: true,
					rev: 2
				});

				await asset(coll.id, 'lamp', sha);
			}
		);

		maybe('DELETE: unknown → 404, no If-Match → 428, stale → 412', async () => {
			await rejects(lib.deleteRecord('asset', uuid(), 1), NotFoundError);

			const coll = await collection('del-pre');
			const response = await fetcher(
				`${base}/api/v1/lib/collections/${coll.id}`,
				{
					method: 'DELETE',
					headers: {Authorization: `Bearer ${token}`}
				}
			);

			expect(response.status).toBe(428);
			await rejects(lib.deleteRecord('collection', coll.id, 7), StaleError);
		});

		maybe(
			'restore = PUT If-Match tombstone rev, deleted false, validated',
			async () => {
				const coll = await collection('restore');
				const sha = await blob('restore');
				const a = await asset(coll.id, 'chair', sha);
				const {record: tomb} = await lib.deleteRecord('asset', a.id, 1);
				const {record: back} = await lib.putRecord(
					{...tomb, deleted: false},
					{rev: 2}
				);

				expect(back).toMatchObject({deleted: false, rev: 3, name: 'chair'});

				// A restore into a now-taken name is refused like any update.
				await lib.deleteRecord('asset', a.id, 3);
				await asset(coll.id, 'chair', sha);
				await rejects(
					lib.putRecord({...back, deleted: false}, {rev: 4}),
					NameTakenError
				);
			}
		);

		maybe('PUT deleted: true = delete', async () => {
			const coll = await collection('put-del');
			const {record} = await lib.putRecord({...coll, deleted: true}, {rev: 1});

			expect(record).toMatchObject({deleted: true, rev: 2});
		});

		maybe(
			'collection holding live records, or bound → collection-not-empty',
			async () => {
				const coll = await collection('full');
				const sha = await blob('full');
				const a = await asset(coll.id, 'x', sha);
				const error = await rejects(
					lib.deleteRecord('collection', coll.id, 1),
					CollectionNotEmptyError
				);

				expect(error.count).toBe(1);
				await lib.deleteRecord('asset', a.id, 1);

				const bound = await collection('bound');
				const own = await collection('own');

				await lib.putRecord(
					{
						id: `s-${run}-bound`,
						type: 'binding',
						own: own.id,
						collections: [bound.id]
					} as never,
					{create: true}
				);
				await rejects(
					lib.deleteRecord('collection', bound.id, 1),
					CollectionNotEmptyError
				);
				await rejects(
					lib.putRecord({...bound, deleted: true}, {rev: 1}),
					CollectionNotEmptyError
				);
				await rejects(
					lib.deleteRecord('collection', own.id, 1),
					CollectionNotEmptyError
				);

				// Emptied: deletable.
				await lib.deleteRecord('collection', coll.id, 1);
			}
		);
	});

	describe('changes', () => {
		maybe(
			'since N: ascending, one item per record at its newest seq',
			async () => {
				const head = (await lib.changes(0, 1)).seq;
				const start = (await lib.changes(head)).seq;
				const a = await collection('feed-a');
				const b = await collection('feed-b');
				const {record: a2} = await lib.putRecord(
					{...a, description: 'again'},
					{rev: 1}
				);
				const page = await lib.changes(start);
				const ids = page.items.map(item => item.record.id);

				expect(ids).toEqual([b.id, a.id]);
				expect(page.items[1].record).toEqual(a2);
				expect(page.items[0].seq).toBeLessThan(page.items[1].seq);
				expect(page.seq).toBe(page.items[1].seq);
				expect(page.more).toBe(false);

				const empty = await lib.changes(page.seq);

				expect(empty).toEqual({seq: page.seq, items: [], more: false});
			}
		);

		maybe('limit + more pages through', async () => {
			const start = (await lib.changes(0, 2000)).seq;
			const made: string[] = [];

			for (let i = 0; i < 3; i++) {
				made.push((await collection(`page-${i}`)).id);
			}

			const first = await lib.changes(start, 2);

			expect(first.items.map(item => item.record.id)).toEqual(made.slice(0, 2));
			expect(first.more).toBe(true);

			const second = await lib.changes(first.seq, 2);

			expect(second.items.map(item => item.record.id)).toEqual(made.slice(2));
			expect(second.more).toBe(false);
		});

		maybe('bad since → 400 bad-request', async () => {
			const response = await fetcher(`${base}/api/v1/lib/changes?since=-1`, {
				method: 'GET',
				headers: {Authorization: `Bearer ${token}`}
			});

			expect(response.status).toBe(400);
		});

		maybe('deletes are in the feed', async () => {
			const coll = await collection('feed-del');
			const start = (await lib.changes(0, 2000)).seq;

			await lib.deleteRecord('collection', coll.id, 1);

			const page = await lib.changes(start);

			expect(page.items).toHaveLength(1);
			expect(page.items[0].record).toMatchObject({
				id: coll.id,
				deleted: true,
				rev: 2
			});
		});
	});

	if (target === 'fake') {
		it('socket: every connection but the writer’s gets {t, seq, type, id, rev, by}', async () => {
			const ana: LibSocketMessage[] = [];
			const bo: LibSocketMessage[] = [];

			fake.connect(`ana-${run}`, message => ana.push(message));
			fake.connect(`bo-${run}`, message => bo.push(message));

			const record = await collection('socket');

			expect(ana).toEqual([]);
			expect(bo).toEqual([
				{
					t: 'lib',
					seq: fake.head,
					type: 'collection',
					id: record.id,
					rev: 1,
					by: 'ana'
				}
			]);
		});
	}

	maybe('auth: wrong token refused', async () => {
		const stranger = new HttpTransport(base, 'wrong-token', 'eve', fetcher);

		await expect(stranger.changes(0)).rejects.toMatchObject({status: 401});
	});
});
