import type {AssetId} from '@sliders/scene-types';
import {
	AssetManifest,
	emptyManifest,
	StorageBackend
} from '../asset-store.types';

const ROOT_DIRECTORY = 'sliders-assets';
const MANIFEST_FILE = 'manifest.json';

/**
 * Origin Private File System backend. Preferred on the web: OPFS handles tens of MB far
 * better than IndexedDB does (spec 03).
 *
 * One subdirectory of `sliders-assets` per scope, so a story's art cannot be seen from
 * another story. The empty scope is the legacy shared library, which lived in
 * `sliders-assets` itself; it is still readable so its art can be imported forward.
 */
export class OpfsBackend implements StorageBackend {
	readonly kind = 'opfs' as const;

	private directory?: Promise<FileSystemDirectoryHandle>;

	constructor(private scope = '') {}

	static available(): boolean {
		return (
			typeof navigator !== 'undefined' &&
			typeof navigator.storage?.getDirectory === 'function'
		);
	}

	private root(): Promise<FileSystemDirectoryHandle> {
		if (!this.directory) {
			const scope = this.scope;

			this.directory = navigator.storage
				.getDirectory()
				.then(root => root.getDirectoryHandle(ROOT_DIRECTORY, {create: true}))
				.then(assets =>
					scope ? assets.getDirectoryHandle(scope, {create: true}) : assets
				);
		}

		return this.directory;
	}

	private async write(name: string, blob: Blob) {
		const directory = await this.root();
		// TypeScript 4.9's lib.dom predates FileSystemWritableFileStream.
		const handle = (await directory.getFileHandle(name, {
			create: true
		})) as FileSystemFileHandle & {
			createWritable(): Promise<{
				write(data: Blob): Promise<void>;
				close(): Promise<void>;
			}>;
		};
		const writable = await handle.createWritable();

		await writable.write(blob);
		await writable.close();
	}

	private async read(name: string): Promise<File | undefined> {
		const directory = await this.root();

		try {
			const handle = await directory.getFileHandle(name);

			return await handle.getFile();
		} catch (error) {
			if ((error as DOMException)?.name === 'NotFoundError') {
				return undefined;
			}

			throw error;
		}
	}

	async readManifest(): Promise<AssetManifest> {
		const file = await this.read(MANIFEST_FILE);

		if (!file) {
			return emptyManifest();
		}

		try {
			return JSON.parse(await file.text()) as AssetManifest;
		} catch (error) {
			console.warn('Asset manifest is corrupt, starting empty', error);
			return emptyManifest();
		}
	}

	async writeManifest(manifest: AssetManifest): Promise<void> {
		await this.write(
			MANIFEST_FILE,
			new Blob([JSON.stringify(manifest)], {type: 'application/json'})
		);
	}

	async readBlob(id: AssetId): Promise<Blob | undefined> {
		return await this.read(id);
	}

	async writeBlob(id: AssetId, blob: Blob): Promise<void> {
		await this.write(id, blob);
	}

	async deleteBlob(id: AssetId): Promise<void> {
		const directory = await this.root();

		try {
			await directory.removeEntry(id);
		} catch (error) {
			if ((error as DOMException)?.name !== 'NotFoundError') {
				throw error;
			}
		}
	}
}
