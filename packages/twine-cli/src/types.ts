/**
 * @sliders/twine-cli — the contract every module in this package agrees on (spec 12).
 *
 * Two rules shape it. Reads may take the short path — the store's DATA_DIR is plain files
 * and a reader always sees a complete one (temp-file + rename), so `Source` has a local
 * implementation that never opens a socket. Writes may not: only the API bumps `rev`,
 * snapshots into `revs/` and tells open editors, so every mutation goes through
 * `WriteClient`, which is HTTP and nothing else.
 */

/** The story body as stored: `passages` plus whatever else Twine puts there. */
export interface StoryBody {
	id: string;
	ifid: string;
	name: string;
	passages: PassageObject[];
	[key: string]: unknown;
}

/** One passage inside a body. Only the fields the CLI touches are named. */
export interface PassageObject {
	id: string;
	name: string;
	tags: string[];
	text: string;
	left: number;
	top: number;
	[key: string]: unknown;
}

/** `meta.json` — StoryIndexEntry plus the fields only the store keeps. */
export interface StoryMeta {
	id: string;
	ifid: string;
	name: string;
	rev: number;
	updatedAt: string;
	lastClient: string;
	deleted: boolean;
	passageCount: number;
	bytes: number;
	assetCount: number;
	assetBytes: number;
	assetRev: number;
}

export interface AssetMetaRow {
	id: string;
	name: string;
	kind: string;
	tags: string[];
	w: number;
	h: number;
	bytes: number;
	hash: string;
	mime: string;
	ownerCharacter?: string;
}

export interface Manifest {
	version: number;
	assets: AssetMetaRow[];
	characters: unknown[];
	rev: number;
	/** Manifest entries whose bytes the store does not have. Computed, never stored. */
	missing: string[];
}

/**
 * Everything the CLI reads. Two implementations: `LocalSource` reads DATA_DIR directly,
 * `HttpSource` calls the API. Callers never learn which one answered.
 */
export interface Source {
	readonly mode: 'local' | 'remote';
	list(includeDeleted?: boolean): Promise<StoryMeta[]>;
	meta(storyId: string): Promise<StoryMeta>;
	body(storyId: string, rev?: number): Promise<StoryBody>;
	manifest(storyId: string): Promise<Manifest>;
	/** Absolute path of an asset blob, when one exists on this machine. */
	assetPath(storyId: string, assetId: string): Promise<string | undefined>;
	assetBytes(storyId: string, assetId: string): Promise<Buffer>;
	revisions(storyId: string): Promise<RevisionRow[]>;
}

export interface RevisionRow {
	rev: number;
	at: string;
	client: string;
	bytes: number;
	hash: string;
	passages: number;
	restoredFrom?: number;
}

/** Every mutation. Always HTTP — see the header comment. */
export interface WriteClient {
	putStory(
		storyId: string,
		body: StoryBody,
		ifMatch: number
	): Promise<{id: string; rev: number; updatedAt: string; bytes: number}>;
	putManifest(storyId: string, manifest: Manifest, ifMatch: number): Promise<{rev: number}>;
	putAsset(storyId: string, assetId: string, bytes: Buffer, hash: string, mime: string): Promise<void>;
	deleteStory(storyId: string, purge: boolean): Promise<void>;
	restore(storyId: string, rev: number): Promise<{rev: number; restoredFrom: number; missingAssets: string[]}>;
	ping(): Promise<Record<string, unknown>>;
	health(): Promise<Record<string, unknown>>;
}

/** Resolved configuration for one invocation. */
export interface Config {
	server: string;
	token: string;
	dataDir?: string;
	clientId: string;
	clientName: string;
}

/** What `bin.ts` hands every command. */
export interface Ctx {
	config: Config;
	source: Source;
	write: WriteClient;
	flags: Record<string, string | boolean>;
	json: boolean;
	quiet: boolean;
	out(line: string): void;
}

/** A parsed ref (spec 12 §1). */
export type Ref =
	| {kind: 'story'; story: string; rev?: number}
	| {kind: 'passage'; story: string; rev?: number; passage: string}
	| {kind: 'scene'; story: string; rev?: number; scene: string}
	| {kind: 'asset'; story: string; asset: string};

/** The front matter `cat` stamps and `put` reads back. */
export interface Receipt {
	story: string;
	passage: string;
	rev: number;
	hash: string;
	name?: string;
	tags?: string[];
	at?: [number, number];
}

/** Exit codes are part of the contract (spec 12 §7). */
export const EXIT = {
	ok: 0,
	notFound: 1,
	usage: 2,
	conflict: 3,
	server: 4,
	lint: 5
} as const;

/** Thrown by anything that wants a specific exit code. */
export class CliError extends Error {
	constructor(
		message: string,
		public code: number = EXIT.usage
	) {
		super(message);
	}
}
