import {clone} from './merge';
import {LibRecord, RecordType} from './types';

/**
 * Why a record is stuck until a person decides.
 *
 * - `fields`: both sides changed the same field(s) differently, or delete vs edit.
 * - `collection-missing`: its collection was deleted under it.
 * - `rejected`: the server refused the record's shape (`bad-record`).
 * - `blob-lost`: the server wants a blob this device no longer has.
 */
export type ConflictKind =
	| 'fields'
	| 'collection-missing'
	| 'rejected'
	| 'blob-lost';

export interface RecordConflict {
	kind: ConflictKind;
	/** The server's copy at the time, updated by later pulls. */
	current: LibRecord | null;
	/** Conflicting field paths (`blob`, `recipe.mask`, `deleted`). */
	fields: string[];
	detail?: string;
}

/**
 * One record as this device knows it (plan 2, "Local stores").
 *
 * `base` is the last copy both sides agreed on, rev included. It is persisted, so a
 * reload can still 3-way merge instead of letting the server win.
 */
export interface StoredRecord {
	id: string;
	type: RecordType;
	/** Absent on a record this device created and has not pushed yet. */
	base?: LibRecord;
	/** What the user sees and edits. */
	local: LibRecord;
	dirty: boolean;
	conflict?: RecordConflict;
}

export interface LocalSnapshot {
	records: StoredRecord[];
	/** Ordered record keys (`type/id`) with unpushed changes. */
	outbox: string[];
	/** Last applied change-feed seq. */
	cursor: number;
}

/**
 * The persisted client state. The engine keeps a copy in memory and writes through, in
 * order; nothing here is read back except on start.
 */
export interface LocalDb {
	load(): Promise<LocalSnapshot>;
	putRecord(record: StoredRecord): Promise<void>;
	deleteRecord(type: RecordType, id: string): Promise<void>;
	setOutbox(keys: string[]): Promise<void>;
	setCursor(seq: number): Promise<void>;
	getKv<T = unknown>(key: string): Promise<T | undefined>;
	setKv(key: string, value: unknown): Promise<void>;
}

function storedKey(type: RecordType, id: string): string {
	return `${type}/${id}`;
}

/**
 * In-memory LocalDb. Survives an engine rebuild (the tests' `reload()`), not a process.
 * Everything is cloned in and out so an engine can never share an object with its "disk".
 */
export class MemoryLocalDb implements LocalDb {
	private records = new Map<string, StoredRecord>();
	private outbox: string[] = [];
	private cursor = 0;
	private kv = new Map<string, unknown>();

	async load(): Promise<LocalSnapshot> {
		return {
			records: Array.from(this.records.values(), clone),
			outbox: [...this.outbox],
			cursor: this.cursor
		};
	}

	async putRecord(record: StoredRecord): Promise<void> {
		this.records.set(storedKey(record.type, record.id), clone(record));
	}

	async deleteRecord(type: RecordType, id: string): Promise<void> {
		this.records.delete(storedKey(type, id));
	}

	async setOutbox(keys: string[]): Promise<void> {
		this.outbox = [...keys];
	}

	async setCursor(seq: number): Promise<void> {
		this.cursor = seq;
	}

	async getKv<T = unknown>(key: string): Promise<T | undefined> {
		return clone(this.kv.get(key)) as T | undefined;
	}

	async setKv(key: string, value: unknown): Promise<void> {
		this.kv.set(key, clone(value));
	}
}

const DATABASE_NAME = 'sliders-library';
const DATABASE_VERSION = 1;
const RECORD_STORE = 'records';
const META_STORE = 'meta';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * IndexedDB LocalDb. One database for the whole library, every story: records keyed
 * `type/id`, and outbox, cursor and kv entries in a small meta store.
 */
export class IndexedDbLocalDb implements LocalDb {
	private database?: Promise<IDBDatabase>;

	constructor(private name = DATABASE_NAME) {}

	static available(): boolean {
		return typeof indexedDB !== 'undefined';
	}

	private open(): Promise<IDBDatabase> {
		if (!this.database) {
			this.database = new Promise((resolve, reject) => {
				const request = indexedDB.open(this.name, DATABASE_VERSION);

				request.onupgradeneeded = () => {
					const database = request.result;

					if (!database.objectStoreNames.contains(RECORD_STORE)) {
						database.createObjectStore(RECORD_STORE);
					}

					if (!database.objectStoreNames.contains(META_STORE)) {
						database.createObjectStore(META_STORE);
					}
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		}

		return this.database;
	}

	private async transact<T>(
		storeName: string,
		mode: IDBTransactionMode,
		body: (store: IDBObjectStore) => IDBRequest<T>
	): Promise<T> {
		const database = await this.open();
		const transaction = database.transaction(storeName, mode);
		const result = await promisify(body(transaction.objectStore(storeName)));

		if (mode === 'readwrite') {
			await new Promise<void>((resolve, reject) => {
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
		}

		return result;
	}

	async load(): Promise<LocalSnapshot> {
		const records = await this.transact<StoredRecord[]>(
			RECORD_STORE,
			'readonly',
			store => store.getAll()
		);
		const outbox = await this.transact<string[] | undefined>(
			META_STORE,
			'readonly',
			store => store.get('outbox')
		);
		const cursor = await this.transact<number | undefined>(
			META_STORE,
			'readonly',
			store => store.get('cursor')
		);

		return {records, outbox: outbox ?? [], cursor: cursor ?? 0};
	}

	async putRecord(record: StoredRecord): Promise<void> {
		await this.transact(RECORD_STORE, 'readwrite', store =>
			store.put(clone(record), storedKey(record.type, record.id))
		);
	}

	async deleteRecord(type: RecordType, id: string): Promise<void> {
		await this.transact(RECORD_STORE, 'readwrite', store =>
			store.delete(storedKey(type, id))
		);
	}

	async setOutbox(keys: string[]): Promise<void> {
		await this.transact(META_STORE, 'readwrite', store =>
			store.put([...keys], 'outbox')
		);
	}

	async setCursor(seq: number): Promise<void> {
		await this.transact(META_STORE, 'readwrite', store =>
			store.put(seq, 'cursor')
		);
	}

	async getKv<T = unknown>(key: string): Promise<T | undefined> {
		return this.transact<T | undefined>(META_STORE, 'readonly', store =>
			store.get(`kv:${key}`)
		);
	}

	async setKv(key: string, value: unknown): Promise<void> {
		await this.transact(META_STORE, 'readwrite', store =>
			store.put(clone(value), `kv:${key}`)
		);
	}
}
