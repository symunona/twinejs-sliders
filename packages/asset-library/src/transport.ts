import {
	BlobInfo,
	ChangesPage,
	LibRecord,
	RecordType,
	RevEntry,
	TYPE_PATHS,
	WriteResult
} from './types';

/**
 * The library's wire contract as a TypeScript interface, one method per endpoint
 * (asset-library-contract.md). Errors are typed so the engine can branch on them without
 * reading status codes.
 */

export type Precondition = {create: true} | {rev: number};

export interface LibTransport {
	/** POST /blobs/has → the shas the server lacks. */
	hasBlobs(hashes: string[]): Promise<string[]>;
	putBlob(sha: string, bytes: Uint8Array, mime: string): Promise<BlobInfo>;
	getBlob(sha: string): Promise<{bytes: Uint8Array; mime: string}>;
	headBlob(sha: string): Promise<boolean>;
	changes(since: number, limit?: number): Promise<ChangesPage>;
	getRecord(type: RecordType, id: string): Promise<LibRecord>;
	putRecord(
		record: LibRecord,
		precondition: Precondition
	): Promise<WriteResult>;
	deleteRecord(type: RecordType, id: string, rev: number): Promise<WriteResult>;
	revs(type: RecordType, id: string): Promise<RevEntry[]>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LibError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string,
		readonly body?: Record<string, unknown>
	) {
		super(message);
		this.name = new.target.name;
		// ts-jest targets below ES2015 classes in some configs; keep instanceof honest.
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/** The request never got an answer: offline, DNS, reset. Retry later. */
export class NetworkError extends LibError {
	constructor(message = 'Network unavailable', readonly cause?: unknown) {
		super(message, 0, 'network');
	}
}

/** 5xx. Transient like a network error, but the server did answer. */
export class ServerError extends LibError {
	constructor(status: number, body?: Record<string, unknown>) {
		super(
			`Server error ${status}`,
			status,
			String(body?.error ?? 'server'),
			body
		);
	}
}

/** 412: the If-Match rev is not current, or a create hit an existing id. */
export class StaleError extends LibError {
	constructor(readonly current: LibRecord | null) {
		super('Record changed on the server', 412, 'stale', {current});
	}
}

export interface Holder {
	type: RecordType;
	id: string;
}

export class NameTakenError extends LibError {
	constructor(readonly holder: Holder | undefined, message = 'Name taken') {
		super(message, 409, 'name-taken', {holder});
	}
}

export class CollectionNameTakenError extends LibError {
	constructor(readonly holder: Holder | undefined) {
		super('Collection name taken', 409, 'collection-name-taken', {holder});
	}
}

export class BlobMissingError extends LibError {
	constructor(readonly missing: string[]) {
		super(
			`Blobs missing on server: ${missing.join(', ')}`,
			409,
			'blob-missing',
			{
				missing
			}
		);
	}
}

export class CollectionMissingError extends LibError {
	constructor() {
		super('Collection missing or deleted', 409, 'collection-missing');
	}
}

export class CollectionNotEmptyError extends LibError {
	constructor(readonly count: number) {
		super(`Collection not empty (${count})`, 409, 'collection-not-empty', {
			count
		});
	}
}

export class BadRecordError extends LibError {
	constructor(readonly detail: string) {
		super(`Bad record: ${detail}`, 400, 'bad-record', {detail});
	}
}

/** 400 on non-record input: bad sha, bad `since`/`limit`, bad `/blobs/has` body. */
export class BadRequestError extends LibError {
	constructor(readonly detail: string) {
		super(`Bad request: ${detail}`, 400, 'bad-request', {detail});
	}
}

export class PreconditionRequiredError extends LibError {
	constructor() {
		super('If-Match or If-None-Match required', 428, 'precondition-required');
	}
}

export class NotFoundError extends LibError {
	constructor(what = 'Not found') {
		super(what, 404, 'not-found');
	}
}

export class HashMismatchError extends LibError {
	constructor(body?: Record<string, unknown>) {
		super(
			'Blob bytes do not hash to the given sha',
			422,
			'hash-mismatch',
			body
		);
	}
}

export class TooLargeError extends LibError {
	constructor(body?: Record<string, unknown>) {
		super('Blob too large', 413, 'too-large', body);
	}
}

export class AuthError extends LibError {
	constructor(status: number) {
		super('Not authorised', status, 'unauthorized');
	}
}

/** Transient: worth retrying later without changing anything. */
export function isTransient(error: unknown): boolean {
	return error instanceof NetworkError || error instanceof ServerError;
}

/** Turns a non-2xx status and its JSON body into the matching typed error. */
export function errorFromResponse(
	status: number,
	body: Record<string, unknown> | undefined
): LibError {
	const code = String(body?.error ?? '');

	switch (status) {
		case 400:
			return code === 'bad-request'
				? new BadRequestError(String(body?.detail ?? code))
				: new BadRecordError(String(body?.detail ?? code));
		case 401:
		case 403:
			return new AuthError(status);
		case 404:
			return new NotFoundError();
		case 409:
			switch (code) {
				case 'name-taken':
					return new NameTakenError(body?.holder as Holder | undefined);
				case 'collection-name-taken':
					return new CollectionNameTakenError(
						body?.holder as Holder | undefined
					);
				case 'blob-missing':
					return new BlobMissingError((body?.missing as string[]) ?? []);
				case 'collection-missing':
					return new CollectionMissingError();
				case 'collection-not-empty':
					return new CollectionNotEmptyError(Number(body?.count ?? 0));
			}
			break;
		case 412:
			return new StaleError((body?.current as LibRecord | null) ?? null);
		case 413:
			return new TooLargeError(body);
		case 422:
			return new HashMismatchError(body);
		case 428:
			return new PreconditionRequiredError();
	}

	if (status >= 500) {
		return new ServerError(status, body);
	}

	return new LibError(`HTTP ${status} ${code}`, status, code || 'http', body);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface FetchInit {
	method: string;
	headers: Record<string, string>;
	body?: string | Uint8Array;
}

/** The part of a fetch Response this transport reads. Real `fetch` satisfies it. */
export interface FetchResponseLike {
	status: number;
	headers: {get(name: string): string | null};
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
}

export type FetchLike = (
	url: string,
	init: FetchInit
) => Promise<FetchResponseLike>;

export const LIB_BASE_PATH = '/api/v1/lib';

async function readJson(
	response: FetchResponseLike
): Promise<Record<string, unknown> | undefined> {
	const text = await response.text();

	if (!text) {
		return undefined;
	}

	try {
		return JSON.parse(text);
	} catch {
		return {error: 'unparseable', detail: text.slice(0, 200)};
	}
}

/**
 * The contract over HTTP. `baseUrl` is the server origin (`http://127.0.0.1:27101`); the
 * `/api/v1/lib` prefix is added here. `clientId` is the tab's socket identity, so the
 * server can leave the writing connection out of its broadcast.
 */
export class HttpTransport implements LibTransport {
	private readonly root: string;

	constructor(
		baseUrl: string,
		private token: string,
		private clientName: string,
		private fetcher: FetchLike = (url, init) =>
			fetch(url, init as RequestInit) as Promise<FetchResponseLike>,
		private clientId?: string
	) {
		this.root = baseUrl.replace(/\/+$/, '') + LIB_BASE_PATH;
	}

	private headers(extra: Record<string, string> = {}): Record<string, string> {
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.token}`,
			'X-Client-Name': this.clientName,
			...extra
		};

		if (this.clientId) {
			headers['X-Client-Id'] = this.clientId;
		}

		return headers;
	}

	private async request(
		method: string,
		path: string,
		init: {headers?: Record<string, string>; body?: string | Uint8Array} = {}
	): Promise<FetchResponseLike> {
		let response: FetchResponseLike;

		try {
			response = await this.fetcher(this.root + path, {
				method,
				headers: this.headers(init.headers),
				body: init.body
			});
		} catch (error) {
			throw new NetworkError(
				error instanceof Error ? error.message : 'Network unavailable',
				error
			);
		}

		if (response.status < 200 || response.status >= 300) {
			throw errorFromResponse(response.status, await readJson(response));
		}

		return response;
	}

	private async json<T>(
		method: string,
		path: string,
		body?: unknown,
		headers: Record<string, string> = {}
	): Promise<T> {
		const response = await this.request(method, path, {
			headers:
				body === undefined
					? headers
					: {'Content-Type': 'application/json', ...headers},
			body: body === undefined ? undefined : JSON.stringify(body)
		});

		return (await readJson(response)) as T;
	}

	async hasBlobs(hashes: string[]): Promise<string[]> {
		const result = await this.json<{missing?: string[]}>('POST', '/blobs/has', {
			hashes
		});

		return result?.missing ?? [];
	}

	async putBlob(
		sha: string,
		bytes: Uint8Array,
		mime: string
	): Promise<BlobInfo> {
		const response = await this.request('PUT', `/blobs/${sha}`, {
			headers: {'Content-Type': mime || 'application/octet-stream'},
			body: bytes
		});

		return (await readJson(response)) as unknown as BlobInfo;
	}

	async getBlob(sha: string): Promise<{bytes: Uint8Array; mime: string}> {
		const response = await this.request('GET', `/blobs/${sha}`);

		return {
			bytes: new Uint8Array(await response.arrayBuffer()),
			mime: response.headers.get('Content-Type') ?? 'application/octet-stream'
		};
	}

	async headBlob(sha: string): Promise<boolean> {
		try {
			await this.request('HEAD', `/blobs/${sha}`);
			return true;
		} catch (error) {
			if (error instanceof NotFoundError) {
				return false;
			}

			throw error;
		}
	}

	changes(since: number, limit?: number): Promise<ChangesPage> {
		const query = `since=${since}` + (limit ? `&limit=${limit}` : '');

		return this.json<ChangesPage>('GET', `/changes?${query}`);
	}

	getRecord(type: RecordType, id: string): Promise<LibRecord> {
		return this.json<LibRecord>(
			'GET',
			`/${TYPE_PATHS[type]}/${encodeURIComponent(id)}`
		);
	}

	putRecord(
		record: LibRecord,
		precondition: Precondition
	): Promise<WriteResult> {
		const headers: Record<string, string> =
			'create' in precondition
				? {'If-None-Match': '*'}
				: {'If-Match': `"${precondition.rev}"`};

		return this.json<WriteResult>(
			'PUT',
			`/${TYPE_PATHS[record.type]}/${encodeURIComponent(record.id)}`,
			record,
			headers
		);
	}

	deleteRecord(
		type: RecordType,
		id: string,
		rev: number
	): Promise<WriteResult> {
		return this.json<WriteResult>(
			'DELETE',
			`/${TYPE_PATHS[type]}/${encodeURIComponent(id)}`,
			undefined,
			{'If-Match': `"${rev}"`}
		);
	}

	async revs(type: RecordType, id: string): Promise<RevEntry[]> {
		const result = await this.json<{revs?: RevEntry[]}>(
			'GET',
			`/${TYPE_PATHS[type]}/${encodeURIComponent(id)}/revs`
		);

		return result?.revs ?? [];
	}
}
