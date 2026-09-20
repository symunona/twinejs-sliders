/**
 * An in-memory stand-in for the Go story store, good enough to argue with.
 *
 * # Why this exists
 *
 * The sync modules each have unit tests, and the whole thing has Playwright specs against
 * a real server. Between those two sits the layer where every sync bug in `CLAUDE.md`
 * actually lived: rev advancing across a sequence of writes, `If-Match` being honoured,
 * two clients interleaving, a socket event racing a poll, a manifest moving. The only
 * harness that reached it was a `Record<url, cannedResponse>` map, which cannot express a
 * rev at all — it answers the same thing however many times you ask.
 *
 * So this is a STORE, not a mock: it keeps bodies, bumps revs, enforces preconditions and
 * refuses the things the real server refuses. A test drives it with the same
 * `ServerClient` interface the app uses, and `store.client()` twice gives two clients
 * sharing one server — which is the only way to write "A and B edit at once" without a
 * browser.
 *
 * # What it is faithful about
 *
 * The parts a bug hides in:
 *
 *   - `rev` bumps on every write, including one that changes nothing (`writeStoryLocked`
 *     in `server/store/story.go` is explicit that rev is a write counter, not a content
 *     version).
 *   - `If-Match` mismatch is a 412 carrying the server's current `rev` and `lastClient`,
 *     because that payload is what the conflict path reads.
 *   - `If-None-Match` on a current rev is a 304.
 *   - DELETE tombstones WITHOUT bumping the rev, so an old client can still republish —
 *     the one rule most likely to be "simplified" away by a mock.
 *   - The asset manifest has its own rev, independent of the story's.
 *   - Writes are announced to a notifier the way the HTTP handlers call `api.Notifier`,
 *     with the writer's own id, so a test can reproduce echo suppression.
 *
 * # What it is NOT
 *
 * No auth, no revision history bodies, no size limits, no gzip, no disk. Add those here
 * when a test needs them rather than reaching for the real server — a test that needs the
 * real server should be an e2e spec.
 */

import {ServerError, NOT_MODIFIED, type ServerClient} from './client';
import type {AssetManifestBody, FetchedStory} from './client';
import type {Story} from '../../stories';
import type {
	AssetDiffResponse,
	AssetManifest,
	HealthResponse,
	PingResponse,
	PutStoryResponse,
	RestoreResponse,
	RevisionsResponse,
	ServerMessage,
	StoryIndexEntry
} from './server.types';

/** Who made a write. `api.Origin` in Go. */
export interface FakeOrigin {
	id: string;
	name: string;
}

interface StoredStory {
	body: Story;
	rev: number;
	deleted: boolean;
	updatedAt: string;
	lastClient: string;
	/** The manifest's own rev. Separate from the story's, as on the real server. */
	assetRev: number;
	assets: AssetManifestBody;
	blobs: Map<string, {bytes: number; hash: string; blob: Blob}>;
}

export interface FakeServerOptions {
	/**
	 * Called after every write that lands, exactly where the Go handlers call
	 * `api.Notifier`. A test wires this to whatever stands in for the websocket.
	 *
	 * `by` is the writer. Echo suppression is the CALLER's job here, as it is in the hub
	 * (`broadcast(msg, exceptID)`), so a test can deliberately get it wrong and see what
	 * breaks.
	 */
	notify?: (message: ServerMessage, by: FakeOrigin) => void;
	/** Frozen clock, so `updatedAt` is assertable. Defaults to a fixed instant. */
	now?: () => string;
}

const DEFAULT_NOW = '2026-01-01T00:00:00.000Z';

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * `lastUpdate` is a `Date` on the way in and an ISO string on the wire, and
 * `incomingStory` turns it back. Round-tripping through JSON here keeps a fake response
 * shaped like a real one, which is what stops a test passing on a `Date` the app would
 * never receive.
 */
function onTheWire(story: Story): Story {
	return clone(story);
}

export interface FakeServer {
	/** A `ServerClient` bound to this store. Call twice for two clients. */
	client(options?: {id?: string; name?: string}): ServerClient;
	/** Put a story in without going through a client. For arranging a test. */
	seed(story: Story, options?: {rev?: number; lastClient?: string}): void;
	/** The story as the server holds it, or undefined. */
	stored(id: string): Story | undefined;
	revOf(id: string): number;
	assetRevOf(id: string): number;
	deleted(id: string): boolean;
	/** Every request any client has made, in order. For asserting what was NOT sent. */
	readonly calls: {method: string; id?: string; by: string}[];
	/** Make the next `count` requests fail as a network error. */
	failNext(count: number, error?: ServerError): void;
	/** Drop everything. */
	reset(): void;
}

export function fakeServer(options: FakeServerOptions = {}): FakeServer {
	const now = options.now ?? (() => DEFAULT_NOW);
	let stories = new Map<string, StoredStory>();
	const calls: {method: string; id?: string; by: string}[] = [];
	let failures = 0;
	let failureError: ServerError | undefined;

	const notify = (message: ServerMessage, by: FakeOrigin) =>
		options.notify?.(message, by);

	function maybeFail(): void {
		if (failures > 0) {
			failures--;
			throw (
				failureError ??
				new ServerError('network', {code: 'internal', network: true, status: 0})
			);
		}
	}

	function require(id: string): StoredStory {
		const entry = stories.get(id);

		if (!entry || entry.deleted) {
			throw new ServerError(`no story ${id}`, {
				code: entry?.deleted ? 'deleted' : 'not_found',
				status: 404
			});
		}

		return entry;
	}

	function indexEntry(entry: StoredStory): StoryIndexEntry {
		const assets = entry.assets.assets ?? [];

		return {
			assetBytes: assets.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0),
			assetCount: assets.length,
			bytes: JSON.stringify(entry.body).length,
			deleted: entry.deleted,
			id: entry.body.id,
			ifid: entry.body.ifid,
			lastClient: entry.lastClient,
			name: entry.body.name,
			passageCount: entry.body.passages.length,
			rev: entry.rev,
			updatedAt: entry.updatedAt
		};
	}

	function blank(story: Story): StoredStory {
		return {
			assetRev: 0,
			assets: {assets: [], characters: [], version: 1},
			blobs: new Map(),
			body: onTheWire(story),
			deleted: false,
			lastClient: '',
			rev: 0,
			updatedAt: now()
		};
	}

	function write(
		story: Story,
		ifMatch: number | undefined,
		by: FakeOrigin,
		revive: boolean
	): PutStoryResponse {
		const existing = stories.get(story.id);

		if (existing && existing.deleted && !revive) {
			throw new ServerError('story is deleted', {
				code: 'deleted',
				status: 404
			});
		}

		// A first write may state no precondition. Anything else must match, and the
		// refusal carries the current rev — the conflict path has nothing else to go on.
		if (existing && ifMatch !== undefined && ifMatch !== existing.rev) {
			throw new ServerError('rev mismatch', {
				code: 'conflict',
				lastClient: existing.lastClient,
				rev: existing.rev,
				status: 412,
				updatedAt: existing.updatedAt
			});
		}

		const entry = existing ?? blank(story);

		entry.body = onTheWire(story);
		// Always. Rev is the write counter, not a content version: an autosave that
		// changed nothing still moves it, and a fake that skipped the bump would hide
		// every off-by-one this harness exists to catch.
		entry.rev += 1;
		entry.deleted = false;
		entry.updatedAt = now();
		entry.lastClient = by.name;
		stories.set(story.id, entry);

		notify(
			{
				by: by.name,
				id: story.id,
				rev: entry.rev,
				t: revive ? 'revived' : 'story'
			},
			by
		);

		return {
			bytes: JSON.stringify(entry.body).length,
			id: story.id,
			rev: entry.rev,
			updatedAt: entry.updatedAt
		};
	}

	function makeClient(who: {id?: string; name?: string} = {}): ServerClient {
		const by: FakeOrigin = {
			id: who.id ?? 'client-1',
			name: who.name ?? who.id ?? 'client-1'
		};
		const record = (method: string, id?: string) =>
			calls.push({by: by.id, ...(id === undefined ? {} : {id}), method});

		return {
			clientId: by.id,
			clientName: by.name,
			url: 'https://fake.test',

			async health(): Promise<HealthResponse> {
				return {apiVersion: 1, ok: true, service: 'fake'};
			},

			async ping(): Promise<PingResponse> {
				return {
					apiVersion: 1,
					bytesUsed: 0,
					clients: [],
					events: true,
					keepRevisions: 20,
					maxAssetBytes: 0,
					maxStoryBytes: 0,
					ok: true,
					storyCount: stories.size,
					time: now(),
					version: 'fake',
					storyBytes: 0
				} as unknown as PingResponse;
			},

			async listStories(): Promise<StoryIndexEntry[]> {
				record('listStories');
				maybeFail();

				return [...stories.values()].map(indexEntry);
			},

			async getStory(
				id: string,
				ifNoneMatch?: number
			): Promise<FetchedStory | typeof NOT_MODIFIED> {
				record('getStory', id);
				maybeFail();

				const entry = require(id);

				if (ifNoneMatch !== undefined && ifNoneMatch === entry.rev) {
					return NOT_MODIFIED;
				}

				return {rev: entry.rev, story: onTheWire(entry.body)};
			},

			async putStory(
				story: Story,
				ifMatch?: number
			): Promise<PutStoryResponse> {
				record('putStory', story.id);
				maybeFail();

				return write(story, ifMatch, by, false);
			},

			async reviveStory(story: Story): Promise<PutStoryResponse> {
				record('reviveStory', story.id);
				maybeFail();

				return write(story, undefined, by, true);
			},

			async deleteStory(id: string, purge = false): Promise<void> {
				record('deleteStory', id);
				maybeFail();

				const entry = stories.get(id);

				if (!entry) {
					return;
				}

				if (purge) {
					stories.delete(id);
				} else {
					// No rev bump. This is what lets a client holding the pre-delete rev
					// republish with a correct `If-Match`.
					entry.deleted = true;
					entry.lastClient = by.name;
				}

				notify({by: by.name, id, t: 'deleted'}, by);
			},

			async getManifest(id: string): Promise<AssetManifest> {
				record('getManifest', id);
				maybeFail();

				const entry = require(id);

				return {
					assets: clone(entry.assets.assets ?? []),
					characters: clone(entry.assets.characters ?? []),
					missing: (entry.assets.assets ?? [])
						.filter(asset => !entry.blobs.has(asset.id))
						.map(asset => asset.id),
					rev: entry.assetRev,
					version: 1
				};
			},

			async putManifest(id: string, manifest: AssetManifestBody) {
				record('putManifest', id);
				maybeFail();

				const entry = require(id);

				entry.assets = clone(manifest);
				entry.assetRev += 1;

				notify({by: by.name, rev: entry.assetRev, story: id, t: 'assets'}, by);

				return {rev: entry.assetRev};
			},

			async diffAssets(
				id: string,
				assets: {id: string; hash: string; bytes: number}[]
			): Promise<AssetDiffResponse> {
				record('diffAssets', id);
				maybeFail();

				const entry = require(id);
				const missing: string[] = [];
				const present: string[] = [];
				const stale: string[] = [];

				for (const asset of assets) {
					const held = entry.blobs.get(asset.id);

					if (!held) {
						missing.push(asset.id);
					} else if (held.hash !== asset.hash) {
						stale.push(asset.id);
					} else {
						present.push(asset.id);
					}
				}

				return {missing, present, stale};
			},

			async headAsset(id: string, assetId: string) {
				record('headAsset', id);

				const held = require(id).blobs.get(assetId);

				return held ? {bytes: held.bytes, hash: held.hash} : undefined;
			},

			async getAssetBlob(id: string, assetId: string): Promise<Blob> {
				record('getAssetBlob', id);
				maybeFail();

				const held = require(id).blobs.get(assetId);

				if (!held) {
					throw new ServerError('no asset', {
						code: 'not_found',
						status: 404
					});
				}

				return held.blob;
			},

			async putAssetBlob(
				id: string,
				assetId: string,
				blob: Blob,
				hash: string
			): Promise<void> {
				record('putAssetBlob', id);
				maybeFail();

				require(id).blobs.set(assetId, {blob, bytes: blob.size, hash});
			},

			async listRevisions(id: string): Promise<RevisionsResponse> {
				record('listRevisions', id);

				return {current: require(id).rev, revisions: []};
			},

			async getRevision(id: string): Promise<Story> {
				record('getRevision', id);

				return onTheWire(require(id).body);
			},

			async restoreRevision(
				id: string,
				rev: number
			): Promise<RestoreResponse> {
				record('restoreRevision', id);

				const entry = require(id);

				entry.rev += 1;

				return {
					id,
					missingAssets: [],
					restoredFrom: rev,
					rev: entry.rev
				};
			}
		};
	}

	return {
		assetRevOf: id => stories.get(id)?.assetRev ?? 0,
		calls,
		client: makeClient,
		deleted: id => stories.get(id)?.deleted ?? false,
		failNext(count, error) {
			failures = count;
			failureError = error;
		},
		reset() {
			stories = new Map();
			calls.length = 0;
			failures = 0;
			failureError = undefined;
		},
		revOf: id => stories.get(id)?.rev ?? 0,
		seed(story, seedOptions) {
			const entry = blank(story);

			entry.rev = seedOptions?.rev ?? 1;
			entry.lastClient = seedOptions?.lastClient ?? 'seed';
			stories.set(story.id, entry);
		},
		stored: id => {
			const entry = stories.get(id);

			return entry ? onTheWire(entry.body) : undefined;
		}
	};
}
