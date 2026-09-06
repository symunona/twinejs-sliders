import {
	AssetStore,
	createAssetStore,
	PutAssetOptions
} from '@sliders/asset-store';
import {AssetId, AssetMeta, Character} from '@sliders/scene-types';
import * as React from 'react';

const stores = new Map<string, AssetStore>();

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

/**
 * Bumped by every `refreshAssetLibrary()`. Exported so anything derived from the library —
 * the unreferenced-art scan, say — recomputes on the same signal the grids redraw on.
 */
export function useLibraryVersion(): number {
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
 * A story's asset library. Deliberately not part of the stories context: asset bytes must
 * not ride along with story text through undo, archive, and import/export (spec 03).
 *
 * One store per story id. Art uploaded while editing one story is invisible from another,
 * so a `bg: forest` in two stories means two different pictures unless the author imports
 * one into the other.
 */
export function slidersAssetStore(scope: string): AssetStore {
	let store = stores.get(scope);

	if (!store) {
		store = createAssetStore(scope);
		stores.set(scope, store);
	}

	return store;
}

/**
 * Drops every cached store. Tests only — the stores hold open object URLs and an
 * in-memory manifest, so a suite that reuses them starts with the last one's assets.
 */
export function resetAssetStoresForTests(): void {
	stores.clear();
}

/**
 * The story whose library the dialogs below this point read and write. Every asset dialog
 * lives inside the story editor, so this is set once per route.
 */
const AssetScopeContext = React.createContext<string | undefined>(undefined);

export interface AssetScopeProviderProps {
	children: React.ReactNode;
	storyId: string;
}

export const AssetScopeProvider: React.FC<AssetScopeProviderProps> = ({
	children,
	storyId
}) => (
	<AssetScopeContext.Provider value={storyId}>
		{children}
	</AssetScopeContext.Provider>
);

/**
 * Which story's library we are in. Throws rather than falling back to the legacy shared
 * one: silently writing an upload where every story can see it is the bug this exists to
 * stop.
 */
export function useAssetScope(): string {
	const scope = React.useContext(AssetScopeContext);

	if (scope === undefined) {
		throw new Error(
			'Assets belong to a story, and this component is outside <AssetScopeProvider>.'
		);
	}

	return scope;
}

/** The current story's asset library. */
export function useAssetStore(scope?: string): AssetStore {
	const current = React.useContext(AssetScopeContext);
	const resolved = scope ?? current;

	if (resolved === undefined) {
		throw new Error(
			'Assets belong to a story, and this component is outside <AssetScopeProvider>.'
		);
	}

	return React.useMemo(() => slidersAssetStore(resolved), [resolved]);
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
 *
 * `scope` reads another story's library instead of this one's — what the Import tab needs,
 * and the only reason it is a parameter.
 */
export function useAssetLibrary(scope?: string): AssetLibrary {
	const store = useAssetStore(scope);
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
export function useAssetUrl(id?: AssetId, scope?: string): string | undefined {
	const store = useAssetStore(scope);
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
