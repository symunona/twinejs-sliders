import {
	browserDecoder,
	createBrowserBlobCache,
	HttpTransport,
	IndexedDbLocalDb,
	LibraryEngine,
	LocalDb,
	BlobCache,
	MemoryLocalDb,
	Notice,
	realClock,
	StatusEvent,
	uniqueName
} from '@sliders/asset-library';
import * as React from 'react';
import {collectAssetRefs, resolveBundleRefs} from '../../util/sliders-bundle';
import {usePrefsContext} from '../prefs';
import {useServerSyncContext} from '../persistence/server/use-server-sync';
import {useStoriesContext, type Story} from '../stories';
import {
	libraryEngine,
	libraryOnline,
	onLibraryEngineChange,
	onLibraryEngineSwap,
	reconnectLibrary,
	setLibraryEngine
} from './engine-registry';
import {inertClock, OfflineTransport} from './offline-transport';
import {
	placeholderCollectionName,
	setStoryDirectory,
	storyAssetStore
} from './story-asset-store';

/**
 * Owns the app session's `LibraryEngine` (asset-library-2-sync.md, "Client").
 *
 * - Persistent stores: IndexedDB records, OPFS blobs. One of each for the whole app.
 * - Transport: HTTP to `${backendUrl}/api/v1/lib` when a backend is configured, else an
 *   offline one (local-only library, same code path; the outbox waits).
 * - Socket `{t: 'lib'}` arrives through `server-message.ts` → `notifyLibrary`; a socket
 *   reconnect calls `engine.reconnect()`; a poll covers a dead socket.
 * - Story → library: names the own collection after the story, and pushes the asset ids
 *   each story's scenes use (`setRefs`, debounced) so `usage()` can answer.
 *
 * Mounted inside `<ServerSyncProvider>` (it reads `socketConnected`).
 */

export const LIBRARY_POLL_MS = 30000;
export const LIBRARY_SOCKET_POLL_MS = 300000;
export const LIBRARY_REFS_DEBOUNCE_MS = 2000;

let persistent: {db: LocalDb; blobs: BlobCache} | undefined;

function persistentStores() {
	persistent ??= {
		blobs: createBrowserBlobCache(),
		db: IndexedDbLocalDb.available()
			? new IndexedDbLocalDb()
			: new MemoryLocalDb()
	};

	return persistent;
}

function decoder() {
	return typeof createImageBitmap === 'function' &&
		typeof OffscreenCanvas === 'function'
		? browserDecoder
		: undefined;
}

export interface LibraryConfig {
	backendUrl?: string;
	token?: string;
	clientId?: string;
	clientName: string;
}

function configKey(config: LibraryConfig): string {
	return JSON.stringify([
		config.backendUrl,
		config.token,
		config.clientId,
		config.clientName
	]);
}

/** Builds and installs the engine for this config. */
export function installLibraryEngine(config: LibraryConfig): LibraryEngine {
	const online = !!(config.backendUrl && config.token && config.clientId);
	const {blobs, db} = persistentStores();
	const engine = new LibraryEngine({
		blobs,
		clientName: config.clientName,
		clock: online ? realClock : inertClock,
		db,
		decoder: decoder(),
		transport: online
			? new HttpTransport(
					config.backendUrl!,
					config.token!,
					config.clientName,
					undefined,
					config.clientId
			  )
			: new OfflineTransport()
	});

	void setLibraryEngine(engine, {online}).then(started => {
		if (online) {
			started.sync().catch(error =>
				console.warn('asset library: first sync failed', error)
			);
		}
	});

	return engine;
}

/** The asset ids a story's scenes reach, through its own resolved view. */
export async function storyAssetRefs(story: Story): Promise<string[]> {
	const resolved = await resolveBundleRefs(
		storyAssetStore(story.id),
		collectAssetRefs(story)
	);

	return resolved.assets.map(meta => meta.id);
}

export const LibraryProvider: React.FC<{children?: React.ReactNode}> = ({
	children
}) => {
	const {prefs} = usePrefsContext();
	const {stories} = useStoriesContext();
	const {socketConnected} = useServerSyncContext();
	const {backendClientId, backendToken, backendUrl, backendUsername} = prefs;
	const config: LibraryConfig = {
		backendUrl: backendUrl || undefined,
		clientId: backendClientId || undefined,
		clientName: backendUsername || `user-${(backendClientId || '').slice(0, 4)}`,
		token: backendToken || undefined
	};
	const key = configKey(config);
	const installed = React.useRef<string | undefined>(undefined);

	// During render, not in an effect: children's effects run first, and one that asked
	// for the engine would get the memory stand-in and write into it.
	if (installed.current !== key) {
		installed.current = key;
		installLibraryEngine(config);
	}

	const storiesRef = React.useRef(stories);

	storiesRef.current = stories;

	React.useEffect(() => {
		setStoryDirectory({
			name: id => storiesRef.current.find(story => story.id === id)?.name
		});
	}, []);

	// Socket back → catch up. Poll either way, slower with a socket.
	const wasConnected = React.useRef(socketConnected);

	React.useEffect(() => {
		if (socketConnected && !wasConnected.current) {
			reconnectLibrary();
		}

		wasConnected.current = socketConnected;
	}, [socketConnected]);

	React.useEffect(() => {
		const timer = setInterval(
			() => {
				if (libraryOnline()) {
					void libraryEngine().then(engine =>
						engine.poll().catch(() => undefined)
					);
				}
			},
			socketConnected ? LIBRARY_SOCKET_POLL_MS : LIBRARY_POLL_MS
		);

		return () => clearInterval(timer);
	}, [socketConnected, key]);

	// Own collection named after its story (bundle import creates it before the story
	// exists), and usage refs, debounced.
	const seen = React.useRef(new Map<string, Story>());
	/** Story name last seen per story: a change renames its own collection. */
	const names = React.useRef(new Map<string, string>());
	const timer = React.useRef<ReturnType<typeof setTimeout>>();

	const schedule = React.useCallback(() => {
		if (timer.current) {
			clearTimeout(timer.current);
		}

		timer.current = setTimeout(() => {
			timer.current = undefined;
			void syncStories(storiesRef.current, seen.current, names.current);
		}, LIBRARY_REFS_DEBOUNCE_MS);
	}, []);

	React.useEffect(schedule, [schedule, stories]);

	// Art added or renamed changes which ids a story's names reach, with no story edit.
	// `setRefs` is a no-op when nothing moved, so this settles after one pass.
	React.useEffect(
		() =>
			onLibraryEngineChange(event => {
				if (event.source === 'local') {
					seen.current.clear();
					schedule();
				}
			}),
		[schedule]
	);

	React.useEffect(
		() => () => {
			if (timer.current) {
				clearTimeout(timer.current);
			}
		},
		[]
	);

	// A new engine knows nothing of what the last one was told.
	React.useEffect(() => onLibraryEngineSwap(() => seen.current.clear()), []);

	return <>{children}</>;
};

/**
 * The own collection follows a story rename, numbered if the name is taken. Only while
 * it still carries the old name (or a numbered form of it): a collection somebody named
 * by hand keeps that name.
 */
export function followStoryRename(
	engine: LibraryEngine,
	storyId: string,
	oldName: string,
	newName: string
): void {
	const binding = engine.binding(storyId);
	const own = binding && engine.get(binding.own, 'collection');
	const from = oldName.trim();
	const to = newName.trim();

	if (!own || own.deleted || !to || from === to) {
		return;
	}

	const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	if (own.name !== from && !new RegExp(`^${escaped}-\\d+$`).test(own.name)) {
		return;
	}

	const taken = new Set(
		engine
			.collections()
			.filter(collection => collection.id !== own.id)
			.map(collection => collection.name)
	);

	engine.updateCollection(own.id, {name: uniqueName(to, taken)});
}

async function syncStories(
	stories: readonly Story[],
	seen: Map<string, Story>,
	names: Map<string, string>
): Promise<void> {
	const engine = await libraryEngine();

	for (const story of stories) {
		const binding = engine.binding(story.id);
		const previousName = names.get(story.id);

		names.set(story.id, story.name);

		if (!binding) {
			continue;
		}

		if (previousName !== undefined && previousName !== story.name) {
			try {
				followStoryRename(engine, story.id, previousName, story.name);
			} catch (error) {
				console.warn('asset library: could not rename collection', error);
			}
		}

		const own = engine.get(binding.own, 'collection');

		if (
			own &&
			!own.deleted &&
			own.name.startsWith(placeholderCollectionName(story.id)) &&
			story.name.trim()
		) {
			const taken = new Set(
				engine
					.collections()
					.filter(collection => collection.id !== own.id)
					.map(collection => collection.name)
			);

			try {
				engine.updateCollection(own.id, {
					name: uniqueName(story.name.trim(), taken)
				});
			} catch (error) {
				console.warn('asset library: could not name collection', error);
			}
		}

		if (seen.get(story.id) === story) {
			continue;
		}

		seen.set(story.id, story);

		try {
			engine.setRefs(story.id, await storyAssetRefs(story));
		} catch (error) {
			console.warn('asset library: could not record asset refs', error);
		}
	}
}

// ---------------------------------------------------------------------------
// Hooks for the Library UI
// ---------------------------------------------------------------------------

/** The current engine (re-renders when it is swapped). Undefined until started. */
export function useLibraryEngine(): LibraryEngine | undefined {
	const [engine, setEngine] = React.useState<LibraryEngine | undefined>();

	React.useEffect(() => {
		let live = true;

		void libraryEngine().then(started => live && setEngine(started));

		const off = onLibraryEngineSwap(next => {
			void libraryEngine().then(
				started => live && started === next && setEngine(started)
			);
		});

		return () => {
			live = false;
			off();
		};
	}, []);

	return engine;
}

/** Outbox / conflicts / offline, live. */
export function useLibraryStatus(): StatusEvent & {online: boolean} {
	const engine = useLibraryEngine();
	const [status, setStatus] = React.useState<StatusEvent>({
		conflicts: 0,
		offline: false,
		pending: 0
	});

	React.useEffect(() => {
		if (!engine) {
			return;
		}

		setStatus(engine.status());
		return engine.onStatus(setStatus);
	}, [engine]);

	return {...status, online: libraryOnline()};
}

/** Engine notices (renamed-on-clash, conflict, delete-refused …). */
export function useLibraryNotices(listener: (notice: Notice) => void): void {
	const engine = useLibraryEngine();
	const ref = React.useRef(listener);

	ref.current = listener;

	React.useEffect(
		() => engine?.onNotice(notice => ref.current(notice)),
		[engine]
	);
}
