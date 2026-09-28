import {BlobCache, CachedBlob} from './blob-cache';
import {
	hamming,
	hashContent,
	ImageDecoder,
	SIMILAR_DISTANCE,
	sha256Hex
} from './hash';
import {LocalDb, RecordConflict, StoredRecord} from './local-db';
import {clone, deepEqual, getPath, merge3, sameContent, setPath} from './merge';
import {Resolver} from './resolve';
import {
	BadRecordError,
	BlobMissingError,
	CollectionMissingError,
	CollectionNameTakenError,
	CollectionNotEmptyError,
	Holder,
	isTransient,
	LibTransport,
	NameTakenError,
	StaleError
} from './transport';
import {
	AssetRecipe,
	AssetRecord,
	BindingRecord,
	CharacterRecord,
	CollectionKind,
	CollectionRecord,
	LibRecord,
	RECORD_TYPES,
	RecordOf,
	RecordType,
	WriteResult,
	namespaceName,
	parseRecordKey,
	recordBlobs,
	recordCollections,
	recordKey
} from './types';

/**
 * The library client (plans 1 + 2, asset-library-contract.md).
 *
 * Holds every record in memory, writes through to a LocalDb in order, and syncs record by
 * record: an outbox pushes local edits with If-Match, a change-feed cursor pulls everyone
 * else's. The rules that kill the old sync bugs, enforced here and checked by the tests:
 *
 * 1. A record PUT is only sent after `/blobs/has` + blob PUTs for every sha it names.
 * 2. Applying a pulled record never enqueues a write.
 * 3. `base` (last agreed server copy) is persisted with the record.
 * 4. 412 → 3-way merge base/local/current. Never a blind retry with the local body.
 * 5. The outbox is persisted. A reload resumes it.
 */

export interface Clock {
	now(): number;
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
	now: () => Date.now(),
	setTimeout: (callback, ms) => setTimeout(callback, ms),
	clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export interface ChangeEvent {
	/** Collections whose contents (or binding) changed. UI re-renders only these. */
	collections: string[];
	ids: string[];
	source: 'local' | 'remote';
}

export interface StatusEvent {
	/** Records waiting to be pushed. */
	pending: number;
	conflicts: number;
	offline: boolean;
}

export type Notice =
	| {
			kind: 'renamed-on-clash';
			type: RecordType;
			id: string;
			from: string;
			to: string;
			holder?: Holder;
	  }
	| {kind: 'conflict'; type: RecordType; id: string; fields: string[]}
	| {kind: 'delete-refused'; type: RecordType; id: string; count: number}
	| {kind: 'collection-missing'; type: RecordType; id: string}
	| {kind: 'rejected'; type: RecordType; id: string; detail: string}
	| {kind: 'blob-lost'; type: RecordType; id: string; missing: string[]};

/** A repaint or recipe change on a locked (curated) collection without `override`. */
export class LockedError extends Error {
	constructor(readonly collection: string) {
		super(
			`Collection ${collection} is locked: fork the asset, or pass {override: true}.`
		);
		this.name = 'LockedError';
		Object.setPrototypeOf(this, LockedError.prototype);
	}
}

/** Internal: the server wants a blob this device does not hold. */
class BlobLostError extends Error {
	constructor(readonly missing: string[]) {
		super(`Blobs not in the local cache: ${missing.join(', ')}`);
		Object.setPrototypeOf(this, BlobLostError.prototype);
	}
}

export interface DuplicateReport {
	sha: string;
	/** Same bytes. */
	exact: AssetRecord[];
	/** Same decoded pixels, different bytes. */
	pixel: AssetRecord[];
	/** dHash within SIMILAR_DISTANCE. Advisory. */
	similar: {asset: AssetRecord; distance: number}[];
}

export interface SidecarInput {
	bytes: Uint8Array;
	mime: string;
}

type AssetFields = Omit<
	AssetRecord,
	'id' | 'type' | 'rev' | 'by' | 'at' | 'deleted'
>;

export interface AddAssetOptions
	extends Partial<
		Omit<AssetFields, 'blob' | 'sidecars' | 'collection' | 'name'>
	> {
	collection: string;
	name: string;
	sidecars?: Record<string, SidecarInput>;
	/** Create even when the library already has these bytes or pixels. */
	allowDuplicate?: boolean;
	id?: string;
}

export interface AddAssetResult {
	/** Absent when duplicates were found and `allowDuplicate` was not set. */
	asset?: AssetRecord;
	duplicates: DuplicateReport;
}

export type AssetPatch = Partial<Omit<AssetFields, 'recipe'>> & {
	/** Merged per key; a key set to `undefined` is removed. */
	recipe?: Partial<AssetRecipe>;
};

export interface ReplaceBlobOptions {
	recipe?: Partial<AssetRecipe>;
	/** `null` removes a sidecar. */
	sidecars?: Record<string, SidecarInput | null>;
	override?: boolean;
}

export interface CharacterInput
	extends Partial<
		Omit<CharacterRecord, 'type' | 'rev' | 'by' | 'at' | 'deleted'>
	> {
	id?: string;
	collection: string;
	charId: string;
}

export type FieldPick = 'mine' | 'theirs';

export type ConflictChoice =
	| 'mine'
	| 'theirs'
	| 'keep-both'
	| {picks: Record<string, FieldPick>};

export interface ConflictInfo {
	id: string;
	type: RecordType;
	kind: RecordConflict['kind'];
	fields: string[];
	base?: LibRecord;
	local: LibRecord;
	current: LibRecord | null;
}

export interface LibraryEngineOptions {
	db: LocalDb;
	blobs: BlobCache;
	transport: LibTransport;
	clientName: string;
	clock?: Clock;
	decoder?: ImageDecoder;
	/** Edit → push delay. Default 1000 ms. */
	debounceMs?: number;
	/** Records pushed in parallel. Default 4. */
	concurrency?: number;
	/** uuid source; injectable so property tests are reproducible. */
	newId?: () => string;
}

const MAX_ATTEMPTS_PER_DRAIN = 4;
const MAX_NAME_CLASHES = 20;

type Listener<T> = (event: T) => void;

function randomUuid(): string {
	const crypto = globalThis.crypto;

	if (typeof crypto?.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	const bytes = new Uint8Array(16);

	crypto.getRandomValues(bytes);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex = Array.from(bytes, byte =>
		byte.toString(16).padStart(2, '0')
	).join('');

	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
		12,
		16
	)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `base`, or `base-2`, `base-3`, … until one is free. */
export function uniqueName(base: string, taken: Set<string>, from = 2): string {
	if (from <= 2 && !taken.has(base)) {
		return base;
	}

	for (let n = Math.max(2, from); ; n++) {
		const candidate = `${base}-${n}`;

		if (!taken.has(candidate)) {
			return candidate;
		}
	}
}

function nameField(type: RecordType): 'name' | 'charId' {
	return type === 'character' ? 'charId' : 'name';
}

/** Only `deleted` differs from base: a plain DELETE says it. */
function onlyDeletedDiffers(base: LibRecord, body: LibRecord): boolean {
	return sameContent({...base, deleted: body.deleted} as LibRecord, body);
}

export class LibraryEngine {
	private db: LocalDb;
	private blobs: BlobCache;
	private transport: LibTransport;
	private clock: Clock;
	private decoder?: ImageDecoder;
	private debounceMs: number;
	private concurrency: number;
	private newId: () => string;
	readonly clientName: string;

	private records = new Map<string, StoredRecord>();
	private outbox: string[] = [];
	private cursor = 0;
	private knownHead = 0;
	private needsPull = true;
	private offline = false;
	private started = false;
	private disposed = false;

	private persistChain: Promise<void> = Promise.resolve();
	private syncChain: Promise<void> = Promise.resolve();
	private tasks = new Set<Promise<unknown>>();
	private timer?: unknown;
	private openStories = new Set<string>();
	private blobFetches = new Map<string, Promise<CachedBlob>>();
	private objectUrls = new Map<string, string>();

	private changeListeners = new Set<Listener<ChangeEvent>>();
	private statusListeners = new Set<Listener<StatusEvent>>();
	private noticeListeners = new Set<Listener<Notice>>();

	constructor(options: LibraryEngineOptions) {
		this.db = options.db;
		this.blobs = options.blobs;
		this.transport = options.transport;
		this.clientName = options.clientName;
		this.clock = options.clock ?? realClock;
		this.decoder = options.decoder;
		this.debounceMs = options.debounceMs ?? 1000;
		this.concurrency = options.concurrency ?? 4;
		this.newId = options.newId ?? randomUuid;
	}

	// =========================================================================
	// Lifecycle
	// =========================================================================

	/** Loads persisted state. No network: call `sync()` (app start) when ready. */
	async start(): Promise<void> {
		if (this.started) {
			return;
		}

		const snapshot = await this.db.load();

		for (const record of snapshot.records) {
			this.records.set(recordKey(record.type, record.id), record);
		}

		this.outbox = snapshot.outbox.filter(key => this.records.has(key));
		this.cursor = snapshot.cursor;
		this.knownHead = snapshot.cursor;
		this.needsPull = true;
		this.started = true;
		this.emitStatus();
	}

	/** Stops timers, waits for in-flight work and the last write to the LocalDb. */
	async dispose(): Promise<void> {
		this.cancelTimer();
		await this.idle();
		this.disposed = true;

		for (const url of this.objectUrls.values()) {
			URL.revokeObjectURL?.(url);
		}

		this.objectUrls.clear();
	}

	/** Resolves when no sync, timer-fired flush or LocalDb write is in flight. */
	async idle(): Promise<void> {
		for (;;) {
			const sync = this.syncChain;
			const persist = this.persistChain;
			const tasks = [...this.tasks, sync, persist];

			await Promise.all(tasks.map(task => task.catch(() => undefined)));

			if (
				this.tasks.size === 0 &&
				this.syncChain === sync &&
				this.persistChain === persist
			) {
				return;
			}
		}
	}

	private track<T>(promise: Promise<T>): Promise<T> {
		const tracked = promise.finally(() => this.tasks.delete(tracked));

		this.tasks.add(tracked);
		tracked.catch(() => undefined);

		return tracked;
	}

	// =========================================================================
	// Events
	// =========================================================================

	onChange(listener: Listener<ChangeEvent>): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	onStatus(listener: Listener<StatusEvent>): () => void {
		this.statusListeners.add(listener);
		return () => this.statusListeners.delete(listener);
	}

	onNotice(listener: Listener<Notice>): () => void {
		this.noticeListeners.add(listener);
		return () => this.noticeListeners.delete(listener);
	}

	private emitChange(
		records: (LibRecord | undefined)[],
		source: 'local' | 'remote'
	) {
		const present = records.filter((record): record is LibRecord => !!record);

		if (!present.length) {
			return;
		}

		const event: ChangeEvent = {
			collections: Array.from(new Set(present.flatMap(recordCollections))),
			ids: Array.from(new Set(present.map(record => record.id))),
			source
		};

		for (const listener of this.changeListeners) {
			listener(event);
		}
	}

	private notice(notice: Notice) {
		for (const listener of this.noticeListeners) {
			listener(notice);
		}
	}

	status(): StatusEvent {
		let conflicts = 0;

		for (const record of this.records.values()) {
			if (record.conflict) {
				conflicts++;
			}
		}

		return {pending: this.outbox.length, conflicts, offline: this.offline};
	}

	private emitStatus() {
		const status = this.status();

		for (const listener of this.statusListeners) {
			listener(status);
		}
	}

	private setOffline(offline: boolean) {
		if (this.offline !== offline) {
			this.offline = offline;
			this.emitStatus();
		}
	}

	// =========================================================================
	// Reads
	// =========================================================================

	private stored(id: string, type?: RecordType): StoredRecord | undefined {
		if (type) {
			return this.records.get(recordKey(type, id));
		}

		for (const candidate of RECORD_TYPES) {
			const record = this.records.get(recordKey(candidate, id));

			if (record) {
				return record;
			}
		}

		return undefined;
	}

	private require<T extends RecordType>(id: string, type: T): StoredRecord {
		const record = this.stored(id, type);

		if (!record) {
			throw new Error(`No ${type} ${id} in the library.`);
		}

		return record;
	}

	/** The local view of a record, deleted ones included. A copy. */
	get<T extends RecordType = RecordType>(
		id: string,
		type?: T
	): RecordOf<T> | undefined {
		return clone(this.stored(id, type)?.local) as RecordOf<T> | undefined;
	}

	/** Full stored state: base, local, dirty, conflict. A copy. */
	state(id: string, type?: RecordType): StoredRecord | undefined {
		return clone(this.stored(id, type));
	}

	/** Every live record of a type, local view. */
	list<T extends RecordType>(
		type: T,
		options: {includeDeleted?: boolean} = {}
	): RecordOf<T>[] {
		const out: RecordOf<T>[] = [];

		for (const record of this.records.values()) {
			if (
				record.type === type &&
				(options.includeDeleted || !record.local.deleted)
			) {
				out.push(clone(record.local) as RecordOf<T>);
			}
		}

		return out;
	}

	collections(): CollectionRecord[] {
		return this.list('collection');
	}

	collectionByName(name: string): CollectionRecord | undefined {
		return this.collections().find(collection => collection.name === name);
	}

	assets(collection?: string): AssetRecord[] {
		return this.list('asset').filter(
			asset => collection === undefined || asset.collection === collection
		);
	}

	characters(collection?: string): CharacterRecord[] {
		return this.list('character').filter(
			character =>
				collection === undefined || character.collection === collection
		);
	}

	binding(storyId: string): BindingRecord | undefined {
		const record = this.stored(storyId, 'binding')?.local as
			| BindingRecord
			| undefined;

		return record && !record.deleted ? clone(record) : undefined;
	}

	conflicts(): ConflictInfo[] {
		const out: ConflictInfo[] = [];

		for (const record of this.records.values()) {
			if (record.conflict) {
				out.push({
					id: record.id,
					type: record.type,
					kind: record.conflict.kind,
					fields: [...record.conflict.fields],
					base: clone(record.base),
					local: clone(record.local),
					current: clone(record.conflict.current)
				});
			}
		}

		return out;
	}

	get syncCursor(): number {
		return this.cursor;
	}

	resolver(storyId: string): Resolver {
		return new Resolver({
			collections: this.collections(),
			assets: this.assets(),
			characters: this.characters(),
			binding: this.binding(storyId)
		});
	}

	/** Stories whose binding lists this asset in `refs`. */
	usage(assetId: string): string[] {
		return this.list('binding')
			.filter(binding => binding.refs?.includes(assetId))
			.map(binding => binding.id)
			.sort();
	}

	/** Names taken in a collection's namespace (assets + characters), local view. */
	private takenNames(collection: string, exceptKey?: string): Set<string> {
		const taken = new Set<string>();

		for (const [key, record] of this.records) {
			const local = record.local;

			if (
				key === exceptKey ||
				local.deleted ||
				(local.type !== 'asset' && local.type !== 'character') ||
				local.collection !== collection
			) {
				continue;
			}

			taken.add(namespaceName(local)!);
		}

		return taken;
	}

	private takenCollectionNames(exceptKey?: string): Set<string> {
		const taken = new Set<string>();

		for (const [key, record] of this.records) {
			if (
				key !== exceptKey &&
				record.local.type === 'collection' &&
				!record.local.deleted
			) {
				taken.add(record.local.name);
			}
		}

		return taken;
	}

	private holderOf(
		collection: string,
		name: string,
		exceptKey?: string
	): Holder | undefined {
		for (const [key, record] of this.records) {
			const local = record.local;

			if (
				key !== exceptKey &&
				!local.deleted &&
				(local.type === 'asset' || local.type === 'character') &&
				local.collection === collection &&
				namespaceName(local) === name
			) {
				return {type: local.type, id: local.id};
			}
		}

		return undefined;
	}

	private assertNameFree(collection: string, name: string, exceptKey?: string) {
		const holder = this.holderOf(collection, name, exceptKey);

		if (holder) {
			throw new NameTakenError(
				holder,
				`"${name}" is already taken in this collection.`
			);
		}
	}

	private assertLiveCollection(id: string): CollectionRecord {
		const collection = this.stored(id, 'collection')?.local as
			| CollectionRecord
			| undefined;

		if (!collection || collection.deleted) {
			throw new CollectionMissingError();
		}

		return collection;
	}

	// =========================================================================
	// Local writes
	// =========================================================================

	private persist(key: string) {
		const record = this.records.get(key);
		const snapshot = clone(record);
		const {type, id} = parseRecordKey(key);

		this.enqueuePersist(() =>
			snapshot ? this.db.putRecord(snapshot) : this.db.deleteRecord(type, id)
		);
	}

	private persistOutbox() {
		const keys = [...this.outbox];

		this.enqueuePersist(() => this.db.setOutbox(keys));
	}

	private persistCursor() {
		const cursor = this.cursor;

		this.enqueuePersist(() => this.db.setCursor(cursor));
	}

	private enqueuePersist(write: () => Promise<void>) {
		this.persistChain = this.persistChain.then(write).catch(error => {
			console.error('asset library: local write failed', error);
		});
	}

	private enqueue(key: string) {
		if (!this.outbox.includes(key)) {
			this.outbox.push(key);
			this.persistOutbox();
		}
	}

	private dequeue(key: string) {
		const index = this.outbox.indexOf(key);

		if (index >= 0) {
			this.outbox.splice(index, 1);
			this.persistOutbox();
		}
	}

	/**
	 * Every local edit lands here: new `local`, dirty, into the outbox, debounced push.
	 * An edit that returns the record to its base is clean again and leaves the outbox.
	 */
	private stage(local: LibRecord): LibRecord {
		const key = recordKey(local.type, local.id);
		const existing = this.records.get(key);
		const before = existing?.local;
		const record: StoredRecord = existing
			? {...existing, local: clone(local)}
			: {id: local.id, type: local.type, local: clone(local), dirty: true};

		// A local edit is the user's answer to a stuck push: try again.
		if (record.conflict && record.conflict.kind !== 'fields') {
			record.conflict = undefined;
		}

		record.dirty = !record.base || !sameContent(record.base, record.local);

		if (!record.base && record.local.deleted) {
			// Created and deleted before the server ever saw it.
			this.records.delete(key);
			this.dequeue(key);
		} else {
			this.records.set(key, record);

			if (record.dirty && !record.conflict) {
				this.enqueue(key);
			} else {
				this.dequeue(key);
			}
		}

		this.persist(key);
		this.emitChange([before, local], 'local');
		this.emitStatus();
		this.scheduleFlush();

		return clone(local);
	}

	private draft<T extends RecordType>(
		type: T,
		fields: Record<string, unknown>,
		id?: string
	) {
		return {
			...fields,
			id: id ?? this.newId(),
			type,
			rev: 0,
			deleted: false,
			by: this.clientName,
			at: ''
		} as unknown as RecordOf<T>;
	}

	private scheduleFlush() {
		if (this.disposed) {
			return;
		}

		this.cancelTimer();
		this.timer = this.clock.setTimeout(() => {
			this.timer = undefined;
			this.track(this.flush()).catch(error =>
				console.error('asset library: push failed', error)
			);
		}, this.debounceMs);
	}

	private cancelTimer() {
		if (this.timer !== undefined) {
			this.clock.clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	private assertUnlocked(asset: AssetRecord, override?: boolean) {
		const collection = this.stored(asset.collection, 'collection')?.local as
			| CollectionRecord
			| undefined;

		if (collection?.locked && !override) {
			throw new LockedError(collection.name);
		}
	}

	// ---- collections --------------------------------------------------------

	createCollection(input: {
		name: string;
		kind?: CollectionKind;
		description?: string;
		locked?: boolean;
		id?: string;
	}): CollectionRecord {
		const {id, ...fields} = input;

		if (this.takenCollectionNames().has(fields.name)) {
			throw new CollectionNameTakenError(undefined);
		}

		return this.stage(
			this.draft('collection', {kind: 'shared', ...fields}, id)
		) as CollectionRecord;
	}

	updateCollection(
		id: string,
		patch: Partial<
			Pick<CollectionRecord, 'name' | 'description' | 'locked' | 'kind'>
		> &
			Record<string, unknown>
	): CollectionRecord {
		const record = this.require(id, 'collection');

		if (
			patch.name !== undefined &&
			this.takenCollectionNames(recordKey('collection', id)).has(patch.name)
		) {
			throw new CollectionNameTakenError(undefined);
		}

		return this.stage({
			...record.local,
			...patch
		} as LibRecord) as CollectionRecord;
	}

	/**
	 * Refused while any story binds it. `cascade` tombstones its assets and characters
	 * first; without it, a non-empty collection is refused like the server would.
	 */
	deleteCollection(id: string, options: {cascade?: boolean} = {}): void {
		const record = this.require(id, 'collection');
		const bound = this.list('binding').filter(binding =>
			[binding.own, ...(binding.collections ?? [])].includes(id)
		);

		if (bound.length) {
			throw new CollectionNotEmptyError(bound.length);
		}

		const children = [...this.assets(id), ...this.characters(id)];

		if (children.length && !options.cascade) {
			throw new CollectionNotEmptyError(children.length);
		}

		for (const child of children) {
			this.stage({...child, deleted: true});
		}

		this.stage({...record.local, deleted: true});
	}

	// ---- assets -------------------------------------------------------------

	async findDuplicates(
		bytes: Uint8Array,
		mime: string
	): Promise<DuplicateReport> {
		const hashes = await hashContent(bytes, mime, this.decoder);

		return this.duplicatesOf(hashes);
	}

	private duplicatesOf(hashes: {
		sha: string;
		pixelHash?: string;
		phash?: string;
	}): DuplicateReport {
		const report: DuplicateReport = {
			sha: hashes.sha,
			exact: [],
			pixel: [],
			similar: []
		};

		for (const asset of this.assets()) {
			if (asset.blob === hashes.sha) {
				report.exact.push(asset);
			} else if (hashes.pixelHash && asset.pixelHash === hashes.pixelHash) {
				report.pixel.push(asset);
			} else if (
				hashes.phash &&
				asset.phash &&
				asset.phash.length === hashes.phash.length
			) {
				const distance = hamming(asset.phash, hashes.phash);

				if (distance <= SIMILAR_DISTANCE) {
					report.similar.push({asset, distance});
				}
			}
		}

		report.similar.sort((a, b) => a.distance - b.distance);

		return report;
	}

	private async storeSidecars(
		sidecars: Record<string, SidecarInput | null> | undefined
	): Promise<Record<string, string | null>> {
		const out: Record<string, string | null> = {};

		for (const [kind, input] of Object.entries(sidecars ?? {})) {
			if (!input) {
				out[kind] = null;
				continue;
			}

			const sha = await sha256Hex(input.bytes);

			await this.blobs.put(sha, input.bytes, input.mime);
			out[kind] = sha;
		}

		return out;
	}

	/**
	 * Hashes, reports duplicates (exact, pixel, similar), and creates the asset unless an
	 * exact or pixel duplicate exists and `allowDuplicate` is not set. A name already
	 * taken in the collection gets `-2`, `-3` (reported as `renamed-on-clash`).
	 */
	async addAsset(
		bytes: Uint8Array,
		mime: string,
		options: AddAssetOptions
	): Promise<AddAssetResult> {
		const {allowDuplicate, sidecars, id, ...fields} = options;
		const hashes = await hashContent(bytes, mime, this.decoder);
		const duplicates = this.duplicatesOf(hashes);

		if (
			!allowDuplicate &&
			(duplicates.exact.length || duplicates.pixel.length)
		) {
			return {duplicates};
		}

		this.assertLiveCollection(fields.collection);
		await this.blobs.put(hashes.sha, bytes, mime);

		const sidecarShas = await this.storeSidecars(sidecars);
		const name = uniqueName(fields.name, this.takenNames(fields.collection));
		const draft = this.draft(
			'asset',
			{
				kind: 'object',
				tags: [],
				...fields,
				name,
				blob: hashes.sha,
				mime,
				bytes: bytes.length,
				...(hashes.w !== undefined ? {w: hashes.w, h: hashes.h} : {}),
				...(hashes.pixelHash ? {pixelHash: hashes.pixelHash} : {}),
				...(hashes.phash ? {phash: hashes.phash} : {}),
				...(Object.keys(sidecarShas).length ? {sidecars: sidecarShas} : {})
			},
			id
		);

		const asset = this.stage(draft) as AssetRecord;

		if (name !== fields.name) {
			this.notice({
				kind: 'renamed-on-clash',
				type: 'asset',
				id: asset.id,
				from: fields.name,
				to: name,
				holder: this.holderOf(
					fields.collection,
					fields.name,
					recordKey('asset', asset.id)
				)
			});
		}

		return {asset, duplicates};
	}

	/**
	 * Metadata edit. `recipe` merges per key. Touching `blob`, `sidecars` or `recipe` on a
	 * locked collection's asset throws `LockedError` unless `override`.
	 */
	updateAsset(
		id: string,
		patch: AssetPatch,
		options: {override?: boolean} = {}
	): AssetRecord {
		const current = this.require(id, 'asset').local as AssetRecord;

		if ('blob' in patch || 'sidecars' in patch || 'recipe' in patch) {
			this.assertUnlocked(current, options.override);
		}

		const next = {...current, ...patch} as AssetRecord;

		if (patch.recipe) {
			const recipe: Record<string, unknown> = {...(current.recipe ?? {})};

			for (const [key, value] of Object.entries(patch.recipe)) {
				setPath(recipe, key, value);
			}

			next.recipe = recipe as AssetRecipe;
		}

		if (next.collection !== current.collection) {
			this.assertLiveCollection(next.collection);
		}

		if (next.name !== current.name || next.collection !== current.collection) {
			this.assertNameFree(next.collection, next.name, recordKey('asset', id));
		}

		return this.stage(next) as AssetRecord;
	}

	/** Repaint: new bytes, new sha. The asset id never changes. */
	async replaceBlob(
		id: string,
		bytes: Uint8Array,
		mime: string,
		options: ReplaceBlobOptions = {}
	): Promise<AssetRecord> {
		const current = this.require(id, 'asset').local as AssetRecord;

		this.assertUnlocked(current, options.override);

		const hashes = await hashContent(bytes, mime, this.decoder);

		await this.blobs.put(hashes.sha, bytes, mime);

		const sidecarShas = await this.storeSidecars(options.sidecars);
		// Re-read: the hashing above yielded, and a pull may have landed meanwhile.
		const latest = this.require(id, 'asset').local as AssetRecord;
		const next: AssetRecord = {
			...latest,
			blob: hashes.sha,
			mime,
			bytes: bytes.length
		};

		for (const field of ['w', 'h', 'pixelHash', 'phash'] as const) {
			if (hashes[field] !== undefined) {
				(next as Record<string, unknown>)[field] = hashes[field];
			} else {
				delete next[field];
			}
		}

		if (options.sidecars) {
			const sidecars: Record<string, string> = {...(latest.sidecars ?? {})};

			for (const [kind, sha] of Object.entries(sidecarShas)) {
				if (sha) {
					sidecars[kind] = sha;
				} else {
					delete sidecars[kind];
				}
			}

			next.sidecars = sidecars;
		}

		if (options.recipe) {
			const recipe: Record<string, unknown> = {...(latest.recipe ?? {})};

			for (const [key, value] of Object.entries(options.recipe)) {
				setPath(recipe, key, value);
			}

			next.recipe = recipe as AssetRecipe;
		}

		return this.stage(next) as AssetRecord;
	}

	/** Asset name or character charId. Throws NameTakenError on a known clash. */
	rename(id: string, name: string): LibRecord {
		const record = this.stored(id);

		if (!record || (record.type !== 'asset' && record.type !== 'character')) {
			throw new Error(
				`Only assets and characters have names in a collection: ${id}`
			);
		}

		const local = record.local as AssetRecord | CharacterRecord;

		this.assertNameFree(local.collection, name, recordKey(record.type, id));

		return this.stage({...local, [nameField(record.type)]: name} as LibRecord);
	}

	/** Changes the home collection. Throws NameTakenError on a clash in the target. */
	move(id: string, collection: string): LibRecord {
		const record = this.stored(id);

		if (!record || (record.type !== 'asset' && record.type !== 'character')) {
			throw new Error(`Only assets and characters live in a collection: ${id}`);
		}

		const local = record.local as AssetRecord | CharacterRecord;

		this.assertLiveCollection(collection);
		this.assertNameFree(
			collection,
			namespaceName(local)!,
			recordKey(record.type, id)
		);

		return this.stage({...local, collection} as LibRecord);
	}

	/** New asset on the same blob (zero bytes uploaded), `sourceAsset` set. */
	copy(
		id: string,
		options: {collection?: string; name?: string} = {}
	): AssetRecord {
		const source = this.require(id, 'asset').local as AssetRecord;
		const collection = options.collection ?? source.collection;

		this.assertLiveCollection(collection);

		const name =
			options.name ?? uniqueName(source.name, this.takenNames(collection));

		this.assertNameFree(collection, name);

		// draft() replaces the envelope: new id, rev 0.
		return this.stage(
			this.draft('asset', {...clone(source), collection, name, sourceAsset: id})
		) as AssetRecord;
	}

	delete(id: string, type?: RecordType): void {
		const record = this.stored(id, type);

		if (!record) {
			throw new Error(`No record ${id} in the library.`);
		}

		if (record.type === 'collection') {
			this.deleteCollection(id);
			return;
		}

		this.stage({...record.local, deleted: true});
	}

	/** Undoes a delete: a PUT of the tombstone rev with `deleted: false`. */
	restore(id: string, type?: RecordType): LibRecord {
		const record = this.stored(id, type);

		if (!record) {
			throw new Error(`No record ${id} in the library.`);
		}

		const local = record.local;

		if (local.type === 'asset' || local.type === 'character') {
			this.assertLiveCollection(local.collection);
			this.assertNameFree(
				local.collection,
				namespaceName(local)!,
				recordKey(local.type, id)
			);
		}

		return this.stage({...local, deleted: false});
	}

	/**
	 * Copies the asset into the story's own collection under the same name, so it shadows
	 * the shared one for that story only. Scene YAML does not change. Allowed on locked
	 * collections: forking is the way to edit curated art.
	 */
	fork(assetId: string, storyId: string): AssetRecord {
		const binding = this.binding(storyId);

		if (!binding) {
			throw new Error(`Story ${storyId} has no library binding.`);
		}

		const source = this.require(assetId, 'asset').local as AssetRecord;
		const existing = this.assets(binding.own).find(
			asset => asset.name === source.name
		);

		if (existing) {
			if (existing.sourceAsset === assetId) {
				return existing;
			}

			throw new NameTakenError(
				{type: 'asset', id: existing.id},
				`"${source.name}" already exists in the story's own collection.`
			);
		}

		return this.copy(assetId, {collection: binding.own, name: source.name});
	}

	/** Deletes a fork; the shared original shows through again. */
	unfork(forkId: string): void {
		const fork = this.require(forkId, 'asset').local as AssetRecord;

		if (!fork.sourceAsset) {
			throw new Error(`Asset ${forkId} is not a fork.`);
		}

		this.stage({...fork, deleted: true});
	}

	// ---- characters ---------------------------------------------------------

	putCharacter(input: CharacterInput): CharacterRecord {
		const {id, ...fields} = input;
		const existing =
			id !== undefined ? this.stored(id, 'character') : undefined;

		this.assertLiveCollection(fields.collection);
		this.assertNameFree(
			fields.collection,
			fields.charId,
			existing ? recordKey('character', existing.id) : undefined
		);

		if (existing) {
			return this.stage({
				...existing.local,
				...fields
			} as LibRecord) as CharacterRecord;
		}

		return this.stage(
			this.draft('character', {tags: [], poses: {}, ...fields}, id)
		) as CharacterRecord;
	}

	// ---- stories ------------------------------------------------------------

	/** The story's own collection (`kind: story`) and its binding. */
	createStory(storyId: string, options: {name: string}): BindingRecord {
		const existing = this.binding(storyId);

		if (existing) {
			return existing;
		}

		const own = this.stage(
			this.draft('collection', {
				name: uniqueName(options.name, this.takenCollectionNames()),
				kind: 'story'
			})
		);

		return this.stage(
			this.draft('binding', {own: own.id, collections: [], refs: []}, storyId)
		) as BindingRecord;
	}

	/** Attached collections, in resolution order. The own collection stays implicit. */
	bind(storyId: string, collections: string[]): BindingRecord {
		const binding = this.require(storyId, 'binding').local as BindingRecord;
		const ordered = Array.from(new Set(collections)).filter(
			id => id !== binding.own
		);

		for (const id of ordered) {
			this.assertLiveCollection(id);
		}

		const next = this.stage({
			...binding,
			collections: ordered
		}) as BindingRecord;

		if (this.openStories.has(storyId)) {
			this.track(this.prefetch(storyId)).catch(() => undefined);
		}

		return next;
	}

	/** Asset ids the story's scenes use. Sorted, so re-deriving them is not an edit. */
	setRefs(storyId: string, assetIds: string[]): BindingRecord {
		const binding = this.require(storyId, 'binding').local as BindingRecord;
		const refs = Array.from(new Set(assetIds)).sort();

		if (deepEqual(binding.refs ?? [], refs)) {
			return clone(binding);
		}

		return this.stage({...binding, refs}) as BindingRecord;
	}

	// =========================================================================
	// Conflicts
	// =========================================================================

	/**
	 * - `mine`: my value on every conflicting field; non-conflicting ones stay merged.
	 * - `theirs`: their value on every conflicting field. Delete vs edit: theirs, whole.
	 * - `keep-both`: this record becomes theirs; mine is saved as a new record `name-2`.
	 * - `{picks}`: per conflicting field.
	 */
	resolve(id: string, choice: ConflictChoice, type?: RecordType): void {
		const record = this.stored(id, type);

		if (!record?.conflict) {
			throw new Error(`Record ${id} has no conflict to resolve.`);
		}

		const key = recordKey(record.type, record.id);
		const conflict = record.conflict;
		const current = conflict.current;

		if (conflict.kind !== 'fields' || !current) {
			this.resolveStuck(key, record, choice);
			return;
		}

		const {merged, conflicts} = merge3(record.base, record.local, current);
		const mine = record.local as Record<string, unknown>;
		let result = clone(merged) as Record<string, unknown>;
		let keep: LibRecord | undefined;

		if (choice === 'mine') {
			for (const field of conflicts) {
				setPath(result, field, clone(getPath(mine, field)));
			}
		} else if (choice === 'theirs') {
			if (conflicts.includes('deleted')) {
				result = clone(current) as Record<string, unknown>;
			}
		} else if (choice === 'keep-both') {
			if (record.type !== 'asset' && record.type !== 'character') {
				throw new Error('Keep both applies to assets and characters only.');
			}

			if (conflicts.includes('deleted')) {
				result = clone(current) as Record<string, unknown>;
			}

			keep = clone(record.local);
		} else {
			for (const field of conflicts) {
				if (choice.picks[field] === 'mine') {
					setPath(result, field, clone(getPath(mine, field)));
				}
			}
		}

		const next: StoredRecord = {
			...record,
			base: clone(current),
			local: result as LibRecord,
			conflict: undefined
		};

		next.dirty = !sameContent(next.base, next.local);

		if (!next.dirty) {
			next.local = clone(current);
		}

		this.records.set(key, next);

		if (next.dirty) {
			this.enqueue(key);
		}

		this.persist(key);
		this.emitChange([record.local, next.local], 'local');

		if (keep) {
			const local = keep as AssetRecord | CharacterRecord;
			const field = nameField(local.type);
			const collection = local.collection;
			const name = uniqueName(
				namespaceName(local)!,
				this.takenNames(collection)
			);
			this.stage(this.draft(local.type, {...local, [field]: name}));
		}

		this.emitStatus();
		this.scheduleFlush();
	}

	/** collection-missing / rejected / blob-lost: `theirs` drops my version, else retry. */
	private resolveStuck(
		key: string,
		record: StoredRecord,
		choice: ConflictChoice
	) {
		const current = record.conflict?.current ?? record.base;
		const next: StoredRecord = {...record, conflict: undefined};

		if (choice === 'theirs') {
			if (!current) {
				this.records.delete(key);
				this.dequeue(key);
				this.persist(key);
				this.emitChange([record.local], 'local');
				this.emitStatus();
				return;
			}

			next.base = clone(current);
			next.local = clone(current);
			next.dirty = false;
			this.records.set(key, next);
			this.dequeue(key);
		} else {
			next.dirty = true;
			this.records.set(key, next);
			this.enqueue(key);
			this.scheduleFlush();
		}

		this.persist(key);
		this.emitChange([record.local, next.local], 'local');
		this.emitStatus();
	}

	/** Puts a record into conflict: out of the outbox until a person decides. */
	private markConflict(key: string, conflict: RecordConflict) {
		const record = this.records.get(key);

		if (!record) {
			return;
		}

		this.records.set(key, {...record, conflict});
		this.dequeue(key);
		this.persist(key);
		this.emitStatus();

		const {type, id} = record;

		switch (conflict.kind) {
			case 'fields':
				this.notice({kind: 'conflict', type, id, fields: conflict.fields});
				break;
			case 'collection-missing':
				this.notice({kind: 'collection-missing', type, id});
				break;
			case 'rejected':
				this.notice({
					kind: 'rejected',
					type,
					id,
					detail: conflict.detail ?? ''
				});
				break;
			case 'blob-lost':
				this.notice({kind: 'blob-lost', type, id, missing: conflict.fields});
				break;
		}
	}

	/**
	 * Remote copy vs dirty local copy: 3-way merge. Used on 412 and on pull. Never
	 * enqueues: a dirty record is in the outbox already, and a merge either keeps it there
	 * (auto-merged), takes it out (merged == remote), or parks it (conflict).
	 */
	private mergeRemote(key: string, remote: LibRecord) {
		const record = this.records.get(key)!;
		const {merged, conflicts} = merge3(record.base, record.local, remote);

		if (conflicts.length) {
			this.markConflict(key, {
				kind: 'fields',
				current: clone(remote),
				fields: conflicts
			});
			return;
		}

		const next: StoredRecord = {...record, base: clone(remote)};

		if (sameContent(merged, remote)) {
			next.local = clone(remote);
			next.dirty = false;
			this.records.set(key, next);
			this.dequeue(key);
		} else {
			next.local = merged;
			next.dirty = true;
			this.records.set(key, next);
		}

		this.persist(key);
	}

	// =========================================================================
	// Sync
	// =========================================================================

	/** Serialises pulls and pushes: a pull never lands in the middle of a push. */
	private exclusive(task: () => Promise<void>): Promise<void> {
		const run = this.syncChain.then(async () => {
			if (this.disposed || !this.started) {
				return;
			}

			try {
				await task();
			} catch (error) {
				if (isTransient(error)) {
					this.setOffline(true);
					return;
				}

				throw error;
			}
		});

		this.syncChain = run.catch(() => undefined);

		return this.track(run);
	}

	/** App start, reconnect, or a test's settle pass: pull if behind, then push. */
	sync(): Promise<void> {
		return this.exclusive(async () => {
			if (this.needsPull || this.knownHead > this.cursor) {
				await this.doPull();
			}

			await this.doDrain();
			await this.prefetchOpen();
		});
	}

	/** Push the outbox now, skipping the debounce. */
	flush(): Promise<void> {
		this.cancelTimer();

		return this.exclusive(() => this.doDrain());
	}

	/** Read `/changes` from the cursor regardless of socket news. The 30 s poll. */
	poll(): Promise<void> {
		return this.exclusive(async () => {
			await this.doPull();
			await this.prefetchOpen();
		});
	}

	pull(): Promise<void> {
		return this.poll();
	}

	/** Socket said the feed moved. Advisory: only the seq is used, and only if new. */
	notify(seq: number): Promise<void> {
		this.knownHead = Math.max(this.knownHead, seq);

		if (seq <= this.cursor) {
			return Promise.resolve();
		}

		return this.exclusive(async () => {
			if (this.knownHead > this.cursor) {
				await this.doPull();
				await this.prefetchOpen();
			}
		});
	}

	/** Network is back: catch up, then push. */
	reconnect(): Promise<void> {
		this.needsPull = true;
		this.setOffline(false);

		return this.sync();
	}

	private async doPull(): Promise<void> {
		let since = this.cursor;

		for (;;) {
			const page = await this.transport.changes(since);

			this.setOffline(false);

			const touched: (LibRecord | undefined)[] = [];

			for (const item of page.items) {
				touched.push(...this.applyRemote(item.record));
			}

			since = Math.max(since, page.seq);

			if (since > this.cursor) {
				this.cursor = since;
				this.persistCursor();
			}

			this.emitChange(touched, 'remote');

			if (!page.more || !page.items.length) {
				break;
			}
		}

		this.knownHead = Math.max(this.knownHead, this.cursor);
		this.needsPull = false;
		this.emitStatus();
	}

	/** Returns [before, after] local copies when the local view changed. */
	private applyRemote(remote: LibRecord): (LibRecord | undefined)[] {
		const key = recordKey(remote.type, remote.id);
		const record = this.records.get(key);

		if (!record) {
			this.records.set(key, {
				id: remote.id,
				type: remote.type,
				base: clone(remote),
				local: clone(remote),
				dirty: false
			});
			this.persist(key);
			return [remote];
		}

		const before = record.local;

		if (record.conflict) {
			const current = record.conflict.current;

			if (!current || remote.rev > current.rev) {
				this.records.set(key, {
					...record,
					conflict: {...record.conflict, current: clone(remote)}
				});
				this.persist(key);
			}

			return [];
		}

		if (record.base && remote.rev <= record.base.rev) {
			return [];
		}

		if (!record.dirty) {
			this.records.set(key, {
				...record,
				base: clone(remote),
				local: clone(remote)
			});
			this.persist(key);
		} else {
			this.mergeRemote(key, remote);
		}

		const after = this.records.get(key)?.local;

		return sameContent(before, after) ? [] : [before, after];
	}

	/** A record can go when its collection exists on the server and, for a collection
	 * delete, once its children's tombstones have gone first. */
	private eligible(key: string): boolean {
		const record = this.records.get(key);

		if (!record || !record.dirty || record.conflict) {
			return false;
		}

		const local = record.local;
		const needs =
			local.type === 'asset' || local.type === 'character'
				? [local.collection]
				: local.type === 'binding'
				? [local.own]
				: [];

		for (const collection of needs) {
			const collectionKey = recordKey('collection', collection);
			const pending = this.records.get(collectionKey);

			if (pending && !pending.base && this.outbox.includes(collectionKey)) {
				return false;
			}
		}

		if (local.type === 'collection' && local.deleted) {
			for (const other of this.outbox) {
				const child = this.records.get(other)?.local;

				if (
					child &&
					(child.type === 'asset' || child.type === 'character') &&
					child.collection === local.id
				) {
					return false;
				}
			}
		}

		return true;
	}

	private async doDrain(): Promise<void> {
		const attempts = new Map<string, number>();

		// Drop keys that no longer need pushing (conflicted, cleaned by a merge).
		const stale = this.outbox.filter(key => {
			const record = this.records.get(key);
			return !record || !record.dirty || !!record.conflict;
		});

		stale.forEach(key => this.dequeue(key));

		for (;;) {
			if (this.disposed) {
				return;
			}

			const batch: string[] = [];

			for (const key of this.outbox) {
				if (batch.length >= this.concurrency) {
					break;
				}

				if (
					(attempts.get(key) ?? 0) < MAX_ATTEMPTS_PER_DRAIN &&
					this.eligible(key)
				) {
					batch.push(key);
				}
			}

			if (!batch.length) {
				break;
			}

			for (const key of batch) {
				attempts.set(key, (attempts.get(key) ?? 0) + 1);
			}

			const results = await Promise.allSettled(
				batch.map(key => this.push(key))
			);
			const failed = results.find(
				(result): result is PromiseRejectedResult =>
					result.status === 'rejected'
			);

			if (failed) {
				throw failed.reason;
			}
		}

		this.emitStatus();
	}

	private async uploadBlobs(shas: string[], force = false): Promise<void> {
		if (!shas.length) {
			return;
		}

		const missing = force ? shas : await this.transport.hasBlobs(shas);
		const lost: string[] = [];

		for (const sha of missing) {
			const blob = await this.blobs.get(sha);

			if (!blob) {
				lost.push(sha);
				continue;
			}

			await this.transport.putBlob(sha, blob.bytes, blob.mime);
		}

		if (lost.length) {
			throw new BlobLostError(lost);
		}
	}

	/** One record: blobs, then the record, then whatever the answer says. */
	private async push(key: string): Promise<void> {
		const record = this.records.get(key);

		if (!record) {
			return;
		}

		const base = record.base;
		let body = clone(record.local);

		if (!base && body.deleted) {
			this.records.delete(key);
			this.dequeue(key);
			this.persist(key);
			return;
		}

		// A plain DELETE names nothing new. Every PUT — a tombstone too, which the server
		// does not check — gets its blobs first, or a later restore names bytes nobody has.
		const plainDelete =
			!!base && body.deleted && !base.deleted && onlyDeletedDiffers(base, body);

		try {
			if (!plainDelete) {
				await this.uploadBlobs(recordBlobs(body));
			}
		} catch (error) {
			if (error instanceof BlobLostError) {
				this.markConflict(key, {
					kind: 'blob-lost',
					current: base ?? null,
					fields: error.missing
				});
				return;
			}

			throw error;
		}

		const field = body.type === 'character' ? 'charId' : 'name';
		const original = String((body as Record<string, unknown>)[field] ?? '');
		let clashes = 0;
		let blobRetried = false;
		let holder: Holder | undefined;

		for (;;) {
			let result: WriteResult;

			try {
				if (!base) {
					result = await this.transport.putRecord(body, {create: true});
				} else if (plainDelete) {
					result = await this.transport.deleteRecord(
						body.type,
						body.id,
						base.rev
					);
				} else {
					result = await this.transport.putRecord(body, {rev: base.rev});
				}
			} catch (error) {
				if (error instanceof StaleError) {
					this.onStale(key, error.current);
					return;
				}

				if (
					error instanceof NameTakenError ||
					error instanceof CollectionNameTakenError
				) {
					if (++clashes > MAX_NAME_CLASHES || body.type === 'binding') {
						this.markConflict(key, {
							kind: 'rejected',
							current: base ?? null,
							fields: [field],
							detail: error.message
						});
						return;
					}

					holder = error.holder;
					body = this.renameOnClash(key, body, field, original, clashes);
					continue;
				}

				if (error instanceof BlobMissingError && !blobRetried) {
					blobRetried = true;

					try {
						await this.uploadBlobs(error.missing, true);
					} catch (uploadError) {
						if (uploadError instanceof BlobLostError) {
							this.markConflict(key, {
								kind: 'blob-lost',
								current: base ?? null,
								fields: uploadError.missing
							});
							return;
						}

						throw uploadError;
					}

					continue;
				}

				if (error instanceof CollectionNotEmptyError && body.deleted) {
					this.refuseDelete(key, error.count);
					return;
				}

				if (error instanceof CollectionMissingError) {
					this.markConflict(key, {
						kind: 'collection-missing',
						current: base ?? null,
						fields: ['collection']
					});
					return;
				}

				if (
					error instanceof BadRecordError ||
					error instanceof BlobMissingError
				) {
					this.markConflict(key, {
						kind: 'rejected',
						current: base ?? null,
						fields: [],
						detail: error.message
					});
					return;
				}

				throw error;
			}

			this.acknowledge(key, body, result);

			if (clashes) {
				this.notice({
					kind: 'renamed-on-clash',
					type: body.type,
					id: body.id,
					from: original,
					to: String((body as Record<string, unknown>)[field]),
					holder
				});
			}

			return;
		}
	}

	private renameOnClash(
		key: string,
		body: LibRecord,
		field: 'name' | 'charId',
		original: string,
		clashes: number
	): LibRecord {
		const from = String((body as Record<string, unknown>)[field]);
		const taken =
			body.type === 'collection'
				? this.takenCollectionNames(key)
				: this.takenNames((body as AssetRecord).collection, key);

		// Names this device already knows are skipped; the ones it does not, the server
		// refuses again and the loop moves on.
		const to = uniqueName(original, new Set([...taken, from]), clashes + 1);
		const next = {...body, [field]: to} as LibRecord;
		const record = this.records.get(key);

		if (record && (record.local as Record<string, unknown>)[field] === from) {
			this.records.set(key, {
				...record,
				local: {...record.local, [field]: to} as LibRecord
			});
			this.persist(key);
			this.emitChange([record.local, next], 'local');
		}

		return next;
	}

	private acknowledge(key: string, body: LibRecord, result: WriteResult) {
		const record = this.records.get(key);

		if (record) {
			const next: StoredRecord = {...record, base: clone(result.record)};

			if (sameContent(record.local, body)) {
				next.local = clone(result.record);
				next.dirty = false;
				this.records.set(key, next);
				this.dequeue(key);
			} else {
				// Edited while the push was in flight: still dirty, now against the new rev.
				next.dirty = true;
				this.records.set(key, next);
			}

			this.persist(key);
		}

		if (result.seq === this.cursor + 1) {
			// Our own write, next in line: nothing to read back.
			this.cursor = result.seq;
			this.knownHead = Math.max(this.knownHead, this.cursor);
			this.persistCursor();
		} else if (result.seq > this.cursor) {
			this.needsPull = true;
		}

		this.setOffline(false);
		this.emitStatus();
	}

	private onStale(key: string, current: LibRecord | null) {
		const record = this.records.get(key);

		if (!record) {
			return;
		}

		if (!current) {
			// The server has no such record: push it again as a create.
			if (record.local.deleted) {
				this.records.delete(key);
				this.dequeue(key);
			} else {
				this.records.set(key, {...record, base: undefined, dirty: true});
			}

			this.persist(key);
			return;
		}

		const before = record.local;

		this.mergeRemote(key, current);
		this.emitChange([before, this.records.get(key)?.local], 'remote');
	}

	/** The server refused a collection delete: undo it locally and say why. */
	private refuseDelete(key: string, count: number) {
		const record = this.records.get(key);

		if (!record?.base) {
			return;
		}

		this.records.set(key, {
			...record,
			local: clone(record.base),
			dirty: false,
			conflict: undefined
		});
		this.dequeue(key);
		this.persist(key);
		this.emitChange([record.local, record.base], 'local');
		this.notice({
			kind: 'delete-refused',
			type: record.type,
			id: record.id,
			count
		});
	}

	// =========================================================================
	// Blobs
	// =========================================================================

	/** Bytes by sha: cache first, else fetched once, verified, and cached. */
	async blobBytes(sha: string): Promise<CachedBlob> {
		const cached = await this.blobs.get(sha);

		if (cached) {
			return cached;
		}

		let fetching = this.blobFetches.get(sha);

		if (!fetching) {
			fetching = (async () => {
				const {bytes, mime} = await this.transport.getBlob(sha);
				const got = await sha256Hex(bytes);

				if (got !== sha) {
					throw new Error(`Blob ${sha} arrived as ${got}.`);
				}

				await this.blobs.put(sha, bytes, mime);
				return {bytes, mime};
			})().finally(() => this.blobFetches.delete(sha));

			this.blobFetches.set(sha, fetching);
		}

		return this.track(fetching);
	}

	/** Object URL for a blob. One per sha per engine; revoked on dispose. */
	async blobUrl(sha: string): Promise<string> {
		const existing = this.objectUrls.get(sha);

		if (existing) {
			return existing;
		}

		const {bytes, mime} = await this.blobBytes(sha);
		const url = URL.createObjectURL(
			new Blob([new Uint8Array(bytes)], {type: mime})
		);

		this.objectUrls.set(sha, url);

		return url;
	}

	/** Marks a story open: its own and bound collections' blobs are kept local. */
	openStory(storyId: string): Promise<void> {
		this.openStories.add(storyId);

		return this.track(this.prefetch(storyId)).catch(error => {
			if (!isTransient(error)) {
				throw error;
			}
		});
	}

	closeStory(storyId: string): void {
		this.openStories.delete(storyId);
	}

	/** Fetches every missing blob (not sidecars) of the story's collections. */
	async prefetch(storyId: string): Promise<void> {
		const binding = this.binding(storyId);

		if (!binding) {
			return;
		}

		const collections = new Set([binding.own, ...(binding.collections ?? [])]);

		for (const asset of this.assets()) {
			if (
				collections.has(asset.collection) &&
				!(await this.blobs.has(asset.blob))
			) {
				await this.blobBytes(asset.blob);
			}
		}
	}

	private async prefetchOpen(): Promise<void> {
		for (const storyId of this.openStories) {
			await this.prefetch(storyId);
		}
	}
}
