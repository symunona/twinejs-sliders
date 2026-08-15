import type {AssetId} from '@sliders/scene-types';
import {
	AssetManifest,
	emptyManifest,
	StorageBackend
} from '../asset-store.types';

/** Non-persistent backend. Used by tests, and as a last resort if nothing else works. */
export class MemoryBackend implements StorageBackend {
	readonly kind = 'indexeddb' as const;

	private manifest: AssetManifest = emptyManifest();
	private blobs = new Map<AssetId, Blob>();

	async readManifest(): Promise<AssetManifest> {
		return JSON.parse(JSON.stringify(this.manifest)) as AssetManifest;
	}

	async writeManifest(manifest: AssetManifest): Promise<void> {
		this.manifest = JSON.parse(JSON.stringify(manifest)) as AssetManifest;
	}

	async readBlob(id: AssetId): Promise<Blob | undefined> {
		return this.blobs.get(id);
	}

	async writeBlob(id: AssetId, blob: Blob): Promise<void> {
		this.blobs.set(id, blob);
	}

	async deleteBlob(id: AssetId): Promise<void> {
		this.blobs.delete(id);
	}
}
