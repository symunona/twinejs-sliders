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
 *   - PATCH requires `If-Match` where PUT does not, and goes through the same write
 *     path — same rev bump, same notification — as `Store.PatchStory` does in Go.
 *   - The asset manifest has its own rev, independent of the story's.
 *   - Writes are announced to a notifier the way the HTTP handlers call `api.Notifier`,
 *     with the writer's own id, so a test can reproduce echo suppression.
 *
 * # What it is NOT
 *
 * No auth, no revision BODIES, no size limits, no gzip, no disk. Add those here
 * when a test needs them rather than reaching for the real server — a test that needs the
 * real server should be an e2e spec.
 */

import {ServerError, NOT_MODIFIED, type ServerClient} from './client';
import type {AssetManifestBody, FetchedStory} from './client';
import type {Story} from '../../stories';
import {applyPassageDiff} from './story-diff';
import type {
	AssetDiffResponse,
	AssetManifest,
	HealthResponse,
	PatchStoryResponse,
	PingResponse,
	PutStoryResponse,
	RestoreResponse,
	RevisionEntry,
	RevisionMetaRequest,
	RevisionMetaResponse,
	RevisionsResponse,
	ServerMessage,
	StoryIndexEntry,
	StoryPatch
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
	/**
	 * Rows for versions that have been replaced, newest first. No bodies — the real
	 * server keeps `revs/<rev>.json.gz` beside each of these and nothing here reads one.
	 */
	revisions: RevisionEntry[];
	/**
	 * Label, pin and summary for the CURRENT version.
	 *
	 * Kept apart from the rows because that is where the real server keeps them:
	 * `meta.json` holds the current version's three fields, and they move onto a row the
	 * moment that version is replaced. Labelling the top row of the History dialog is the
	 * case this exists for.
	 */
	currentMeta: {label: string; pinned: boolean; summary: string};
	/** Set when the CURRENT version was itself produced by a restore. */
	currentRestoredFrom?: number;
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
	/** `PINNED_MAX`. Lowered in a test that wants to reach the cap in two clicks. */
	pinnedMax?: number;
}

const DEFAULT_NOW = '2026-01-01T00:00:00.000Z';

/**
 * Written as escapes on purpose: a literal control byte in a source string makes git call
 * the file binary while every test keeps passing. See `.claude/TRAPS.md`.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

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
	seed(
		story: Story,
		options?: {
			rev?: number;
			lastClient?: string;
			/**
			 * Rows for versions already replaced, newest first. Arranging a history
			 * through writes means one whole story body per row, which says nothing a
			 * test about the History dialog is asking.
			 */
			revisions?: RevisionEntry[];
		}
	): void;
	/** The story as the server holds it, or undefined. */
	stored(id: string): Story | undefined;
	revOf(id: string): number;
	assetRevOf(id: string): number;
	deleted(id: string): boolean;
	/** Every request any client has made, in order. For asserting what was NOT sent. */
	readonly calls: {method: string; id?: string; by: string}[];
	/**
	 * Every patch body that landed, in order, with the bytes it took on the wire.
	 *
	 * The size is the whole reason the route exists, so a test can assert it rather than
	 * assert that a PATCH merely happened.
	 */
	readonly patches: {id: string; by: string; patch: StoryPatch; bytes: number}[];
	/** Make the next `count` requests fail as a network error. */
	failNext(count: number, error?: ServerError): void;
	/** Drop everything. */
	reset(): void;
}

export function fakeServer(options: FakeServerOptions = {}): FakeServer {
	const now = options.now ?? (() => DEFAULT_NOW);
	let stories = new Map<string, StoredStory>();
	const calls: {method: string; id?: string; by: string}[] = [];
	const patches: {
		id: string;
		by: string;
		patch: StoryPatch;
		bytes: number;
	}[] = [];
	let failures = 0;
	let failureError: ServerError | undefined;

	const pinnedMax = options.pinnedMax ?? 50;
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
			// Always reported, like the Go row, and moved by `putManifest` alone. Leave it
			// off and every test that drives sync through this fake would be exercising the
			// old-server fallback in `use-server-sync.ts` while looking like it tested the
			// real path — and a manifest-only write, which moves neither total above, would
			// be indistinguishable from a text write.
			assetRev: entry.assetRev,
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
			currentMeta: {label: '', pinned: false, summary: ''},
			deleted: false,
			lastClient: '',
			rev: 0,
			revisions: [],
			updatedAt: now()
		};
	}

	/**
	 * Move the current version onto a row, the way the real server gzips the previous
	 * body into `revs/<oldRev>.json.gz` and rewrites `revs/index.json` on the way past.
	 *
	 * The three meta fields travel with it: they lived on `meta.json` while that version
	 * was current, and land on its row now that it is not. `hash` is a stand-in — nothing
	 * here stores bodies, so there is nothing to hash and nothing reads it.
	 */
	function archiveCurrent(entry: StoredStory): void {
		if (entry.rev === 0) {
			return;
		}

		entry.revisions.unshift({
			at: entry.updatedAt,
			bytes: JSON.stringify(entry.body).length,
			client: entry.lastClient,
			hash: `fake-${entry.rev}`,
			passages: entry.body.passages.length,
			rev: entry.rev,
			...(entry.currentMeta.label ? {label: entry.currentMeta.label} : {}),
			...(entry.currentMeta.pinned ? {pinned: true} : {}),
			...(entry.currentMeta.summary ? {summary: entry.currentMeta.summary} : {}),
			...(entry.currentRestoredFrom === undefined
				? {}
				: {restoredFrom: entry.currentRestoredFrom})
		});
	}

	/**
	 * The current version as a row.
	 *
	 * It has no entry in `revs/index.json` on the real server either — it is assembled
	 * from `meta.json` every time the list is asked for, which is exactly why its label
	 * and pin have to live somewhere other than the rows.
	 */
	function currentRow(entry: StoredStory): RevisionEntry {
		return {
			at: entry.updatedAt,
			bytes: JSON.stringify(entry.body).length,
			client: entry.lastClient,
			hash: `fake-${entry.rev}`,
			passages: entry.body.passages.length,
			rev: entry.rev,
			...(entry.currentMeta.label ? {label: entry.currentMeta.label} : {}),
			...(entry.currentMeta.pinned ? {pinned: true} : {}),
			...(entry.currentMeta.summary ? {summary: entry.currentMeta.summary} : {}),
			...(entry.currentRestoredFrom === undefined
				? {}
				: {restoredFrom: entry.currentRestoredFrom})
		};
	}

	function write(
		story: Story,
		ifMatch: number | undefined,
		by: FakeOrigin,
		revive: boolean,
		summary?: string
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

		archiveCurrent(entry);
		entry.currentMeta = {label: '', pinned: false, summary: summary ?? ''};
		entry.currentRestoredFrom = undefined;
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
				ifMatch?: number,
				putOptions: {summary?: string} = {}
			): Promise<PutStoryResponse> {
				record('putStory', story.id);
				maybeFail();

				return write(story, ifMatch, by, false, putOptions.summary);
			},

			async patchStory(
				id: string,
				patch: StoryPatch,
				ifMatch: number,
				patchOptions: {summary?: string} = {}
			): Promise<PatchStoryResponse> {
				record('patchStory', id);
				maybeFail();

				const entry = require(id);

				// If-Match is required here and optional on PUT. A patch against an
				// unknown base would silently resurrect whatever the other editor just
				// removed, so there is no "no precondition" branch to write.
				if (ifMatch !== entry.rev) {
					throw new ServerError('rev mismatch', {
						code: 'conflict',
						lastClient: entry.lastClient,
						rev: entry.rev,
						status: 412,
						updatedAt: entry.updatedAt
					});
				}

				// The patch is JSON on the wire like any other body, so a `Date` reaches
				// the server as a string. Cloning first is what stops a test passing on
				// an object the real server could never receive.
				const body = JSON.stringify(patch);
				const wire = JSON.parse(body) as StoryPatch;

				if ((wire.story as Record<string, unknown> | undefined)?.passages) {
					throw new ServerError(
						'patch.story may not carry `passages` — use patch.passages',
						{code: 'bad_request', status: 400}
					);
				}

				for (const passage of wire.passages?.changed ?? []) {
					if (!passage.id) {
						throw new ServerError(
							'every patch.passages.changed entry needs a non-empty `id`',
							{code: 'bad_request', status: 400}
						);
					}
				}

				patches.push({bytes: body.length, by: by.id, id, patch: wire});

				return write(
					applyPassageDiff(entry.body, wire),
					ifMatch,
					by,
					false,
					patchOptions.summary
				);
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

			async putManifest(
				id: string,
				manifest: AssetManifestBody,
				ifMatch?: number
			) {
				record('putManifest', id);
				maybeFail();

				const entry = require(id);

				// Own rev, own precondition — `PutManifest` in `server/store/assets.go`.
				if (ifMatch !== undefined && ifMatch !== entry.assetRev) {
					throw new ServerError('asset rev mismatch', {
						code: 'conflict',
						lastClient: entry.lastClient,
						rev: entry.assetRev,
						status: 412,
						updatedAt: entry.updatedAt
					});
				}

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
				maybeFail();

				const entry = require(id);

				// Newest first, with the CURRENT version as the first row — the real
				// list is built the same way, from `meta.json` plus `revs/index.json`.
				return clone({
					current: entry.rev,
					revisions: [currentRow(entry), ...entry.revisions]
				});
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
				maybeFail();

				const entry = require(id);

				// An ordinary write on the real server: the version being replaced
				// becomes a row of its own, so a restore never destroys anything. No
				// body is copied here because this fake keeps none.
				archiveCurrent(entry);
				entry.currentMeta = {label: '', pinned: false, summary: ''};
				entry.currentRestoredFrom = rev;
				entry.rev += 1;
				entry.updatedAt = now();
				entry.lastClient = by.name;

				notify({by: by.name, id, rev: entry.rev, t: 'story'}, by);

				return {
					id,
					missingAssets: [],
					restoredFrom: rev,
					rev: entry.rev
				};
			},

			async setRevisionMeta(
				id: string,
				rev: number,
				meta: RevisionMetaRequest
			): Promise<RevisionMetaResponse> {
				record('setRevisionMeta', id);
				maybeFail();

				// Neither field is nothing to do, and the real handler says so before it
				// touches the store.
				if (
					(meta.label === undefined || meta.label === null) &&
					(meta.pinned === undefined || meta.pinned === null)
				) {
					throw new ServerError(
						'body must carry `label`, `pinned` or both',
						{code: 'bad_request', status: 400}
					);
				}

				const entry = require(id);
				const row =
					rev === entry.rev
						? entry.currentMeta
						: entry.revisions.find(revision => revision.rev === rev);

				if (!row) {
					throw new ServerError(`no revision ${rev}`, {
						code: 'not_found',
						status: 404
					});
				}

				const was = {
					label: row.label ?? '',
					pinned: row.pinned ?? false
				};
				const label =
					meta.label === undefined || meta.label === null
						? was.label
						: [...meta.label.replace(CONTROL_CHARS, '')].slice(0, 120).join('');
				const pinned =
					meta.pinned === undefined || meta.pinned === null
						? was.pinned
						: meta.pinned;

				// The cap counts what the story holds now, current version included, and
				// only bites when this call would ADD one. Unpinning is never refused.
				const pins =
					(entry.currentMeta.pinned ? 1 : 0) +
					entry.revisions.filter(revision => revision.pinned).length;

				if (pinned && !was.pinned && pins >= pinnedMax) {
					throw new ServerError(
						`story already has ${pins} pinned revisions (PINNED_MAX); ` +
							'unpin one before pinning another',
						{code: 'bad_request', status: 400}
					);
				}

				row.label = label;
				row.pinned = pinned;

				notify({id, rev, t: 'revmeta'}, by);

				return {
					id,
					label,
					pinned,
					pinnedMax,
					pins: pins + (pinned === was.pinned ? 0 : pinned ? 1 : -1),
					rev,
					summary: row.summary ?? ''
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
		patches,
		reset() {
			stories = new Map();
			calls.length = 0;
			patches.length = 0;
			failures = 0;
			failureError = undefined;
		},
		revOf: id => stories.get(id)?.rev ?? 0,
		seed(story, seedOptions) {
			const entry = blank(story);

			entry.rev = seedOptions?.rev ?? 1;
			entry.lastClient = seedOptions?.lastClient ?? 'seed';
			entry.revisions = (seedOptions?.revisions ?? []).map(revision => ({
				...revision
			}));
			stories.set(story.id, entry);
		},
		stored: id => {
			const entry = stories.get(id);

			return entry ? onTheWire(entry.body) : undefined;
		}
	};
}
