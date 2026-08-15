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

/** Fallback web backend, used when OPFS isn't available. */
export class IndexedDbBackend implements StorageBackend {
	readonly kind = 'indexeddb' as const;

	private database?: Promise<IDBDatabase>;

	static available(): boolean {
		return typeof indexedDB !== 'undefined';
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
			store => store.get(MANIFEST_KEY)
		);

		return manifest ?? emptyManifest();
	}

	async writeManifest(manifest: AssetManifest): Promise<void> {
		await this.transact(MANIFEST_STORE, 'readwrite', store =>
			// Structured-cloned, so it must be a plain object.
			store.put(JSON.parse(JSON.stringify(manifest)), MANIFEST_KEY)
		);
	}

	async readBlob(id: AssetId): Promise<Blob | undefined> {
		return await this.transact<Blob | undefined>(BLOB_STORE, 'readonly', store =>
			store.get(id)
		);
	}

	async writeBlob(id: AssetId, blob: Blob): Promise<void> {
		await this.transact(BLOB_STORE, 'readwrite', store => store.put(blob, id));
	}

	async deleteBlob(id: AssetId): Promise<void> {
		await this.transact(BLOB_STORE, 'readwrite', store => store.delete(id));
	}
}
