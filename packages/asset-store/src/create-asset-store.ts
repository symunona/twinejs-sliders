import {AssetStore} from './asset-store.types';
import {ElectronBackend} from './backends/electron-backend';
import {IndexedDbBackend} from './backends/indexeddb-backend';
import {MemoryBackend} from './backends/memory-backend';
import {OpfsBackend} from './backends/opfs-backend';
import {BackedAssetStore} from './store';

function inElectron(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		navigator.userAgent.indexOf('Electron') !== -1
	);
}

/**
 * Picks a backend at runtime (spec 03, D14):
 *
 * | Platform | Backend |
 * |---|---|
 * | Electron, once the main-process bridge exists | project folder files |
 * | Web | OPFS, falling back to IndexedDB |
 *
 * The Electron file backend is still a stub — see backends/electron-backend.ts. Until it's
 * wired up, Electron gets the web backends and a warning, rather than a broken dialog.
 */
export function createAssetStore(): AssetStore {
	if (ElectronBackend.available()) {
		return new BackedAssetStore(new ElectronBackend(ElectronBackend.bridge()!));
	}

	if (inElectron()) {
		console.warn(
			'Sliders: the Electron asset backend is not wired up yet, so assets are ' +
				'being stored in the renderer instead of the project folder. See ' +
				'packages/asset-store/src/backends/electron-backend.ts.'
		);
	}

	if (OpfsBackend.available()) {
		return new BackedAssetStore(new OpfsBackend());
	}

	if (IndexedDbBackend.available()) {
		return new BackedAssetStore(new IndexedDbBackend());
	}

	console.warn(
		'Sliders: no persistent storage is available, so assets will be lost when this ' +
			'tab closes.'
	);
	return new BackedAssetStore(new MemoryBackend());
}
