import {
	ChangeEvent,
	LibraryEngine,
	MemoryBlobCache,
	MemoryLocalDb
} from '@sliders/asset-library';
import {inertClock, OfflineTransport} from './offline-transport';

/**
 * The one `LibraryEngine` of this app session, reachable outside React.
 *
 * `slidersAssetStore(storyId)` is synchronous and module-level (the packager, bundle
 * import and publishing call it with no React around), so the engine it reads has to be
 * too. `<LibraryProvider>` installs the real one (IndexedDB + OPFS, HTTP when a backend is
 * configured). Until then — and in every jest suite that never mounts the provider — a
 * memory-backed offline engine stands in, same code path.
 *
 * Engines are swapped when the backend prefs change. Everything here reads the CURRENT
 * engine per call, and change listeners are re-attached to each new engine.
 */

let current: LibraryEngine | undefined;
let ready: Promise<LibraryEngine> | undefined;
let online = false;
let detach: (() => void) | undefined;

const changeListeners = new Set<(event: ChangeEvent) => void>();
const swapListeners = new Set<(engine: LibraryEngine) => void>();

function attach(engine: LibraryEngine) {
	detach?.();
	detach = engine.onChange(event => {
		for (const listener of changeListeners) {
			listener(event);
		}
	});

	for (const listener of swapListeners) {
		listener(engine);
	}
}

function memoryEngine(): LibraryEngine {
	return new LibraryEngine({
		blobs: new MemoryBlobCache(),
		clientName: 'local',
		clock: inertClock,
		db: new MemoryLocalDb(),
		transport: new OfflineTransport()
	});
}

/**
 * Installs an engine. `start()` is awaited before anyone is handed it, and the previous
 * engine is disposed first: both write the same LocalDb, so the new one must load only
 * after the old one's last write.
 */
export function setLibraryEngine(
	engine: LibraryEngine,
	options: {online?: boolean} = {}
): Promise<LibraryEngine> {
	const previous = current;

	current = engine;
	online = !!options.online;
	ready = (previous ? previous.dispose().catch(logError) : Promise.resolve())
		.then(() => engine.start())
		.then(() => engine);
	attach(engine);

	return ready;
}

/** The current engine, started. Creates the memory stand-in on first use. */
export function libraryEngine(): Promise<LibraryEngine> {
	if (!ready) {
		void setLibraryEngine(memoryEngine());
	}

	return ready!;
}

/** The current engine if one exists, started or not. Sync; for event wiring. */
export function currentLibraryEngine(): LibraryEngine | undefined {
	return current;
}

/** True when the current engine talks to a real server. */
export function libraryOnline(): boolean {
	return online;
}

/** Engine change events, across engine swaps. */
export function onLibraryEngineChange(
	listener: (event: ChangeEvent) => void
): () => void {
	changeListeners.add(listener);
	return () => {
		changeListeners.delete(listener);
	};
}

/** Fires when a new engine is installed. */
export function onLibraryEngineSwap(
	listener: (engine: LibraryEngine) => void
): () => void {
	swapListeners.add(listener);
	return () => {
		swapListeners.delete(listener);
	};
}

/** Socket `{t: 'lib', seq}`. Advisory: the engine reads `/changes` itself. */
export function notifyLibrary(seq: number): void {
	if (current && online) {
		void libraryEngine().then(engine => engine.notify(seq).catch(logError));
	}
}

/** Socket came back. */
export function reconnectLibrary(): void {
	if (current && online) {
		void libraryEngine().then(engine => engine.reconnect().catch(logError));
	}
}

function logError(error: unknown) {
	console.warn('asset library: sync failed', error);
}

/** Tests: drop the engine; the next call builds a fresh memory one. */
export function resetLibraryEngineForTests(): void {
	detach?.();
	detach = undefined;
	current = undefined;
	ready = undefined;
	online = false;
}

/**
 * Story deleted for good (never synced, or removed from the server): its binding is tombstoned (usage badges drop it).
 * Its own collection is kept — other stories may attach it, and art is cheap to keep.
 */
export async function unbindStory(storyId: string): Promise<void> {
	const engine = await libraryEngine();

	if (engine.binding(storyId)) {
		engine.delete(storyId, 'binding');
	}
}
