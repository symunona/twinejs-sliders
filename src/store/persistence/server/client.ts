/**
 * Typed fetch wrapper for the story backup server (spec 11).
 *
 * Everything that knows about HTTP lives here. Callers branch on `ServerError.conflict`,
 * `.gone` and `.retryable` rather than on status numbers, so the day the server starts
 * answering 428 instead of 412 is a one-line change in one file.
 */

import type {Story} from '../../stories';
import type {
	AssetDiffResponse,
	AssetManifest,
	HealthResponse,
	PingResponse,
	PutStoryResponse,
	RestoreResponse,
	RevisionsResponse,
	ServerErrorBody,
	ServerErrorCode,
	StoryIndexEntry,
	StoryIndexResponse
} from './server.types';

/** What `PUT /stories/{id}/assets` takes. The server owns `rev` and `missing`. */
export type AssetManifestBody = Pick<
	AssetManifest,
	'version' | 'assets' | 'characters'
>;

export interface PutManifestResponse {
	rev: number;
}

/** A story fetched from the server, with the rev its ETag carried. */
export interface FetchedStory {
	story: Story;
	rev: number;
}

export const NOT_MODIFIED = 'not-modified';

export interface ServerClientOptions {
	url: string;
	token: string;
	clientId: string;
	clientName: string;
	/** Goes in `PutStoryRequest.client`, e.g. `twine-sliders 2.10.0-sliders`. */
	appVersion?: string;
	/** Injected in tests. */
	fetch?: typeof fetch;
}

/**
 * Every failure the client can produce, HTTP or otherwise.
 *
 * A fetch that never reached the server is `status: 0`, `network: true` — the queue has to
 * tell "your wifi died" (retry) apart from "the server said no" (do not).
 */
export class ServerError extends Error {
	readonly status: number;
	readonly code: ServerErrorCode;
	readonly network: boolean;
	/** Server's current rev. Set on 412, which is the whole point of that response. */
	readonly rev?: number;
	readonly updatedAt?: string;
	readonly lastClient?: string;

	constructor(
		message: string,
		options: {
			status: number;
			code: ServerErrorCode;
			network?: boolean;
			rev?: number;
			updatedAt?: string;
			lastClient?: string;
		}
	) {
		super(message);
		this.name = 'ServerError';
		this.status = options.status;
		this.code = options.code;
		this.network = options.network ?? false;
		this.rev = options.rev;
		this.updatedAt = options.updatedAt;
		this.lastClient = options.lastClient;

		// ts-jest targets ES5 helpers in some configs; without this `instanceof` breaks.
		Object.setPrototypeOf(this, ServerError.prototype);
	}

	/** Someone else wrote first. `rev` and `lastClient` say who and what. */
	get conflict(): boolean {
		return this.status === 412 || this.code === 'conflict';
	}

	/** The story is a tombstone, or was never there. Both mean `gone` locally. */
	get gone(): boolean {
		return this.status === 404 || this.code === 'deleted';
	}

	get unauthorized(): boolean {
		return this.status === 401 || this.code === 'unauthorized';
	}

	/** Worth trying again later. A 4xx is the client being wrong; retrying repeats it. */
	get retryable(): boolean {
		return this.network || this.status === 0 || this.status >= 500;
	}
}

export function isServerError(value: unknown): value is ServerError {
	return value instanceof ServerError;
}

const API_PATH = '/api/v1';

/** `https://host/` and `https://host/api/v1` both mean the same thing to a human. */
export function apiBase(url: string): string {
	const trimmed = url.trim().replace(/\/+$/, '');

	return trimmed.endsWith(API_PATH) ? trimmed : `${trimmed}${API_PATH}`;
}

/** Local-only props. Whether a story syncs is each editor's own business (spec 11). */
export function outgoingStory(story: Story): Story {
	const rest: Partial<Story> = {...story};

	delete rest.selected;
	delete rest.sync;

	return rest as Story;
}

/** `lastUpdate` travels as an ISO string; everything else is verbatim. */
export function incomingStory(raw: unknown): Story {
	const story = raw as Story;

	return {
		...story,
		lastUpdate: new Date(story.lastUpdate as unknown as string)
	};
}

function revFromEtag(etag: string | null): number {
	if (!etag) {
		return 0;
	}

	const parsed = Number.parseInt(
		etag.replace(/^W\//, '').replace(/"/g, ''),
		10
	);

	return Number.isFinite(parsed) ? parsed : 0;
}

function quoted(rev: number | string): string {
	return `"${rev}"`;
}

export interface ServerClient {
	readonly clientId: string;
	readonly clientName: string;
	readonly url: string;
	health(): Promise<HealthResponse>;
	ping(): Promise<PingResponse>;
	listStories(): Promise<StoryIndexEntry[]>;
	getStory(
		id: string,
		ifNoneMatch?: number
	): Promise<FetchedStory | typeof NOT_MODIFIED>;
	putStory(
		story: Story,
		ifMatch?: number,
		options?: {revive?: boolean; keepalive?: boolean}
	): Promise<PutStoryResponse>;
	deleteStory(id: string, purge?: boolean): Promise<void>;
	reviveStory(story: Story): Promise<PutStoryResponse>;
	getManifest(id: string): Promise<AssetManifest>;
	putManifest(
		id: string,
		manifest: AssetManifestBody,
		ifMatch?: number
	): Promise<PutManifestResponse>;
	diffAssets(
		id: string,
		assets: {id: string; hash: string; bytes: number}[]
	): Promise<AssetDiffResponse>;
	headAsset(
		id: string,
		assetId: string
	): Promise<{bytes: number; hash: string} | undefined>;
	getAssetBlob(id: string, assetId: string): Promise<Blob>;
	putAssetBlob(
		id: string,
		assetId: string,
		blob: Blob,
		hash: string,
		mime: string
	): Promise<void>;
	listRevisions(id: string): Promise<RevisionsResponse>;
	getRevision(id: string, rev: number): Promise<Story>;
	restoreRevision(id: string, rev: number): Promise<RestoreResponse>;
}

class FetchServerClient implements ServerClient {
	private readonly base: string;
	private readonly options: ServerClientOptions;

	constructor(options: ServerClientOptions) {
		this.options = options;
		this.base = apiBase(options.url);
	}

	get clientId(): string {
		return this.options.clientId;
	}

	get clientName(): string {
		return this.options.clientName;
	}

	get url(): string {
		return this.base;
	}

	private headers(extra?: Record<string, string>): Record<string, string> {
		return {
			Authorization: `Bearer ${this.options.token}`,
			'X-Client-Id': this.options.clientId,
			'X-Client-Name': this.options.clientName,
			...extra
		};
	}

	/**
	 * The one place a `Response` is turned into either a value or a `ServerError`.
	 *
	 * `allow` lists statuses the caller handles itself — 304 and 404 mostly — so they come
	 * back as responses instead of throwing.
	 */
	private async send(
		path: string,
		init: RequestInit & {headers?: Record<string, string>},
		allow: number[] = []
	): Promise<Response> {
		const doFetch = this.options.fetch ?? globalThis.fetch;
		let response: Response;

		try {
			response = await doFetch(`${this.base}${path}`, {
				...init,
				headers: this.headers(init.headers)
			});
		} catch (error) {
			throw new ServerError(
				error instanceof Error ? error.message : 'Network request failed',
				{code: 'internal', network: true, status: 0}
			);
		}

		if (response.ok || allow.includes(response.status)) {
			return response;
		}

		throw await errorFor(response);
	}

	private async json<T>(
		path: string,
		init: RequestInit & {headers?: Record<string, string>} = {}
	): Promise<T> {
		const response = await this.send(path, init);

		return (await response.json()) as T;
	}

	async health(): Promise<HealthResponse> {
		return this.json<HealthResponse>('/health');
	}

	async ping(): Promise<PingResponse> {
		return this.json<PingResponse>('/ping');
	}

	async listStories(): Promise<StoryIndexEntry[]> {
		const body = await this.json<StoryIndexResponse>('/stories');

		return body.stories ?? [];
	}

	async getStory(
		id: string,
		ifNoneMatch?: number
	): Promise<FetchedStory | typeof NOT_MODIFIED> {
		const headers: Record<string, string> = {};

		if (ifNoneMatch) {
			headers['If-None-Match'] = quoted(ifNoneMatch);
		}

		const response = await this.send(
			`/stories/${encodeURIComponent(id)}`,
			{headers},
			[304]
		);

		if (response.status === 304) {
			return NOT_MODIFIED;
		}

		const raw = (await response.json()) as
			{story?: Story; rev?: number} | Story;
		// The server may answer with the bare story or wrap it. Accept both rather than
		// making a pull fail on a shape difference no one would guess at from a stack.
		const wrapped = raw as {story?: Story; rev?: number};
		const body = wrapped.story ?? (raw as Story);
		const rev = wrapped.rev ?? revFromEtag(response.headers.get('ETag'));

		return {rev, story: incomingStory(body)};
	}

	async putStory(
		story: Story,
		ifMatch?: number,
		options: {revive?: boolean; keepalive?: boolean} = {}
	): Promise<PutStoryResponse> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};

		if (ifMatch) {
			headers['If-Match'] = quoted(ifMatch);
		}

		const query = options.revive ? '?revive=1' : '';
		const response = await this.send(
			`/stories/${encodeURIComponent(story.id)}${query}`,
			{
				body: JSON.stringify({
					client: this.options.appVersion ?? 'twine-sliders',
					story: outgoingStory(story)
				}),
				headers,
				keepalive: options.keepalive,
				method: 'PUT'
			}
		);

		return (await response.json()) as PutStoryResponse;
	}

	async deleteStory(id: string, purge = false): Promise<void> {
		await this.send(
			`/stories/${encodeURIComponent(id)}${purge ? '?purge=1' : ''}`,
			{method: 'DELETE'}
		);
	}

	async reviveStory(story: Story): Promise<PutStoryResponse> {
		return this.putStory(story, undefined, {revive: true});
	}

	async getManifest(id: string): Promise<AssetManifest> {
		return this.json<AssetManifest>(
			`/stories/${encodeURIComponent(id)}/assets`
		);
	}

	async putManifest(
		id: string,
		manifest: AssetManifestBody,
		ifMatch?: number
	): Promise<PutManifestResponse> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};

		if (ifMatch) {
			headers['If-Match'] = quoted(ifMatch);
		}

		const response = await this.send(
			`/stories/${encodeURIComponent(id)}/assets`,
			{body: JSON.stringify(manifest), headers, method: 'PUT'}
		);

		return (await response.json()) as PutManifestResponse;
	}

	async diffAssets(
		id: string,
		assets: {id: string; hash: string; bytes: number}[]
	): Promise<AssetDiffResponse> {
		const response = await this.send(
			`/stories/${encodeURIComponent(id)}/assets/diff`,
			{
				body: JSON.stringify({assets}),
				headers: {'Content-Type': 'application/json'},
				method: 'POST'
			}
		);
		const body = (await response.json()) as Partial<AssetDiffResponse>;

		return {
			missing: body.missing ?? [],
			present: body.present ?? [],
			stale: body.stale ?? []
		};
	}

	async headAsset(
		id: string,
		assetId: string
	): Promise<{bytes: number; hash: string} | undefined> {
		const response = await this.send(
			`/stories/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`,
			{method: 'HEAD'},
			[404]
		);

		if (response.status === 404) {
			return undefined;
		}

		return {
			bytes: Number.parseInt(response.headers.get('Content-Length') ?? '0', 10),
			hash: (response.headers.get('ETag') ?? '').replace(/"/g, '')
		};
	}

	async getAssetBlob(id: string, assetId: string): Promise<Blob> {
		const response = await this.send(
			`/stories/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`,
			{}
		);

		return response.blob();
	}

	async putAssetBlob(
		id: string,
		assetId: string,
		blob: Blob,
		hash: string,
		mime: string
	): Promise<void> {
		await this.send(
			`/stories/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`,
			{
				body: blob,
				headers: {
					'Content-Type': mime || 'application/octet-stream',
					'X-Asset-Hash': hash
				},
				method: 'PUT'
			}
		);
	}

	async listRevisions(id: string): Promise<RevisionsResponse> {
		return this.json<RevisionsResponse>(
			`/stories/${encodeURIComponent(id)}/revisions`
		);
	}

	async getRevision(id: string, rev: number): Promise<Story> {
		const raw = await this.json<unknown>(
			`/stories/${encodeURIComponent(id)}/revisions/${rev}`
		);
		const wrapped = raw as {story?: Story};

		return incomingStory(wrapped.story ?? raw);
	}

	async restoreRevision(id: string, rev: number): Promise<RestoreResponse> {
		const response = await this.send(
			`/stories/${encodeURIComponent(id)}/restore`,
			{
				body: JSON.stringify({rev}),
				headers: {'Content-Type': 'application/json'},
				method: 'POST'
			}
		);

		return (await response.json()) as RestoreResponse;
	}
}

/**
 * Reads whatever the server managed to say about a failure. A proxy in the way answers
 * HTML, so a parse failure must not replace the status with a JSON syntax error.
 */
async function errorFor(response: Response): Promise<ServerError> {
	let body: Partial<ServerErrorBody> = {};

	try {
		body = (await response.json()) as ServerErrorBody;
	} catch {
		// Left empty on purpose — the status is the information we have.
	}

	const code: ServerErrorCode =
		body.error?.code ?? defaultCodeFor(response.status);

	return new ServerError(
		body.error?.message ?? `${response.status} ${response.statusText}`.trim(),
		{
			code,
			lastClient: body.lastClient,
			rev: body.rev,
			status: response.status,
			updatedAt: body.updatedAt
		}
	);
}

function defaultCodeFor(status: number): ServerErrorCode {
	switch (status) {
		case 401:
		case 403:
			return 'unauthorized';
		case 404:
			return 'not_found';
		case 409:
			return 'conflict';
		case 412:
			return 'conflict';
		case 413:
			return 'too_large';
		case 422:
			return 'hash_mismatch';
		default:
			return status >= 500 ? 'internal' : 'bad_request';
	}
}

export function createServerClient(options: ServerClientOptions): ServerClient {
	return new FetchServerClient(options);
}
