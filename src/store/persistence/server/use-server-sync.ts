/**
 * The hook that drives server sync (spec 11).
 *
 * Mounted **beside** `usePersistence()`, never inside it. `usePersistence` picks
 * electron or localStorage as the store of record and every story write goes through its
 * middleware; a network call in that path means a dead wifi connection can throw where a
 * keystroke is being saved. Everything here watches the store from outside and is allowed
 * to fail on its own.
 *
 * It also never dispatches through `useUndoableStoriesContext`. A pull is not an author's
 * action, and putting it on the undo stack would offer to "undo" someone else's work.
 */

import {v4 as uuid} from '@lukeed/uuid';
import * as React from 'react';
import {getAppInfo} from '../../../util/app-info';
import {slidersAssetStore} from '../../../dialogs/sliders-assets/asset-store-context';
import {unusedName} from '../../../util/unused-name';
import {usePrefsContext} from '../../prefs';
import {
	useStoriesContext,
	type Passage,
	type StoriesDispatch,
	type Story
} from '../../stories';
import {
	isPersistablePassageChange,
	isPersistableStoryChange
} from '../persistable-changes';
import {syncStoryAssets, type AssetSyncProgress} from './asset-sync';
import {checkoutStory, type CheckoutProgress} from './checkout-story';
import {
	NOT_MODIFIED,
	createServerClient,
	isServerError,
	type ServerClient
} from './client';
import type {StoryIndexEntry} from './server.types';
import {SyncQueue} from './sync-queue';
import {
	allSyncRecords,
	deleteSyncRecord,
	storyHash,
	syncRecordOrNew,
	updateSyncRecord,
	type SyncRecords
} from './sync-record';

// ---------------------------------------------------------------------------
// Undo, cleared on pull
// ---------------------------------------------------------------------------

const pullListeners = new Set<(storyId: string) => void>();

/**
 * Fires when a pull has replaced a story's text.
 *
 * The undo stack for that story has to be dropped: an undo recorded against a state that
 * no longer exists would resurrect a passage someone else deleted, from a version that was
 * never on the server. `<UndoableStoriesContextProvider>` subscribes to this.
 */
export function onStoryPulled(listener: (storyId: string) => void): () => void {
	pullListeners.add(listener);

	return () => {
		pullListeners.delete(listener);
	};
}

function notifyStoryPulled(storyId: string): void {
	for (const listener of pullListeners) {
		listener(storyId);
	}
}

// ---------------------------------------------------------------------------
// The connect / refresh decision table
// ---------------------------------------------------------------------------

export type ReconcileAction =
	'ghost' | 'none' | 'pull' | 'conflict' | 'gone' | 'push';

export interface ReconcileInput {
	/** Absent when this browser has no copy of the story. */
	local?: {sync: boolean; dirty: boolean; rev: number};
	/** Absent when the server has never heard of it. */
	server?: {rev: number; deleted: boolean};
}

/**
 * One row of spec 11's "Connect / refresh" table, as a pure function.
 *
 * | local | server | result |
 * |---|---|---|
 * | — | present | `ghost` |
 * | `sync: false` | present | `none` — the card just notes "also on server" |
 * | `sync: true`, clean, behind | present | `pull` |
 * | `sync: true`, dirty, behind | present | `conflict` |
 * | `sync: true` | tombstone / absent | `gone` |
 * | `sync: true`, dirty, current | present | `push` |
 */
export function reconcileDecision(input: ReconcileInput): ReconcileAction {
	const {local, server} = input;

	if (!local) {
		return server && !server.deleted ? 'ghost' : 'none';
	}

	if (!local.sync) {
		return 'none';
	}

	if (!server || server.deleted) {
		return 'gone';
	}

	if (server.rev > local.rev) {
		return local.dirty ? 'conflict' : 'pull';
	}

	return local.dirty ? 'push' : 'none';
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type SyncProgress = CheckoutProgress | AssetSyncProgress;

export interface ServerSyncActions {
	/** Marks a local story synced and writes it to the server for the first time. */
	publish(story: Story, options?: {newIdentity?: boolean}): Promise<void>;
	/** Pulls a ghost down: story, then every asset it needs. */
	checkout(storyId: string): Promise<void>;
	/** Tombstones the story on the server. Local text is untouched. */
	removeFromServer(storyId: string, purge?: boolean): Promise<void>;
	/** `PUT ?revive=1` — restarts the same rev chain after a tombstone. */
	republish(story: Story): Promise<void>;
	/** Re-`GET` the current rev, then `PUT If-Match` with it. */
	resolveKeepMine(story: Story): Promise<void>;
	/** Duplicate the local text as "… (my copy)", then take the server's version. */
	resolveTakeTheirs(story: Story): Promise<void>;
	refresh(): Promise<void>;
	setSync(story: Story, sync: boolean): void;
}

export interface ServerSyncContextProps {
	/**
	 * Undefined until the backend prefs are filled in. Dialogs that read one-off endpoints
	 * — revision history, the conflict preview — talk to it directly rather than growing
	 * an action apiece for a call they make once.
	 */
	client?: ServerClient;
	records: SyncRecords;
	/** Index entries with no local story. Ghost cards. */
	ghosts: StoryIndexEntry[];
	/** Everything the server listed, ghosts included. */
	index: StoryIndexEntry[];
	connected: boolean;
	lastError?: string;
	/** In-flight checkout or asset upload, by story id. Drives the progress bar. */
	progress: Record<string, SyncProgress | undefined>;
	actions: ServerSyncActions;
}

const noopActions: ServerSyncActions = {
	checkout: async () => undefined,
	publish: async () => undefined,
	refresh: async () => undefined,
	removeFromServer: async () => undefined,
	republish: async () => undefined,
	resolveKeepMine: async () => undefined,
	resolveTakeTheirs: async () => undefined,
	setSync: () => undefined
};

export const ServerSyncContext = React.createContext<ServerSyncContextProps>({
	actions: noopActions,
	connected: false,
	ghosts: [],
	index: [],
	progress: {},
	records: {}
});

ServerSyncContext.displayName = 'ServerSync';

export const useServerSyncContext = () => React.useContext(ServerSyncContext);

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

/**
 * Reference equality, except that two arrays with the same members are the same array.
 *
 * `tags: []` is rebuilt on every spread of a passage, so a strict compare would report a
 * change on every keystroke and hand the network a story that never stops looking dirty.
 */
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}

	return (
		Array.isArray(a) &&
		Array.isArray(b) &&
		a.length === b.length &&
		a.every((item, index) => item === b[index])
	);
}

function changedProps<T extends object>(previous: T, next: T): Partial<T> {
	const result: Partial<T> = {};

	for (const key of Object.keys(next) as (keyof T)[]) {
		if (!sameValue(previous[key], next[key])) {
			result[key] = next[key];
		}
	}

	return result;
}

/**
 * Did anything worth a network round trip change between these two versions of a story?
 *
 * Uses the same `isPersistable*Change` predicates the local save path does, so "selected a
 * passage" costs nothing here for exactly the reason it costs nothing there.
 */
export function hasPersistableChange(previous: Story, next: Story): boolean {
	if (previous === next) {
		return false;
	}

	const storyDiff = changedProps(previous, next);

	delete storyDiff.passages;

	if (isPersistableStoryChange(storyDiff)) {
		return true;
	}

	if (previous.passages === next.passages) {
		return false;
	}

	if (previous.passages.length !== next.passages.length) {
		return true;
	}

	const before = new Map<string, Passage>(
		previous.passages.map(passage => [passage.id, passage])
	);

	for (const passage of next.passages) {
		const old = before.get(passage.id);

		if (!old) {
			return true;
		}

		if (
			old !== passage &&
			isPersistablePassageChange(changedProps(old, passage))
		) {
			return true;
		}
	}

	return false;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export interface ServerSyncProviderProps {
	children?: React.ReactNode;
}

export const ServerSyncProvider: React.FC<ServerSyncProviderProps> = ({
	children
}) => {
	const value = useServerSync();

	// `React.createElement` rather than JSX so this stays a `.ts` file — the module is
	// mostly plain logic and the tests import the decision table out of it.
	return React.createElement(ServerSyncContext.Provider, {value}, children);
};

/**
 * Everything above, wired up. Exported on its own so a test can drive it without a
 * provider, and so the mount point can be a one-liner beside `<StateLoader>`.
 */
export function useServerSync(): ServerSyncContextProps {
	const {dispatch, stories} = useStoriesContext();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const [records, setRecords] = React.useState<SyncRecords>(() =>
		allSyncRecords()
	);
	const [index, setIndex] = React.useState<StoryIndexEntry[]>([]);
	const [connected, setConnected] = React.useState(false);
	const [lastError, setLastError] = React.useState<string | undefined>();
	const [progress, setProgress] = React.useState<
		Record<string, SyncProgress | undefined>
	>({});

	// Refs, not deps: the callbacks below are handed to timers and event listeners that
	// outlive a render, and rebuilding the queue every time a passage changes would
	// restart every debounce.
	const storiesRef = React.useRef(stories);
	const dispatchRef = React.useRef<StoriesDispatch>(dispatch);
	const previousRef = React.useRef<Map<string, Story>>(new Map());

	storiesRef.current = stories;
	dispatchRef.current = dispatch;

	const {backendAutosave, backendClientId, backendToken, backendUrl} = prefs;
	const backendUsername = prefs.backendUsername;

	// A client id is minted once per browser and then never changes: it is how presence,
	// locks and revision history tell two tabs of the same person apart.
	React.useEffect(() => {
		if (!backendClientId) {
			prefsDispatch({
				name: 'backendClientId',
				type: 'update',
				value: uuid()
			});
		}
	}, [backendClientId, prefsDispatch]);

	const clientName =
		backendUsername || `user-${(backendClientId || '').slice(0, 4)}`;

	const client = React.useMemo<ServerClient | undefined>(() => {
		if (!backendUrl || !backendToken || !backendClientId) {
			return undefined;
		}

		const info = getAppInfo();

		return createServerClient({
			appVersion:
				`${info.name ?? 'twine-sliders'} ${info.version ?? ''}`.trim(),
			clientId: backendClientId,
			clientName,
			token: backendToken,
			url: backendUrl
		});
	}, [backendClientId, backendToken, backendUrl, clientName]);

	const queue = React.useMemo(() => {
		if (!client) {
			return undefined;
		}

		return new SyncQueue({
			client,
			onError: (_storyId, error) => {
				setLastError(error instanceof Error ? error.message : String(error));

				if (isServerError(error) && error.network) {
					setConnected(false);
				}
			}
		});
	}, [client]);

	React.useEffect(() => () => queue?.dispose(), [queue]);

	React.useEffect(() => {
		if (!queue) {
			return;
		}

		setRecords({...queue.records});

		return queue.onChange(next => setRecords({...next}));
	}, [queue]);

	const setStoryProgress = React.useCallback(
		(storyId: string, next: SyncProgress | undefined) =>
			setProgress(current => ({...current, [storyId]: next})),
		[]
	);

	/** Replaces a local story with the server's copy and drops its undo history. */
	const applyPull = React.useCallback((story: Story, rev: number) => {
		const local: Story = {...story, sync: true};

		dispatchRef.current({
			props: {...local},
			storyId: story.id,
			type: 'updateStory'
		});
		updateSyncRecord(story.id, {
			conflictClient: undefined,
			conflictRev: undefined,
			lastError: undefined,
			lastPulledAt: Date.now(),
			pushedHash: storyHash(local),
			rev,
			state: 'idle'
		});
		previousRef.current.set(story.id, local);
		notifyStoryPulled(story.id);
		setRecords({...allSyncRecords()});
	}, []);

	const pull = React.useCallback(
		async (storyId: string, ifNoneMatch?: number) => {
			if (!client) {
				return;
			}

			updateSyncRecord(storyId, {state: 'pulling'});
			setRecords({...allSyncRecords()});

			const fetched = await client.getStory(storyId, ifNoneMatch);

			if (fetched === NOT_MODIFIED) {
				updateSyncRecord(storyId, {state: 'idle'});
				setRecords({...allSyncRecords()});
				return;
			}

			applyPull(fetched.story, fetched.rev);
		},
		[applyPull, client]
	);

	const pushAssets = React.useCallback(
		async (story: Story) => {
			if (!client) {
				return;
			}

			try {
				await syncStoryAssets({
					client,
					onProgress: next => setStoryProgress(story.id, next),
					story,
					store: slidersAssetStore(story.id)
				});
			} catch (error) {
				// Art failing to upload is worth reporting but must not undo the text
				// push that just succeeded.
				setLastError(error instanceof Error ? error.message : String(error));
			} finally {
				setStoryProgress(story.id, undefined);
			}
		},
		[client, setStoryProgress]
	);

	const refresh = React.useCallback(async () => {
		if (!client || !queue) {
			setConnected(false);
			return;
		}

		let entries: StoryIndexEntry[];

		try {
			entries = await client.listStories();
			setConnected(true);
			setLastError(undefined);
		} catch (error) {
			setConnected(false);
			setLastError(error instanceof Error ? error.message : String(error));
			return;
		}

		setIndex(entries);

		const byId = new Map(entries.map(entry => [entry.id, entry]));
		const localStories = storiesRef.current;
		const pulls: Promise<void>[] = [];

		for (const story of localStories) {
			const entry = byId.get(story.id);
			const record = syncRecordOrNew(story.id);
			const decision = reconcileDecision({
				local: {
					dirty: storyHash(story) !== record.pushedHash,
					rev: record.rev,
					sync: story.sync === true
				},
				server: entry ? {deleted: entry.deleted, rev: entry.rev} : undefined
			});

			switch (decision) {
				case 'pull':
					pulls.push(
						pull(story.id).catch(error =>
							setLastError(
								error instanceof Error ? error.message : String(error)
							)
						)
					);
					break;

				case 'conflict':
					updateSyncRecord(story.id, {
						conflictClient: entry?.lastClient,
						conflictRev: entry?.rev,
						state: 'conflict'
					});
					break;

				case 'gone':
					// The text stays exactly where it is. All that changes is that this
					// browser stops pushing it, and the card offers Republish.
					updateSyncRecord(story.id, {state: 'gone'});
					queue.cancel(story.id);
					dispatchRef.current({
						props: {sync: false},
						storyId: story.id,
						type: 'updateStory'
					});
					break;

				case 'push':
					if (backendAutosave) {
						queue.push(story);
					}
					break;

				default:
					break;
			}
		}

		await Promise.all(pulls);
		setRecords({...allSyncRecords()});
	}, [backendAutosave, client, pull, queue]);

	// Connect on mount, and whenever the credentials change.
	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	// Watch the store and queue pushes. This is the autosave path.
	React.useEffect(() => {
		const seen = previousRef.current;

		for (const story of stories) {
			const previous = seen.get(story.id);

			seen.set(story.id, story);

			if (!queue || !backendAutosave || story.sync !== true) {
				continue;
			}

			// First sight of a story after a reload: no diff to take, so fall back to the
			// hash, which is what `queue.push` checks anyway.
			if (previous && !hasPersistableChange(previous, story)) {
				continue;
			}

			queue.push(story);
		}

		for (const id of [...seen.keys()]) {
			if (!stories.some(story => story.id === id)) {
				seen.delete(id);
			}
		}
	}, [backendAutosave, queue, stories]);

	// Last chance to save before the tab is hidden or closed. `keepalive` is what lets the
	// request outlive the document.
	React.useEffect(() => {
		if (!queue) {
			return;
		}

		const onVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				void queue.flushAll({keepalive: true});
			}
		};

		document.addEventListener('visibilitychange', onVisibilityChange);

		return () =>
			document.removeEventListener('visibilitychange', onVisibilityChange);
	}, [queue]);

	// ---------------------------------------------------------------------
	// Actions
	// ---------------------------------------------------------------------

	const publish = React.useCallback(
		async (story: Story, options: {newIdentity?: boolean} = {}) => {
			if (!client) {
				return;
			}

			let target = story;

			if (options.newIdentity) {
				// "Publish as new" — the server already has something under this id, and
				// the author said it is not this story. A fresh id and ifid make it a
				// different document everywhere, which is what they meant.
				const id = uuid();

				target = {
					...story,
					id,
					ifid: uuid().toUpperCase(),
					passages: story.passages.map(passage => ({...passage, story: id})),
					sync: true
				};

				dispatchRef.current({storyId: story.id, type: 'deleteStory'});
				dispatchRef.current({props: target, type: 'createStory'});
				deleteSyncRecord(story.id);
			} else {
				target = {...story, sync: true};
				dispatchRef.current({
					props: {sync: true},
					storyId: story.id,
					type: 'updateStory'
				});
			}

			updateSyncRecord(target.id, {
				pushedHash: '',
				rev: 0,
				state: 'pushing'
			});
			setRecords({...allSyncRecords()});

			try {
				const result = await client.putStory(target);

				updateSyncRecord(target.id, {
					lastError: undefined,
					lastPushedAt: Date.now(),
					pushedHash: storyHash(target),
					rev: result.rev,
					state: 'idle'
				});
				previousRef.current.set(target.id, target);
				setRecords({...allSyncRecords()});
				await pushAssets(target);
			} catch (error) {
				updateSyncRecord(target.id, {
					lastError: error instanceof Error ? error.message : String(error),
					state: 'error'
				});
				setRecords({...allSyncRecords()});
				throw error;
			}

			await refresh();
		},
		[client, pushAssets, refresh]
	);

	const republish = React.useCallback(
		async (story: Story) => {
			if (!client) {
				return;
			}

			const target: Story = {...story, sync: true};

			dispatchRef.current({
				props: {sync: true},
				storyId: story.id,
				type: 'updateStory'
			});

			const result = await client.reviveStory(target);

			updateSyncRecord(target.id, {
				lastError: undefined,
				lastPushedAt: Date.now(),
				pushedHash: storyHash(target),
				rev: result.rev,
				state: 'idle'
			});
			previousRef.current.set(target.id, target);
			setRecords({...allSyncRecords()});
			await pushAssets(target);
			await refresh();
		},
		[client, pushAssets, refresh]
	);

	const checkout = React.useCallback(
		async (storyId: string) => {
			if (!client) {
				return;
			}

			try {
				await checkoutStory({
					client,
					dispatch: dispatchRef.current,
					onProgress: next => setStoryProgress(storyId, next),
					stories: storiesRef.current,
					storyId
				});
				setRecords({...allSyncRecords()});
			} finally {
				setStoryProgress(storyId, undefined);
			}

			await refresh();
		},
		[client, refresh, setStoryProgress]
	);

	const removeFromServer = React.useCallback(
		async (storyId: string, purge = false) => {
			if (!client) {
				return;
			}

			await client.deleteStory(storyId, purge);
			queue?.cancel(storyId);
			deleteSyncRecord(storyId);

			if (storiesRef.current.some(story => story.id === storyId)) {
				dispatchRef.current({
					props: {sync: false},
					storyId,
					type: 'updateStory'
				});
			}

			setRecords({...allSyncRecords()});
			await refresh();
		},
		[client, queue, refresh]
	);

	const resolveKeepMine = React.useCallback(
		async (target: Story) => {
			const storyId = target.id;
			const story =
				storiesRef.current.find(item => item.id === storyId) ?? target;

			if (!client) {
				return;
			}

			// Re-read to learn the rev we are overwriting. Their version is already a
			// snapshot in `revs/`, one click from coming back.
			const current = await client.getStory(storyId);
			const rev = current === NOT_MODIFIED ? undefined : current.rev;
			const result = await client.putStory(story, rev);

			updateSyncRecord(storyId, {
				conflictClient: undefined,
				conflictRev: undefined,
				lastError: undefined,
				lastPushedAt: Date.now(),
				pushedHash: storyHash(story),
				rev: result.rev,
				state: 'idle'
			});
			previousRef.current.set(storyId, story);
			setRecords({...allSyncRecords()});
			await pushAssets(story);
		},
		[client, pushAssets]
	);

	const resolveTakeTheirs = React.useCallback(
		async (target: Story) => {
			const storyId = target.id;
			const story =
				storiesRef.current.find(item => item.id === storyId) ?? target;

			if (!client) {
				return;
			}

			// The author's version is duplicated before it is replaced. No sync path
			// destroys anything — worst case, something gets renamed.
			const copyId = uuid();

			dispatchRef.current({
				props: {
					...story,
					id: copyId,
					ifid: uuid().toUpperCase(),
					name: unusedName(
						`${story.name} (my copy)`,
						storiesRef.current.map(item => item.name)
					),
					passages: story.passages.map(passage => ({
						...passage,
						id: uuid(),
						story: copyId
					})),
					sync: false
				},
				type: 'createStory'
			});

			await pull(storyId);
			setRecords({...allSyncRecords()});
		},
		[client, pull]
	);

	const setSync = React.useCallback(
		(story: Story, sync: boolean) => {
			dispatchRef.current({
				props: {sync},
				storyId: story.id,
				type: 'updateStory'
			});

			if (sync) {
				updateSyncRecord(story.id, {state: 'dirty'});
				queue?.push({...story, sync: true});
			} else {
				queue?.cancel(story.id);
				deleteSyncRecord(story.id);
			}

			setRecords({...allSyncRecords()});
		},
		[queue]
	);

	const ghosts = React.useMemo(
		() =>
			index
				.filter(
					entry =>
						!entry.deleted && !stories.some(story => story.id === entry.id)
				)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
		[index, stories]
	);

	const value = React.useMemo<ServerSyncContextProps>(
		() => ({
			actions: {
				checkout,
				publish,
				refresh,
				removeFromServer,
				republish,
				resolveKeepMine,
				resolveTakeTheirs,
				setSync
			},
			client,
			connected,
			ghosts,
			index,
			lastError,
			progress,
			records
		}),
		[
			checkout,
			client,
			connected,
			ghosts,
			index,
			lastError,
			progress,
			publish,
			records,
			refresh,
			removeFromServer,
			republish,
			resolveKeepMine,
			resolveTakeTheirs,
			setSync
		]
	);

	// The Playwright suite polls this instead of guessing at timings. Cheap enough to
	// leave on in production, and it makes a bug report reproducible.
	React.useEffect(() => {
		(globalThis as Record<string, unknown>).__slidersSync = {
			connected,
			ghosts,
			records
		};
	}, [connected, ghosts, records]);

	return value;
}
