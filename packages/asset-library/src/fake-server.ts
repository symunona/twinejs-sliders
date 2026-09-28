import {isSha, sha256Hex} from './hash';
import {
	FetchInit,
	FetchLike,
	FetchResponseLike,
	LIB_BASE_PATH
} from './transport';
import {
	LibRecord,
	LibSocketMessage,
	RECORD_TYPES,
	RecordType,
	TYPE_PATHS,
	recordKey
} from './types';

/**
 * The library server, in memory, speaking HTTP through a `fetch`-shaped function.
 *
 * Mirrors `server/lib` rule for rule and in the same order, so a client that passes here
 * passes against Go; `contract.test.ts` runs one suite against both to keep it that way.
 *
 * PUT record order (as in Go): If-Match parse (400) → precondition (428 / 412) → id and
 * body shape (400) → `deleted: true` ? collection-not-empty : collection exists →
 * namespace → blobs exist → commit.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STORY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const MAX_REVS = 50;
const DEFAULT_MIME = 'application/octet-stream';

const PATH_TYPES: Record<string, RecordType> = Object.fromEntries(
	RECORD_TYPES.map(type => [TYPE_PATHS[type], type])
);

class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		readonly extra: Record<string, unknown> = {}
	) {
		super(`${status} ${code}`);
	}
}

const badRecord = (detail: string) =>
	new HttpError(400, 'bad-record', {detail});
const badRequest = (detail: string) =>
	new HttpError(400, 'bad-request', {detail});

interface Info {
	deleted: boolean;
	/** Collection name, asset name, character charId. */
	name: string;
	/** Asset/character collection, binding own. */
	collection: string;
	blobs: string[];
	/** Binding: own + collections. */
	bound: string[];
	bad: string;
}

function parseInfo(type: RecordType, record: Record<string, unknown>): Info {
	const info: Info = {
		deleted: record.deleted === true,
		name: '',
		collection: '',
		blobs: [],
		bound: [],
		bad: ''
	};
	const str = (field: string): string => {
		if (!(field in record)) {
			info.bad ||= `${field} is required`;
			return '';
		}

		const value = record[field];

		if (typeof value !== 'string' || value === '') {
			info.bad ||= `${field} must be a non-empty string`;
			return typeof value === 'string' ? value : '';
		}

		return value;
	};

	switch (type) {
		case 'collection': {
			info.name = str('name');
			const kind = str('kind');

			if (!info.bad && kind !== 'story' && kind !== 'shared') {
				info.bad = 'kind must be story or shared';
			}
			break;
		}
		case 'asset': {
			info.collection = str('collection');
			info.name = str('name');
			const blob = str('blob');

			if (!info.bad && !isSha(blob)) {
				info.bad = 'blob must be a lowercase sha256';
			}

			info.blobs.push(blob);

			const sidecars = record.sidecars;

			if (sidecars !== undefined && sidecars !== null) {
				if (typeof sidecars !== 'object' || Array.isArray(sidecars)) {
					info.bad ||= 'sidecars must be {kind: sha}';
				} else {
					for (const sha of Object.values(sidecars)) {
						if (typeof sha !== 'string') {
							info.bad ||= 'sidecars must be {kind: sha}';
							continue;
						}

						if (!info.bad && !isSha(sha)) {
							info.bad = 'sidecar must be a lowercase sha256';
						}

						info.blobs.push(sha);
					}
				}
			}
			break;
		}
		case 'character':
			info.collection = str('collection');
			info.name = str('charId');
			break;
		case 'binding':
			info.collection = str('own');
			info.bound.push(info.collection);

			if (Array.isArray(record.collections)) {
				info.bound.push(
					...record.collections.filter(
						(id): id is string => typeof id === 'string'
					)
				);
			}
			break;
	}

	return info;
}

function validId(type: RecordType, id: string): boolean {
	if (type === 'binding') {
		return STORY_ID.test(id) && id !== '.' && id !== '..';
	}

	return UUID.test(id);
}

interface Entry {
	json: string;
	info: Info;
	rev: number;
}

interface FeedEntry {
	seq: number;
	type: RecordType;
	id: string;
	rev: number;
}

interface Socket {
	clientId: string;
	send(message: LibSocketMessage): void;
}

function headerOf(headers: Record<string, string>, name: string): string {
	const lower = name.toLowerCase();

	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lower) {
			return value.trim();
		}
	}

	return '';
}

function response(
	status: number,
	body: unknown,
	headers: Record<string, string> = {}
): FetchResponseLike {
	const isBytes = body instanceof Uint8Array;
	const text = body === undefined ? '' : isBytes ? '' : JSON.stringify(body);
	const bytes = isBytes ? (body as Uint8Array) : new TextEncoder().encode(text);
	const allHeaders: Record<string, string> = {
		...(isBytes ? {} : {'content-type': 'application/json; charset=utf-8'}),
		...Object.fromEntries(
			Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
		)
	};

	return {
		status,
		headers: {get: name => allHeaders[name.toLowerCase()] ?? null},
		arrayBuffer: async () => new Uint8Array(bytes).buffer,
		text: async () => (isBytes ? new TextDecoder().decode(bytes) : text)
	};
}

function toBytes(body: FetchInit['body']): Uint8Array {
	if (body === undefined) {
		return new Uint8Array(0);
	}

	return typeof body === 'string' ? new TextEncoder().encode(body) : body;
}

export interface FakeLibServerOptions {
	token?: string;
	/** MAX_ASSET_BYTES. */
	maxBlobBytes?: number;
	/** For `at`. Defaults to wall time. */
	now?: () => number;
}

export class FakeLibServer {
	readonly token: string;
	private maxBlobBytes: number;
	private now: () => number;
	private records = new Map<string, Entry>();
	private revs = new Map<string, string[]>();
	private feed: FeedEntry[] = [];
	private latest = new Map<string, number>();
	private seq = 0;
	private blobs = new Map<string, {bytes: Uint8Array; mime: string}>();
	private sockets = new Set<Socket>();

	constructor(options: FakeLibServerOptions = {}) {
		this.token = options.token ?? 'fake-lib-token';
		this.maxBlobBytes = options.maxBlobBytes ?? 64 << 20;
		this.now = options.now ?? (() => Date.now());
	}

	// -------------------------------------------------------------------------
	// Test hooks
	// -------------------------------------------------------------------------

	/** A socket connection. `clientId` = the hello `client`; the writer's own is skipped. */
	connect(
		clientId: string,
		send: (message: LibSocketMessage) => void
	): () => void {
		const socket = {clientId, send};

		this.sockets.add(socket);

		return () => this.sockets.delete(socket);
	}

	get head(): number {
		return this.seq;
	}

	record(type: RecordType, id: string): LibRecord | undefined {
		const entry = this.records.get(recordKey(type, id));

		return entry && JSON.parse(entry.json);
	}

	allRecords(): LibRecord[] {
		return Array.from(this.records.values(), entry => JSON.parse(entry.json));
	}

	hasBlob(sha: string): boolean {
		return this.blobs.has(sha);
	}

	blobCount(): number {
		return this.blobs.size;
	}

	/** Simulates a server that lost a blob (contract test C3). */
	dropBlob(sha: string): void {
		this.blobs.delete(sha);
	}

	// -------------------------------------------------------------------------
	// HTTP
	// -------------------------------------------------------------------------

	readonly fetch: FetchLike = async (url, init) => {
		try {
			return await this.route(url, init);
		} catch (error) {
			if (error instanceof HttpError) {
				return response(error.status, {error: error.code, ...error.extra});
			}

			return response(500, {error: 'internal', detail: String(error)});
		}
	};

	private async route(
		url: string,
		init: FetchInit
	): Promise<FetchResponseLike> {
		const parsed = new URL(url, 'http://fake.invalid');
		const path = parsed.pathname;

		if (headerOf(init.headers, 'Authorization') !== `Bearer ${this.token}`) {
			throw new HttpError(401, 'unauthorized');
		}

		if (!path.startsWith(LIB_BASE_PATH + '/')) {
			throw new HttpError(404, 'not-found');
		}

		const parts = path
			.slice(LIB_BASE_PATH.length + 1)
			.split('/')
			.map(decodeURIComponent);
		const method = init.method.toUpperCase();

		if (parts[0] === 'blobs') {
			if (parts.length === 2 && parts[1] === 'has' && method === 'POST') {
				return this.blobsHas(init);
			}

			if (parts.length === 2 && method === 'PUT') {
				return this.putBlob(parts[1], init);
			}

			if (parts.length === 2 && (method === 'GET' || method === 'HEAD')) {
				return this.getBlob(parts[1], method === 'HEAD');
			}
		}

		if (parts[0] === 'changes' && parts.length === 1 && method === 'GET') {
			return this.changes(parsed.searchParams);
		}

		const type = PATH_TYPES[parts[0]];

		if (type && parts.length === 2) {
			switch (method) {
				case 'GET':
					return this.getRecord(type, parts[1]);
				case 'PUT':
					return this.putRecord(type, parts[1], init);
				case 'DELETE':
					return this.deleteRecord(type, parts[1], init);
			}
		}

		if (type && parts.length === 3 && parts[2] === 'revs' && method === 'GET') {
			return this.getRevs(type, parts[1]);
		}

		throw new HttpError(404, 'not-found');
	}

	private blobsHas(init: FetchInit): FetchResponseLike {
		let hashes: unknown;

		try {
			hashes = JSON.parse(new TextDecoder().decode(toBytes(init.body))).hashes;
		} catch {
			throw badRequest('body must be {"hashes": [sha]}');
		}

		if (
			hashes !== undefined &&
			hashes !== null &&
			!(Array.isArray(hashes) && hashes.every(sha => typeof sha === 'string'))
		) {
			throw badRequest('body must be {"hashes": [sha]}');
		}

		const missing: string[] = [];

		for (const sha of (hashes as string[] | null) ?? []) {
			if (!missing.includes(sha) && !this.blobs.has(sha)) {
				missing.push(sha);
			}
		}

		return response(200, {missing});
	}

	private async putBlob(
		sha: string,
		init: FetchInit
	): Promise<FetchResponseLike> {
		if (!isSha(sha)) {
			throw badRequest('sha must be lowercase hex sha256');
		}

		const existing = this.blobs.get(sha);
		const bytes = toBytes(init.body);

		if (existing) {
			return response(
				200,
				{sha, bytes: existing.bytes.length, mime: existing.mime},
				{etag: `"${sha}"`}
			);
		}

		if (bytes.length > this.maxBlobBytes) {
			throw new HttpError(413, 'too-large');
		}

		const got = await sha256Hex(bytes);

		if (got !== sha) {
			throw new HttpError(422, 'hash-mismatch', {got});
		}

		const mime = headerOf(init.headers, 'Content-Type') || DEFAULT_MIME;

		this.blobs.set(sha, {bytes: new Uint8Array(bytes), mime});

		return response(200, {sha, bytes: bytes.length, mime}, {etag: `"${sha}"`});
	}

	private getBlob(sha: string, head: boolean): FetchResponseLike {
		const blob = this.blobs.get(sha);

		if (!blob) {
			throw new HttpError(404, 'not-found');
		}

		return response(
			200,
			head ? new Uint8Array(0) : new Uint8Array(blob.bytes),
			{
				'content-type': blob.mime,
				etag: `"${sha}"`,
				'cache-control': 'private, max-age=31536000, immutable'
			}
		);
	}

	private changes(query: URLSearchParams): FetchResponseLike {
		let since = 0;
		let limit = DEFAULT_LIMIT;
		const rawSince = query.get('since');
		const rawLimit = query.get('limit');

		if (rawSince) {
			since = Number(rawSince);

			if (!/^\d+$/.test(rawSince)) {
				throw badRequest('since must be a non-negative integer');
			}
		}

		if (rawLimit) {
			const n = Number(rawLimit);

			if (!/^\d+$/.test(rawLimit) || n < 1) {
				throw badRequest('limit must be a positive integer');
			}

			limit = Math.min(n, MAX_LIMIT);
		}

		const items: {seq: number; record: LibRecord}[] = [];
		let more = false;

		for (const entry of this.feed) {
			if (entry.seq <= since) {
				continue;
			}

			const key = recordKey(entry.type, entry.id);

			// One item per record, at its newest seq.
			if (this.latest.get(key) !== entry.seq) {
				continue;
			}

			if (items.length === limit) {
				more = true;
				break;
			}

			items.push({
				seq: entry.seq,
				record: JSON.parse(this.records.get(key)!.json)
			});
		}

		const seq = items.length ? items[items.length - 1].seq : this.seq;

		return response(200, {seq, items, more});
	}

	private getRecord(type: RecordType, id: string): FetchResponseLike {
		const entry = this.records.get(recordKey(type, id));

		if (!entry) {
			throw new HttpError(404, 'not-found');
		}

		return response(200, JSON.parse(entry.json), {etag: `"${entry.rev}"`});
	}

	private getRevs(type: RecordType, id: string): FetchResponseLike {
		const key = recordKey(type, id);

		if (!this.records.has(key)) {
			throw new HttpError(404, 'not-found');
		}

		const revs = (this.revs.get(key) ?? [])
			.map(json => JSON.parse(json) as LibRecord)
			.reverse()
			.slice(0, MAX_REVS)
			.map(record => ({rev: record.rev, by: record.by, at: record.at, record}));

		return response(200, {revs});
	}

	/** If-Match wins over If-None-Match; an unparseable If-Match is 400 bad-record. */
	private precondition(init: FetchInit): {rev?: number; create?: boolean} {
		const ifMatch = headerOf(init.headers, 'If-Match');

		if (ifMatch) {
			const raw = ifMatch
				.replace(/^W\//, '')
				.replace(/^"+|"+$/g, '')
				.trim();

			if (!/^-?\d+$/.test(raw)) {
				throw badRecord('If-Match must be a quoted rev, e.g. "7"');
			}

			return {rev: Number(raw)};
		}

		if (headerOf(init.headers, 'If-None-Match') === '*') {
			return {create: true};
		}

		return {};
	}

	private checkPre(
		entry: Entry | undefined,
		pre: {rev?: number; create?: boolean}
	) {
		if (pre.rev !== undefined) {
			if (!entry || entry.rev !== pre.rev) {
				throw this.stale(entry);
			}
		} else if (pre.create) {
			if (entry) {
				throw this.stale(entry);
			}
		} else {
			throw new HttpError(428, 'precondition-required');
		}
	}

	private stale(entry: Entry | undefined): HttpError {
		return new HttpError(412, 'stale', {
			current: entry ? JSON.parse(entry.json) : null
		});
	}

	private putRecord(
		type: RecordType,
		id: string,
		init: FetchInit
	): FetchResponseLike {
		const pre = this.precondition(init);
		const key = recordKey(type, id);
		const entry = this.records.get(key);

		this.checkPre(entry, pre);

		if (!validId(type, id)) {
			throw badRecord(`invalid id for ${type}`);
		}

		let record: Record<string, unknown>;

		try {
			record = JSON.parse(new TextDecoder().decode(toBytes(init.body)));
		} catch {
			throw badRecord('body must be a JSON object');
		}

		if (!record || typeof record !== 'object' || Array.isArray(record)) {
			throw badRecord('body must be a JSON object');
		}

		for (const [field, want] of [
			['id', id],
			['type', type]
		] as const) {
			if (
				record[field] !== undefined &&
				record[field] !== null &&
				record[field] !== want
			) {
				throw badRecord(`${field} does not match the path`);
			}
		}

		if (
			record.deleted !== undefined &&
			record.deleted !== null &&
			typeof record.deleted !== 'boolean'
		) {
			throw badRecord('deleted must be a boolean');
		}

		record.deleted = record.deleted === true;

		const info = parseInfo(type, record);

		if (info.bad) {
			throw badRecord(info.bad);
		}

		if (info.deleted) {
			this.checkDeletable(type, id);
		} else {
			this.checkLive(type, id, info);
		}

		return this.commit(type, id, entry, record, init);
	}

	private deleteRecord(
		type: RecordType,
		id: string,
		init: FetchInit
	): FetchResponseLike {
		const pre = this.precondition(init);
		const entry = this.records.get(recordKey(type, id));

		if (!entry) {
			throw new HttpError(404, 'not-found');
		}

		if (pre.rev === undefined) {
			throw new HttpError(428, 'precondition-required');
		}

		this.checkPre(entry, pre);
		this.checkDeletable(type, id);

		const record = JSON.parse(entry.json);

		record.deleted = true;

		return this.commit(type, id, entry, record, init);
	}

	private checkLive(type: RecordType, id: string, info: Info) {
		if (type === 'collection') {
			for (const [key, other] of this.records) {
				if (
					key.startsWith('collection/') &&
					key !== recordKey(type, id) &&
					!other.info.deleted &&
					other.info.name === info.name
				) {
					throw new HttpError(409, 'collection-name-taken', {
						holder: holderOf(key)
					});
				}
			}

			return;
		}

		this.checkCollection(info.collection);

		if (type === 'binding') {
			return;
		}

		for (const [key, other] of this.records) {
			if (
				key === recordKey(type, id) ||
				other.info.deleted ||
				!(key.startsWith('asset/') || key.startsWith('character/'))
			) {
				continue;
			}

			if (
				other.info.collection === info.collection &&
				other.info.name === info.name
			) {
				throw new HttpError(409, 'name-taken', {holder: holderOf(key)});
			}
		}

		const missing = Array.from(new Set(info.blobs))
			.filter(sha => !this.blobs.has(sha))
			.sort();

		if (missing.length) {
			throw new HttpError(409, 'blob-missing', {missing});
		}
	}

	private checkCollection(id: string) {
		const collection = this.records.get(recordKey('collection', id));

		if (!collection || collection.info.deleted) {
			throw new HttpError(409, 'collection-missing');
		}
	}

	private checkDeletable(type: RecordType, id: string) {
		if (type !== 'collection') {
			return;
		}

		let count = 0;

		for (const [key, other] of this.records) {
			if (other.info.deleted) {
				continue;
			}

			if (key.startsWith('asset/') || key.startsWith('character/')) {
				if (other.info.collection === id) {
					count++;
				}
			} else if (key.startsWith('binding/') && other.info.bound.includes(id)) {
				count++;
			}
		}

		if (count > 0) {
			throw new HttpError(409, 'collection-not-empty', {count});
		}
	}

	private commit(
		type: RecordType,
		id: string,
		entry: Entry | undefined,
		record: Record<string, unknown>,
		init: FetchInit
	): FetchResponseLike {
		const key = recordKey(type, id);
		const rev = entry ? entry.rev + 1 : 1;
		const by = headerOf(init.headers, 'X-Client-Name') || 'unknown';
		const at = new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
		const stored = {...record, id, type, rev, by, at};
		const json = JSON.stringify(stored);

		this.records.set(key, {json, rev, info: parseInfo(type, stored)});
		this.revs.set(key, [...(this.revs.get(key) ?? []), json]);
		this.seq++;
		this.feed.push({seq: this.seq, type, id, rev});
		this.latest.set(key, this.seq);

		const message: LibSocketMessage = {
			t: 'lib',
			seq: this.seq,
			type,
			id,
			rev,
			by
		};
		const writer = headerOf(init.headers, 'X-Client-Id');

		for (const socket of this.sockets) {
			if (!writer || socket.clientId !== writer) {
				socket.send({...message});
			}
		}

		return response(
			200,
			{record: JSON.parse(json), seq: this.seq},
			{etag: `"${rev}"`}
		);
	}
}

function holderOf(key: string): {type: RecordType; id: string} {
	const slash = key.indexOf('/');

	return {type: key.slice(0, slash) as RecordType, id: key.slice(slash + 1)};
}
