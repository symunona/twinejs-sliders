/**
 * Wire and sync types for the story backup server (spec 11).
 *
 * This file is the contract every other module in this directory, and the Go server in
 * `server/`, agree on. Change it and change both sides.
 */

import type {AssetMeta, Character} from '@sliders/scene-types';
import type {Story} from '../../stories';

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
}

export function newSyncRecord(storyId: string): SyncRecord {
	return {pushedHash: '', rev: 0, state: 'idle', storyId};
}
