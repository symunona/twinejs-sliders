/**
 * `Source` over the API — the same answers as `LocalSource`, for a store on another box.
 *
 * Nothing here caches. A remote read costs a request every time, which is honest: the moment
 * the CLI keeps a copy it has to decide when the copy is wrong, and that is the sync
 * subsystem spec 12 exists to avoid.
 */

import {CliError, EXIT} from '../types';
import type {Manifest, RevisionRow, Source, StoryBody, StoryMeta} from '../types';

/** `https://host/` and `https://host/api/v1` mean the same thing to a human. */
export function apiBase(url: string): string {
	const trimmed = url.trim().replace(/\/+$/, '');

	return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

export interface HttpOptions {
	server: string;
	token: string;
	clientId: string;
	clientName: string;
	/** Injected in tests. */
	fetch?: typeof fetch;
}

interface ServerErrorBody {
	error?: {code?: string; message?: string};
	rev?: number;
	updatedAt?: string;
	lastClient?: string;
}

/**
 * A failed request, already carrying the exit code the CLI will die with, plus the three
 * fields a 412 answers with so a conflict report does not need a second round trip.
 */
export class HttpError extends CliError {
	constructor(
		message: string,
		code: number,
		readonly status: number,
		readonly rev?: number,
		readonly updatedAt?: string,
		readonly lastClient?: string
	) {
		super(message, code);
		this.name = 'HttpError';
		Object.setPrototypeOf(this, HttpError.prototype);
	}
}

/**
 * Status to exit code (spec 12 §7). One mapping, used by reads and writes alike, because
 * "the token was rejected" has to mean 4 whichever verb hit it.
 */
export function exitForStatus(status: number): number {
	switch (status) {
		case 404:
		case 410:
			return EXIT.notFound;
		case 409:
		case 412:
			return EXIT.conflict;
		case 400:
		case 422:
			return EXIT.usage;
		default:
			return EXIT.server;
	}
}

export async function errorFor(response: Response, what: string): Promise<HttpError> {
	let body: ServerErrorBody = {};

	try {
		body = (await response.json()) as ServerErrorBody;
	} catch {
		// A proxy in front of the store answers HTML. The status is still the truth.
	}

	const message = body.error?.message ?? response.statusText ?? 'request failed';

	return new HttpError(
		`${what}: ${response.status} ${message}`,
		exitForStatus(response.status),
		response.status,
		body.rev,
		body.updatedAt,
		body.lastClient
	);
}

/** Shared by `HttpSource` and `HttpWriteClient`: headers, identity, error mapping. */
export class Http {
	readonly base: string;

	constructor(readonly options: HttpOptions) {
		this.base = apiBase(options.server);
	}

	headers(extra?: Record<string, string>): Record<string, string> {
		return {
			Authorization: `Bearer ${this.options.token}`,
			// Identity rides every request: the change bus uses the id to skip this client's
			// own writes, and history shows the name (spec 12 §7).
			'X-Client-Id': this.options.clientId,
			'X-Client-Name': this.options.clientName,
			...extra
		};
	}

	async send(
		path: string,
		init: RequestInit & {headers?: Record<string, string>} = {},
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
			// Never reached the server. That is exit 4 whatever the caller was doing.
			throw new HttpError(
				`${this.options.server} is unreachable: ${(error as Error).message}`,
				EXIT.server,
				0
			);
		}

		if (response.ok || allow.includes(response.status)) {
			return response;
		}

		throw await errorFor(response, `${init.method ?? 'GET'} ${path}`);
	}

	async json<T>(path: string, init: RequestInit & {headers?: Record<string, string>} = {}): Promise<T> {
		return (await this.send(path, init)).json() as Promise<T>;
	}
}

const enc = encodeURIComponent;

export class HttpSource implements Source {
	readonly mode = 'remote' as const;

	constructor(readonly http: Http) {}

	async list(includeDeleted = false): Promise<StoryMeta[]> {
		const body = await this.http.json<{stories?: StoryMeta[]}>('/stories');
		const stories = body.stories ?? [];

		return includeDeleted ? stories : stories.filter(story => !story.deleted);
	}

	/**
	 * There is no per-story meta route: the index row already carries every cached count, so
	 * a second endpoint would only be a second thing to keep in step.
	 */
	async meta(storyId: string): Promise<StoryMeta> {
		const found = (await this.list(true)).find(story => story.id === storyId);

		if (!found) {
			throw new CliError(`no story ${storyId} on ${this.http.options.server}`, EXIT.notFound);
		}

		return found;
	}

	async body(storyId: string, rev?: number): Promise<StoryBody> {
		const path =
			rev === undefined
				? `/stories/${enc(storyId)}`
				: `/stories/${enc(storyId)}/revisions/${rev}`;

		return this.http.json<StoryBody>(path);
	}

	async manifest(storyId: string): Promise<Manifest> {
		const raw = await this.http.json<Partial<Manifest>>(`/stories/${enc(storyId)}/assets`);

		return {
			assets: raw.assets ?? [],
			characters: raw.characters ?? [],
			missing: raw.missing ?? [],
			rev: raw.rev ?? 0,
			version: raw.version ?? 1
		};
	}

	/** Remote blobs are not files on this machine, and pretending otherwise helps nobody. */
	async assetPath(): Promise<string | undefined> {
		return undefined;
	}

	async assetBytes(storyId: string, assetId: string): Promise<Buffer> {
		const response = await this.http.send(`/stories/${enc(storyId)}/assets/${enc(assetId)}`);

		return Buffer.from(await response.arrayBuffer());
	}

	async revisions(storyId: string): Promise<RevisionRow[]> {
		const body = await this.http.json<{revisions?: RevisionRow[]}>(
			`/stories/${enc(storyId)}/revisions`
		);

		return body.revisions ?? [];
	}
}
