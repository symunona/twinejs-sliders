import {
	AssetStore,
	createAssetStore,
	PutAssetOptions
} from '@sliders/asset-store';
import {AssetId, AssetMeta, Character} from '@sliders/scene-types';
import * as React from 'react';

let singleton: AssetStore | undefined;

/**
 * Both Sliders dialogs can be open at once, and an upload in one has to show up in the
 * other. A module-level version counter keeps every `useAssetLibrary()` in step.
 */
let libraryVersion = 0;
const libraryListeners = new Set<() => void>();

/** Tells every open dialog to re-read the library. */
export function refreshAssetLibrary() {
	libraryVersion++;
	libraryListeners.forEach(listener => listener());
}

function useLibraryVersion(): number {
	const [version, setVersion] = React.useState(libraryVersion);

	React.useEffect(() => {
		const listener = () => setVersion(libraryVersion);

		libraryListeners.add(listener);
		return () => {
			libraryListeners.delete(listener);
		};
	}, []);

	return version;
}

/**
 * The app-wide asset library. Deliberately not part of the stories context: asset bytes
 * must not ride along with story text through undo, archive, and import/export (spec 03).
 */
export function slidersAssetStore(): AssetStore {
	if (!singleton) {
		singleton = createAssetStore();
	}

	return singleton;
}

export interface UploadReport {
	/** Names of files that were already in the library. */
	duplicates: string[];
	/** Names of files that were re-encoded to WebP. */
	transcoded: string[];
	/** Names of files that were kept as-is because they're animated. */
	animated: string[];
	errors: string[];
}

export interface AssetLibrary {
	/** Every asset, including character frames. */
	all: AssetMeta[];
	busy: boolean;
	characters: Character[];
	lastUpload?: UploadReport;
	refresh: () => void;
	store: AssetStore;
	/** Assets not owned by a character — what the flat list shows (spec 03). */
	visible: AssetMeta[];
	/** Every tag in use, sorted. */
	tags: string[];
	upload: (files: File[], options?: PutAssetOptions) => Promise<UploadReport>;
}

/**
 * Loads the library and keeps it in sync. Every dialog that touches assets uses this, so
 * uploads made in one show up in the other.
 */
export function useAssetLibrary(): AssetLibrary {
	const store = React.useMemo(() => slidersAssetStore(), []);
	const [all, setAll] = React.useState<AssetMeta[]>([]);
	const [busy, setBusy] = React.useState(true);
	const [characters, setCharacters] = React.useState<Character[]>([]);
	const [lastUpload, setLastUpload] = React.useState<UploadReport>();
	const version = useLibraryVersion();
	const refresh = refreshAssetLibrary;

	React.useEffect(() => {
		let current = true;

		async function load() {
			try {
				const [assets, cast] = await Promise.all([
					store.list({includeFrames: true}),
					store.listCharacters()
				]);

				if (current) {
					setAll(assets);
					setCharacters(cast);
				}
			} catch (error) {
				console.error('Could not load the Sliders asset library', error);
			} finally {
				if (current) {
					setBusy(false);
				}
			}
		}

		load();
		return () => {
			current = false;
		};
	}, [store, version]);

	const upload = React.useCallback(
		async (files: File[], options?: PutAssetOptions) => {
			const report: UploadReport = {
				animated: [],
				duplicates: [],
				errors: [],
				transcoded: []
			};

			setBusy(true);

			for (const file of files) {
				try {
					const result = await store.putAsset(file, options);

					if (result.duplicate) {
						report.duplicates.push(file.name);
					} else if (result.transcoded) {
						report.transcoded.push(file.name);
					} else if (result.meta.animated) {
						report.animated.push(file.name);
					}
				} catch (error) {
					console.error(`Could not upload ${file.name}`, error);
					report.errors.push(file.name);
				}
			}

			setLastUpload(report);
			refresh();
			return report;
		},
		[refresh, store]
	);

	const visible = React.useMemo(
		() => all.filter(asset => !asset.ownerCharacter),
		[all]
	);
	const tags = React.useMemo(
		() =>
			Array.from(new Set(all.flatMap(asset => asset.tags))).sort((a, b) =>
				a.localeCompare(b)
			),
		[all]
	);

	return {
		all,
		busy,
		characters,
		lastUpload,
		refresh,
		store,
		tags,
		upload,
		visible
	};
}

/** Resolves an asset id to a URL a preview can use. */
export function useAssetUrl(id?: AssetId): string | undefined {
	const store = React.useMemo(() => slidersAssetStore(), []);
	const [url, setUrl] = React.useState<string>();
	// An asset's bytes can change under a stable id--the editor can write an
	// edit back over the original. The old object URL is revoked at that point,
	// so anything still holding it shows a broken image until it re-resolves.
	const version = useLibraryVersion();

	React.useEffect(() => {
		let current = true;

		if (!id) {
			setUrl(undefined);
			return;
		}

		store.url(id).then(result => {
			if (current) {
				setUrl(result);
			}
		});

		return () => {
			current = false;
		};
	}, [id, store, version]);

	return url;
}
