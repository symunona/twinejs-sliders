import type {AssetId} from '@sliders/scene-types';
import {AssetManifest, StorageBackend} from '../asset-store.types';
import {blobBytes} from '../blob-bytes';

/**
 * The shape the Electron main process will need to expose on `window.twineElectron` for
 * this backend to work. Nothing implements it yet.
 */
export interface TwineElectronAssetBridge {
	readAssetManifest(scope: string): Promise<string | undefined>;
	writeAssetManifest(scope: string, json: string): Promise<void>;
	readAsset(scope: string, id: AssetId): Promise<ArrayBuffer | undefined>;
	writeAsset(
		scope: string,
		id: AssetId,
		data: ArrayBuffer,
		mime: string
	): Promise<void>;
	deleteAsset(scope: string, id: AssetId): Promise<void>;
}

// ===========================================================================
// TODO — ELECTRON ADAPTER STUB. NOT WIRED UP.
//
// Spec 03 wants Electron assets kept as plain files in `<story>/assets/`, so they are
// git-friendly and diffable. That needs main-process code: an IPC channel, a resolved
// project path, and preload wiring in src/electron/. None of that exists yet, and this
// package deliberately does not reach into the main process.
//
// What is left to do:
//   1. Add IPC handlers in src/electron/main-process/ that read and write
//      `<story folder>/assets/<id>` plus `assets/manifest.json`. The scope every bridge
//      method takes is the story id — assets are per story, not per library.
//   2. Expose them on `window.twineElectron` from the preload script, matching
//      TwineElectronAssetBridge above.
//   3. Delete the `available()` guard's TODO note — detection then picks this up on its
//      own, because createAssetStore() already prefers it when the bridge is present.
//
// Until then createAssetStore() logs a warning in Electron and falls back to the web
// backends, which do work there. Nothing silently breaks.
// ===========================================================================

export class ElectronBackend implements StorageBackend {
	readonly kind = 'electron' as const;

	constructor(private bridge: TwineElectronAssetBridge, private scope = '') {}

	/** True only once the main process actually exposes the bridge. */
	static available(): boolean {
		const bridge = (globalThis as Record<string, any>).twineElectron;

		return (
			typeof bridge === 'object' &&
			bridge !== null &&
			typeof bridge.readAssetManifest === 'function'
		);
	}

	static bridge(): TwineElectronAssetBridge | undefined {
		return ElectronBackend.available()
			? ((globalThis as Record<string, any>)
					.twineElectron as TwineElectronAssetBridge)
			: undefined;
	}

	async readManifest(): Promise<AssetManifest> {
		const json = await this.bridge.readAssetManifest(this.scope);

		return json
			? (JSON.parse(json) as AssetManifest)
			: {version: 1, assets: {}, characters: {}};
	}

	async writeManifest(manifest: AssetManifest): Promise<void> {
		await this.bridge.writeAssetManifest(
			this.scope,
			JSON.stringify(manifest, null, 2)
		);
	}

	async readBlob(id: AssetId): Promise<Blob | undefined> {
		const data = await this.bridge.readAsset(this.scope, id);

		return data ? new Blob([data]) : undefined;
	}

	async writeBlob(id: AssetId, blob: Blob): Promise<void> {
		await this.bridge.writeAsset(
			this.scope,
			id,
			await blobBytes(blob),
			blob.type
		);
	}

	async deleteBlob(id: AssetId): Promise<void> {
		await this.bridge.deleteAsset(this.scope, id);
	}
}
