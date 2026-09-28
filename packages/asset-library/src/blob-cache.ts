/**
 * The device's blob cache, keyed by sha256. One cache for every story: a picture five
 * stories use is one file here too. Blobs never change, so there is nothing to invalidate.
 */
export interface CachedBlob {
	bytes: Uint8Array;
	mime: string;
}

export interface BlobCache {
	has(sha: string): Promise<boolean>;
	get(sha: string): Promise<CachedBlob | undefined>;
	put(sha: string, bytes: Uint8Array, mime: string): Promise<void>;
	delete(sha: string): Promise<void>;
	list(): Promise<string[]>;
}

export class MemoryBlobCache implements BlobCache {
	private blobs = new Map<string, CachedBlob>();

	async has(sha: string): Promise<boolean> {
		return this.blobs.has(sha);
	}

	async get(sha: string): Promise<CachedBlob | undefined> {
		const blob = this.blobs.get(sha);

		return blob && {bytes: new Uint8Array(blob.bytes), mime: blob.mime};
	}

	async put(sha: string, bytes: Uint8Array, mime: string): Promise<void> {
		this.blobs.set(sha, {bytes: new Uint8Array(bytes), mime});
	}

	async delete(sha: string): Promise<void> {
		this.blobs.delete(sha);
	}

	async list(): Promise<string[]> {
		return Array.from(this.blobs.keys());
	}
}

const ROOT_DIRECTORY = 'sliders-library';
const BLOB_DIRECTORY = 'blobs';

type WritableHandle = FileSystemFileHandle & {
	createWritable(): Promise<{
		write(data: Blob): Promise<void>;
		close(): Promise<void>;
	}>;
};

type IterableDirectory = FileSystemDirectoryHandle & {
	keys(): AsyncIterableIterator<string>;
};

/**
 * OPFS cache: `sliders-library/blobs/<sha>` for bytes, `<sha>.mime` beside it, since a
 * file handle stores no type. Preferred on the web; falls back to IndexedDB.
 */
export class OpfsBlobCache implements BlobCache {
	private directory?: Promise<FileSystemDirectoryHandle>;

	static available(): boolean {
		return (
			typeof navigator !== 'undefined' &&
			typeof navigator.storage?.getDirectory === 'function'
		);
	}

	private root(): Promise<FileSystemDirectoryHandle> {
		if (!this.directory) {
			this.directory = navigator.storage
				.getDirectory()
				.then(root => root.getDirectoryHandle(ROOT_DIRECTORY, {create: true}))
				.then(library =>
					library.getDirectoryHandle(BLOB_DIRECTORY, {create: true})
				);
		}

		return this.directory;
	}

	private async write(name: string, blob: Blob) {
		const directory = await this.root();
		const handle = (await directory.getFileHandle(name, {
			create: true
		})) as WritableHandle;
		const writable = await handle.createWritable();

		await writable.write(blob);
		await writable.close();
	}

	private async read(name: string): Promise<File | undefined> {
		try {
			const directory = await this.root();
			const handle = await directory.getFileHandle(name);

			return await handle.getFile();
		} catch {
			return undefined;
		}
	}

	async has(sha: string): Promise<boolean> {
		return !!(await this.read(sha));
	}

	async get(sha: string): Promise<CachedBlob | undefined> {
		const file = await this.read(sha);

		if (!file) {
			return undefined;
		}

		const mimeFile = await this.read(`${sha}.mime`);
		const mime = (mimeFile && (await mimeFile.text())) || file.type;

		return {
			bytes: new Uint8Array(await file.arrayBuffer()),
			mime: mime || 'application/octet-stream'
		};
	}

	async put(sha: string, bytes: Uint8Array, mime: string): Promise<void> {
		// Mime first: a blob file without one reads as octet-stream, never as nothing.
		await this.write(`${sha}.mime`, new Blob([mime]));
		await this.write(sha, new Blob([new Uint8Array(bytes)], {type: mime}));
	}

	async delete(sha: string): Promise<void> {
		const directory = await this.root();

		for (const name of [sha, `${sha}.mime`]) {
			try {
				await directory.removeEntry(name);
			} catch {
				// Already gone.
			}
		}
	}

	async list(): Promise<string[]> {
		const directory = (await this.root()) as IterableDirectory;
		const shas: string[] = [];

		for await (const name of directory.keys()) {
			if (!name.endsWith('.mime')) {
				shas.push(name);
			}
		}

		return shas;
	}
}

const DATABASE_NAME = 'sliders-library-blobs';
const STORE = 'blobs';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** IndexedDB fallback for browsers without OPFS. */
export class IndexedDbBlobCache implements BlobCache {
	private database?: Promise<IDBDatabase>;

	static available(): boolean {
		return typeof indexedDB !== 'undefined';
	}

	private open(): Promise<IDBDatabase> {
		if (!this.database) {
			this.database = new Promise((resolve, reject) => {
				const request = indexedDB.open(DATABASE_NAME, 1);

				request.onupgradeneeded = () => {
					if (!request.result.objectStoreNames.contains(STORE)) {
						request.result.createObjectStore(STORE);
					}
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		}

		return this.database;
	}

	private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
		return (await this.open()).transaction(STORE, mode).objectStore(STORE);
	}

	async has(sha: string): Promise<boolean> {
		return (await promisify((await this.store('readonly')).count(sha))) > 0;
	}

	async get(sha: string): Promise<CachedBlob | undefined> {
		return promisify<CachedBlob | undefined>(
			(await this.store('readonly')).get(sha)
		);
	}

	async put(sha: string, bytes: Uint8Array, mime: string): Promise<void> {
		await promisify(
			(
				await this.store('readwrite')
			).put({bytes: new Uint8Array(bytes), mime}, sha)
		);
	}

	async delete(sha: string): Promise<void> {
		await promisify((await this.store('readwrite')).delete(sha));
	}

	async list(): Promise<string[]> {
		const keys = await promisify((await this.store('readonly')).getAllKeys());

		return keys.map(String);
	}
}

/** The best cache this browser has. */
export function createBrowserBlobCache(): BlobCache {
	if (OpfsBlobCache.available()) {
		return new OpfsBlobCache();
	}

	if (IndexedDbBlobCache.available()) {
		return new IndexedDbBlobCache();
	}

	return new MemoryBlobCache();
}
