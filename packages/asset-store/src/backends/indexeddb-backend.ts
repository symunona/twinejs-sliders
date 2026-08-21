import type {AssetId} from '@sliders/scene-types';
import {
	AssetManifest,
	emptyManifest,
	StorageBackend
} from '../asset-store.types';

const DATABASE_NAME = 'sliders-assets';
const DATABASE_VERSION = 1;
const BLOB_STORE = 'blobs';
const MANIFEST_STORE = 'manifest';
const MANIFEST_KEY = 'manifest';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/**
 * Fallback web backend, used when OPFS isn't available.
 *
 * Scopes share one database and are kept apart by key: `manifest:<scope>` and
 * `<scope>/<asset id>`. The empty scope keeps the unprefixed keys the shared library used
 * before scoping, so its art is still readable and can be imported forward.
 */
export class IndexedDbBackend implements StorageBackend {
	readonly kind = 'indexeddb' as const;

	private database?: Promise<IDBDatabase>;

	constructor(private scope = '') {}

	static available(): boolean {
		return typeof indexedDB !== 'undefined';
	}

	private manifestKey(): string {
		return this.scope ? `${MANIFEST_KEY}:${this.scope}` : MANIFEST_KEY;
	}

	private blobKey(id: AssetId): string {
		return this.scope ? `${this.scope}/${id}` : id;
	}

	private open(): Promise<IDBDatabase> {
		if (!this.database) {
			this.database = new Promise((resolve, reject) => {
				const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

				request.onupgradeneeded = () => {
					const database = request.result;

					if (!database.objectStoreNames.contains(BLOB_STORE)) {
						database.createObjectStore(BLOB_STORE);
					}

					if (!database.objectStoreNames.contains(MANIFEST_STORE)) {
						database.createObjectStore(MANIFEST_STORE);
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

		return result;
	}

	async readManifest(): Promise<AssetManifest> {
		const manifest = await this.transact<AssetManifest | undefined>(
			MANIFEST_STORE,
			'readonly',
			store => store.get(this.manifestKey())
		);

		return manifest ?? emptyManifest();
	}

	async writeManifest(manifest: AssetManifest): Promise<void> {
		await this.transact(MANIFEST_STORE, 'readwrite', store =>
			// Structured-cloned, so it must be a plain object.
			store.put(JSON.parse(JSON.stringify(manifest)), this.manifestKey())
		);
	}

	async readBlob(id: AssetId): Promise<Blob | undefined> {
		return await this.transact<Blob | undefined>(BLOB_STORE, 'readonly', store =>
			store.get(this.blobKey(id))
		);
	}

	async writeBlob(id: AssetId, blob: Blob): Promise<void> {
		await this.transact(BLOB_STORE, 'readwrite', store =>
			store.put(blob, this.blobKey(id))
		);
	}

	async deleteBlob(id: AssetId): Promise<void> {
		await this.transact(BLOB_STORE, 'readwrite', store =>
			store.delete(this.blobKey(id))
		);
	}
}
