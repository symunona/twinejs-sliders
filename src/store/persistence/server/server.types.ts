/**
 * Wire and sync types for the story backup server (spec 11).
 *
 * This file is the contract every other module in this directory, and the Go server in
 * `server/`, agree on. Change it and change both sides.
 */

import type {AssetMeta, Character} from '@sliders/scene-types';
import type {Passage, Story} from '../../stories';

export const API_VERSION = 1;

// ---------------------------------------------------------------------------
// Server responses
// ---------------------------------------------------------------------------

export type ServerErrorCode =
	| 'unauthorized'
	| 'not_found'
	| 'conflict'
	| 'deleted'
	| 'too_large'
	| 'bad_request'
	| 'hash_mismatch'
	| 'internal';

export interface ServerErrorBody {
	error: {code: ServerErrorCode; message: string};
	/** Present on 412. */
	rev?: number;
	updatedAt?: string;
	lastClient?: string;
}

export interface HealthResponse {
	ok: boolean;
	service: string;
	apiVersion: number;
}

export interface PingResponse {
	ok: boolean;
	apiVersion: number;
	version: string;
	storyCount: number;
	bytesUsed: number;
	maxAssetBytes: number;
	maxStoryBytes: number;
	keepRevisions: number;
	events: boolean;
	clients: {id: string; name: string}[];
	time: string;
}

/** One row of `GET /stories`. Enough to draw a card without downloading anything. */
export interface StoryIndexEntry {
	id: string;
	ifid: string;
	name: string;
	rev: number;
	updatedAt: string;
	lastClient: string;
	passageCount: number;
	bytes: number;
	assetCount: number;
	assetBytes: number;
	/**
	 * The asset manifest's own rev. Bumps on every manifest write.
	 *
	 * OPTIONAL, and it has to be: a server older than this field sends the row without it,
	 * so the type would be lying if it promised a number. Every reader has to decide what
	 * "the server cannot say" means for it — `use-server-sync.ts` is the one that matters
	 * and says so there.
	 *
	 * It exists because the two totals above answer a narrower question than they look
	 * like they do. `assetCount` and `assetBytes` move only when art is added or dropped,
	 * and an edit's settings, an anchor or a cutout sidecar all rewrite the manifest
	 * without touching either — so a client watching the totals alone never learns that
	 * the art it is holding changed.
	 */
	assetRev?: number;
	deleted: boolean;
}

export interface StoryIndexResponse {
	stories: StoryIndexEntry[];
}

export interface PutStoryRequest {
	story: Story;
	client: string;
}

export interface PutStoryResponse {
	id: string;
	rev: number;
	updatedAt: string;
	bytes: number;
}

// ---------------------------------------------------------------------------
// PATCH /stories/{id} — per-passage upload
// ---------------------------------------------------------------------------

/**
 * What changed since the rev named in `If-Match`.
 *
 * Autosave PUTs the whole story every 5s. At the 20-100KB of passage text this is
 * heading for, one typed sentence costs 100KB of upload on whatever the phone has —
 * and the tab-close save goes out with `keepalive`, which the Fetch spec caps at 64KB
 * of request body, so at that size the last save before a tab closes silently does not
 * happen at all.
 *
 * Passages are sent whole, never text-diffed: sending one 8KB passage instead of a
 * 100KB story is already the win, and a text diff would mean client and server agreeing
 * on a diff algorithm forever.
 */
export interface StoryPatch {
	passages?: {
		/** Whole passage objects. Matched by `id`: present replaces, absent appends. */
		changed?: Passage[];
		/** Passage ids to drop. Naming one that is already gone is not an error. */
		removed?: string[];
	};
	/**
	 * Changed top-level scalars only — name, script, stylesheet, startPassage,
	 * tagColors, zoom… `passages` is refused here (400): it has its own half above, and
	 * accepting both would be two answers to one question.
	 */
	story?: Partial<Omit<Story, 'passages'>>;
}

/**
 * What the server is holding for one story, small enough to keep beside a `SyncRecord`.
 *
 * A patch is only meaningful against the base it was computed from, so this browser has
 * to remember what it last agreed with the server about. Keeping the last-pushed BODY
 * would mean a second copy of every story in `localStorage`; a hash per passage is ~60
 * bytes a passage and answers the only question a diff asks. It also survives a reload,
 * which an in-memory copy would not — and the reload case is exactly the one the
 * `keepalive` size cap bites in.
 *
 * Passages are hashed WHOLE — every property, not the `hashedPassageProps` subset
 * `storyHash` uses. The two answer different questions: `storyHash` asks "did the author
 * change anything worth pushing", this asks "are the bytes the server holds for this
 * passage the bytes I have". A patch sends whole passage objects, so the base has to
 * describe whole passage objects or the two drift apart one `selected` flag at a time.
 *
 * Built and read in `story-diff.ts`.
 */
export interface StorySnapshot {
	/**
	 * `storyHash` of the story this describes.
	 *
	 * A snapshot is usable only while this equals the record's `pushedHash`, so every
	 * path that writes a `pushedHash` WITHOUT a snapshot — a pull, a checkout, a publish
	 * — invalidates it for free. The cost of that is one whole PUT, which mints a fresh
	 * one; the benefit is that no other file had to learn snapshots exist.
	 */
	hash: string;
	/** Passage id -> hash of the whole passage. */
	passages: Record<string, string>;
	/** Top-level key -> hash of its value. `passages` is never in here. */
	story: Record<string, string>;
}

export interface PatchStoryRequest {
	client: string;
	patch: StoryPatch;
}

/** Same shape a PUT answers with: PATCH goes through the same write path. */
export type PatchStoryResponse = PutStoryResponse;

export interface AssetManifest {
	version: number;
	assets: AssetMeta[];
	characters: Character[];
	rev: number;
	/** Manifest entries whose bytes the server does not have. */
	missing: string[];
}

export interface AssetDiffRequest {
	assets: {id: string; hash: string; bytes: number}[];
}

export interface AssetDiffResponse {
	missing: string[];
	present: string[];
	/** Present, but stored under a different hash. Re-upload. */
	stale: string[];
}

export interface RevisionEntry {
	rev: number;
	at: string;
	client: string;
	bytes: number;
	hash: string;
	passages: number;
	/** Set when this revision was made by restoring an older one. */
	restoredFrom?: number;
}

export interface RevisionsResponse {
	current: number;
	revisions: RevisionEntry[];
}

export interface RestoreResponse {
	id: string;
	rev: number;
	restoredFrom: number;
	missingAssets: string[];
}

// ---------------------------------------------------------------------------
// Websocket
// ---------------------------------------------------------------------------

export interface PresenceClient {
	id: string;
	name: string;
	story: string | null;
	passage: string | null;
	since: string;
}

export type ClientMessage =
	| {t: 'hello'; client: string; name: string; stories: string[]}
	| {t: 'focus'; story: string; passage: string | null}
	| {t: 'blur'; story: string; passage: string | null}
	| {t: 'steal'; story: string; passage: string}
	| {t: 'ping'};

export type ServerMessage =
	| {t: 'welcome'; clients: PresenceClient[]}
	| {t: 'story'; id: string; rev: number; by: string}
	| {t: 'deleted'; id: string; by: string}
	| {t: 'revived'; id: string; rev: number; by: string}
	| {t: 'assets'; story: string; rev: number; by: string}
	| {t: 'presence'; clients: PresenceClient[]}
	| {t: 'stolen'; story: string; passage: string; by: string}
	| {t: 'pong'};

// ---------------------------------------------------------------------------
// Local sync bookkeeping — never sent to the server
// ---------------------------------------------------------------------------

export type SyncState =
	'idle' | 'dirty' | 'pushing' | 'pulling' | 'conflict' | 'gone' | 'error';

export interface SyncRecord {
	storyId: string;
	/** Server rev this client last saw. 0 = never synced. */
	rev: number;
	/** Hash of the story JSON as last pushed or pulled. */
	pushedHash: string;
	state: SyncState;
	lastError?: string;
	lastPushedAt?: number;
	lastPulledAt?: number;
	/** Rev on the server when a conflict was detected. */
	conflictRev?: number;
	conflictClient?: string;
	/**
	 * Server rev whose text the local store refused to take (`apply-pull.ts`).
	 *
	 * Set only by a refused pull, and cleared by a pull that lands. Its whole job is to
	 * stop the automatic path asking again for the same rev: a pull clears the story's
	 * undo stack, so retrying one that cannot land destroys undo history on a timer.
	 */
	pullBlockedRev?: number;
	/**
	 * What the server holds at `rev`, so the next push can be a PATCH of the difference
	 * rather than the whole story.
	 *
	 * Usable only while `snapshot.hash === pushedHash`. See `StorySnapshot`.
	 */
	snapshot?: StorySnapshot;
}

export function newSyncRecord(storyId: string): SyncRecord {
	return {pushedHash: '', rev: 0, state: 'idle', storyId};
}
