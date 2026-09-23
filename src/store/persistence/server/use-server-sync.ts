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
import {
	onAssetLibraryChange,
	refreshAssetLibrary,
	slidersAssetStore
} from '../../../dialogs/sliders-assets/asset-store-context';
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
import {applyPulledStory, pullAllowed} from './apply-pull';
import {syncStoryAssets, type AssetSyncProgress} from './asset-sync';
import {checkoutStory, type CheckoutProgress} from './checkout-story';
import {
	pullStoryAssets,
	type AssetPullProgress,
	type AssetPullResult
} from './pull-assets';
import {
	NOT_MODIFIED,
	createServerClient,
	isServerError,
	type ServerClient
} from './client';
import {createEventsSocket, type EventsSocket} from './events';
import {
	clientsInStory,
	emptyPresence,
	passageLock,
	presenceDisconnected,
	presenceReducer,
	type PassageLock,
	type PresenceState
} from './presence';
import type {
	PresenceClient,
	ServerMessage,
	StoryIndexEntry
} from './server.types';
import {reconcileVerified} from './reconcile';
import {handleServerMessage} from './server-message';
import {installSyncLogDebugHook, logSync} from './sync-log';
import {SyncQueue} from './sync-queue';
import {
	allSyncRecords,
	deleteSyncRecord,
	localSyncRecordStore,
	storyHash,
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

/**
 * Moved to `reconcile.ts`, where the verification step that corrects a suspected
 * `conflict` can sit beside it without this hook and `sync-queue.ts` importing each
 * other. Re-exported so every existing reader keeps its import.
 */
export {reconcileDecision} from './reconcile';
export type {ReconcileAction, ReconcileInput} from './reconcile';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type SyncProgress =
	| CheckoutProgress
	| AssetSyncProgress
	| AssetPullProgress;

/** Art coming down into a story already on screen. Never blocks the card. */
export function isAssetPullProgress(
	progress?: SyncProgress
): progress is AssetPullProgress {
	return progress?.phase === 'download';
}

/**
 * Is this story coming down rather than going up? Checkout is the only half that leaves a
 * story on screen with art missing, so it is the only half the story list blocks on. The
 * two progress shapes are told apart by phase: `scan`/`diff`/`upload`/`manifest` are a
 * push, and a push has nothing to wait for.
 */
export function isCheckoutProgress(
	progress?: SyncProgress
): progress is CheckoutProgress {
	return progress?.phase === 'story' || progress?.phase === 'assets';
}

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

/**
 * How often to poll `GET /stories` with no socket. Spec 11's fallback.
 *
 * With a socket the poll does not go away, it only slows down: the bus can miss a message
 * — a reconnect straddling someone else's write — and a five-minute sweep is what notices.
 */
export const POLL_INTERVAL = 30000;
export const SOCKET_POLL_INTERVAL = 300000;

/**
 * How long a library change waits before it is pushed. Longer than the text debounce on
 * purpose: dropping six files fires the change signal six times, and one scan of the
 * library at the end is the whole point of coalescing.
 */
export const ASSET_SYNC_DEBOUNCE_MS = 3000;

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

	/**
	 * Pull this story's art now. Fire-and-forget: resolves when the pull settles.
	 *
	 * Not on `actions` because it is not an author's command — nothing is confirmed,
	 * nothing is undone and the story list offers no button for it. It is the same call the
	 * poll and the socket make, reachable by a dialog that has a better reason than a timer
	 * to think the art moved: an editor opening on a picture would otherwise wait up to
	 * 30 s to find out somebody else had changed it.
	 *
	 * `AssetPullResult.changed` is the answer to "did anything actually land" and is read
	 * off what the library holds, not off what the pull intended. `undefined` means no pull
	 * ran: no client, or a story this browser does not sync.
	 *
	 * Two callers at once SHARE one run — the second is handed the first's promise. Not a
	 * debounce: nothing is dropped and nothing is deferred.
	 */
	pullAssets(storyId: string): Promise<AssetPullResult | undefined>;

	// -------------------------------------------------------------------
	// Presence and soft locks — all of it optional, all of it silent when the socket is
	// down. See `presence.ts`; these are the bound versions of its queries.
	// -------------------------------------------------------------------

	/** The last `welcome` / `presence` payload, plus who we are. */
	presence: PresenceState;
	/** The websocket, separately from `connected`, which is about HTTP. */
	socketConnected: boolean;
	/** Everyone else in a story. What the story-list card and the toolbar draw. */
	clientsIn(storyId: string): PresenceClient[];
	/** Who is holding this passage against us, and whether it has been taken over. */
	lock(storyId: string, passageId: string): PassageLock | undefined;
	/** Passage null means "in the story map, not in a passage". */
	focusPassage(storyId: string, passageId: string | null): void;
	blurPassage(storyId: string, passageId: string | null): void;
	/** Take over: announces, does not kick. Both editors end up writable. */
	stealPassage(storyId: string, passageId: string): void;
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
	blurPassage: () => undefined,
	clientsIn: () => [],
	connected: false,
	focusPassage: () => undefined,
	ghosts: [],
	index: [],
	lock: () => undefined,
	presence: emptyPresence(),
	progress: {},
	pullAssets: async () => undefined,
	records: {},
	socketConnected: false,
	stealPassage: () => undefined
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
/**
 * `syncedHashes` off a pull result, when the pull side reports one. Read structurally so
 * this compiles against a `pull-assets.ts` that does not declare the field yet.
 */
function syncedHashesOf(
	result: AssetPullResult
): Map<string, string> | undefined {
	return 'syncedHashes' in result && result.syncedHashes instanceof Map
		? result.syncedHashes
		: undefined;
}

export function useServerSync(): ServerSyncContextProps {
	const {dispatch, stories} = useStoriesContext();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const [records, setRecords] = React.useState<SyncRecords>(() =>
		allSyncRecords()
	);
	const [index, setIndex] = React.useState<StoryIndexEntry[]>([]);
	const [connected, setConnected] = React.useState(false);
	const [socketConnected, setSocketConnected] = React.useState(false);
	const [presence, setPresence] = React.useState<PresenceState>(() =>
		emptyPresence()
	);
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
	const socketRef = React.useRef<EventsSocket | undefined>(undefined);
	/** What we last told the hub we were looking at, so `pagehide` can release it. */
	const focusRef = React.useRef<
		{story: string; passage: string | null} | undefined
	>(undefined);

	storiesRef.current = stories;
	dispatchRef.current = dispatch;

	/**
	 * The side table as a seam, so the hook and the queue it builds read and write the one
	 * store. Memoised because `reconcileStory` depends on it and a fresh object each
	 * render would rebuild every callback hanging off it.
	 */
	const recordStore = React.useMemo(() => localSyncRecordStore(), []);

	// `window.__slidersSyncLog.enable()`. Inert until someone calls that, so this costs
	// one property — and it is the difference between reconstructing a sync bug from
	// symptoms hours later and reading the decisions off a live session.
	React.useEffect(() => {
		if (typeof window !== 'undefined') {
			installSyncLogDebugHook(window as unknown as Record<string, unknown>);
		}
	}, []);

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

	/** Story id -> the library fingerprint the server was last told about. */
	const assetFingerprints = React.useRef(new Map<string, string>());
	/** Story id -> pending debounce timer for a background asset sync. */
	const assetTimers = React.useRef(
		new Map<string, ReturnType<typeof setTimeout>>()
	);
	const assetSyncRef = React.useRef<(story: Story) => void>(() => {});
	/**
	 * Land a story the queue merged. Through a ref for the same reason `assetSyncRef` is:
	 * the queue is memoised on `client`, and this closes over `dispatch` and the story
	 * list, both of which move on every render.
	 */
	const applyPulledStoryRef = React.useRef<
		(story: Story, rev: number) => boolean
	>(() => false);
	/** Story id -> manifest rev this browser has already taken art from. */
	const assetPullRevs = React.useRef(new Map<string, number>());
	/**
	 * Story id -> the pull in flight for it, so a second caller can be handed the first
	 * one's promise instead of starting a second run over the same library.
	 *
	 * A `Set` before, which answered the second caller with nothing at all. That was fine
	 * while every caller was a timer, and wrong the moment one of them was a dialog waiting
	 * to hear whether anything landed: "a pull is already running" and "nothing arrived"
	 * are different answers and were being given the same way.
	 */
	const assetPulls = React.useRef(
		new Map<string, Promise<AssetPullResult | undefined>>()
	);
	/** Story id -> the index row's asset signature as the index last reported it. */
	const assetSignatures = React.useRef(new Map<string, string>());
	/**
	 * Story id -> (asset id -> hash) as last agreed with the server, by a push that wrote
	 * or a pull that reported it. In memory only: a reload starts blank and the first
	 * push pulls before it writes.
	 */
	const assetSyncedHashes = React.useRef(
		new Map<string, Map<string, string>>()
	);
	/** Story id -> the pull warnings last shown, so a poll does not repeat them. */
	const assetPullWarnings = React.useRef(new Map<string, string>());
	const pullAssetsRef = React.useRef<
		(
			storyId: string,
			signature?: string
		) => Promise<AssetPullResult | undefined>
	>(async () => undefined);
	/** `pullAssets` minus the "does this browser sync it" gate. Push reaches it here. */
	const runAssetPullRef = React.useRef<
		(storyId: string) => Promise<AssetPullResult | undefined>
	>(async () => undefined);

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
			},
			/**
			 * A merge the queue wrote to the server, on its way into the store.
			 *
			 * Returns `true` only when the store really took it, because that is what
			 * the queue records a new rev on. `applyPulledStory` is the honest answer —
			 * it dry-runs the real reducer — and it is the same landing check a pull
			 * goes through, which is the point: a merge arrives carrying somebody
			 * else's passages, so it is a pull with extra steps and must clear undo the
			 * same way.
			 *
			 * A `true` returned on faith is how a passage gets dropped: the next patch
			 * would diff against a base the store never reached.
			 */
			onMerged: (merged, rev) =>
				applyPulledStoryRef.current(merged, rev),
			// Through a ref: the queue is memoised on `client` alone, and rebuilding it
			// whenever a callback identity changed would drop every pending debounce
			// timer with it — the author's last sentence among them.
			onPushed: story => assetSyncRef.current(story)
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

	/**
	 * Replaces a local story with the server's copy and drops its undo history.
	 *
	 * The whole decision lives in `apply-pull.ts`, which checks that the store will take
	 * the update before recording that it did. This used to record success
	 * unconditionally, and the stories reducer refuses a duplicate name in silence — see
	 * the note at the top of that file.
	 */
	const applyPull = React.useCallback(
		(story: Story, rev: number): boolean => {
			const outcome = applyPulledStory({
				dispatch: dispatchRef.current,
				onPulled: notifyStoryPulled,
				records: recordStore,
				rev,
				// A ref, read fresh: the store may have moved on while the fetch was out.
				stories: () => storiesRef.current,
				story
			});

			setRecords({...allSyncRecords()});

			if (!outcome.landed) {
				return false;
			}

			// The story the store actually holds, which may carry a name the collision
			// forced. The watcher diffs against this map to decide whether the AUTHOR
			// changed something, so the copy that landed is the honest answer.
			//
			// Not load-bearing on its own: `previousRef` is a fast path, and a wrong
			// entry here only costs a `queue.push` that the hash check then drops (see
			// the watcher below, and `SyncQueue.push`). What actually stopped the old
			// bug pushing stale text back over somebody else's work is that a REFUSED
			// pull now writes no `pushedHash` at all.
			previousRef.current.set(story.id, outcome.story);

			// Text that arrived from somebody else usually names art that did too.
			void pullAssetsRef.current(story.id);

			return true;
		},
		[recordStore]
	);

	// The queue reaches this through a ref, so it can be memoised on `client` alone.
	React.useEffect(() => {
		applyPulledStoryRef.current = applyPull;
	}, [applyPull]);

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
		async (story: Story, options: {quiet?: boolean} = {}) => {
			if (!client) {
				return;
			}

			const store = slidersAssetStore(story.id);
			const attempt = (ifMatch: number | undefined, lastFingerprint?: string) =>
				syncStoryAssets({
					client,
					ifMatch,
					lastFingerprint,
					onProgress: next => {
						// The autosave path runs this after every push. Scanning and diffing
						// are not news; only bytes actually going up are worth a progress
						// row, or the story card blinks on every keystroke batch.
						if (
							options.quiet &&
							(next.phase === 'scan' || next.phase === 'diff')
						) {
							return;
						}

						setStoryProgress(story.id, next);
					},
					story,
					store,
					syncedHashes: assetSyncedHashes.current.get(story.id)
				});

			try {
				// Never push blind. No rev yet means this tab has not seen the server's art
				// for this story, and an unconditional write is how a stale device put its
				// old bytes over another's edit. Pull (which merges) to learn the rev.
				if (!assetPullRevs.current.has(story.id)) {
					if (!(await runAssetPullRef.current(story.id))) {
						return;
					}
				}

				let result;

				try {
					result = await attempt(
						assetPullRevs.current.get(story.id),
						options.quiet ? assetFingerprints.current.get(story.id) : undefined
					);
				} catch (error) {
					if (!isServerError(error) || !error.conflict) {
						throw error;
					}

					// Someone else wrote first. ONE pull and ONE retry, never a loop: two
					// tabs trading 412s would each pull and push forever. A second refusal
					// waits for the next library event or poll.
					const theirRev = error.rev;

					logSync('asset', 'push 412: pulling once', story.id, () => ({
						rev: theirRev
					}));

					if (!(await runAssetPullRef.current(story.id))) {
						return;
					}

					try {
						result = await attempt(assetPullRevs.current.get(story.id));
					} catch (retryError) {
						if (!isServerError(retryError) || !retryError.conflict) {
							throw retryError;
						}

						// Quiet on purpose: not an error the author can act on, and a
						// banner per text push would be noise. The next event tries again.
						const againRev = retryError.rev;

						assetFingerprints.current.delete(story.id);
						logSync('asset', 'push 412 again: waiting', story.id, () => ({
							rev: againRev
						}));
						return;
					}
				}

				// Only a run that reached the manifest counts. Remembering a half-finished
				// one would skip the retry that finishes it.
				assetFingerprints.current.set(story.id, result.fingerprint);

				if (result.syncedHashes) {
					assetSyncedHashes.current.set(story.id, result.syncedHashes);
				}

				// Our own manifest write moves the rev, and the index row with it. Claim it
				// here or the next poll reads it as somebody else's art and pulls it back.
				if (!result.unchanged && result.rev > 0) {
					assetPullRevs.current.set(story.id, result.rev);
				}
			} catch (error) {
				// Art failing to upload is worth reporting but must not undo the text
				// push that just succeeded.
				assetFingerprints.current.delete(story.id);
				setLastError(error instanceof Error ? error.message : String(error));
			} finally {
				setStoryProgress(story.id, undefined);
			}
		},
		[client, setStoryProgress]
	);

	/**
	 * Art has no queue of its own, so this is it: coalesce, then sync in the background.
	 *
	 * Two things call it. A story push, because a text edit can be the first thing that
	 * names a picture; and a library change, because dropping a file in the asset dialog
	 * never touches story text and would otherwise reach the server only at the next
	 * Publish. Both are cheap when nothing moved — `lastFingerprint` short-circuits the
	 * whole run before any request goes out.
	 */
	const scheduleAssetSync = React.useCallback(
		(story: Story) => {
			if (!client || !backendAutosave || story.sync !== true) {
				return;
			}

			const existing = assetTimers.current.get(story.id);

			if (existing) {
				clearTimeout(existing);
			}

			assetTimers.current.set(
				story.id,
				setTimeout(() => {
					assetTimers.current.delete(story.id);

					// Re-read: the debounce is seconds long and the story it was armed
					// with may have been edited, unshared or deleted since.
					const current = storiesRef.current.find(
						item => item.id === story.id
					);

					if (current?.sync === true) {
						void pushAssets(current, {quiet: true});
					}
				}, ASSET_SYNC_DEBOUNCE_MS)
			);
		},
		[backendAutosave, client, pushAssets]
	);

	React.useEffect(() => {
		assetSyncRef.current = scheduleAssetSync;
	}, [scheduleAssetSync]);

	/**
	 * A pull's warnings — "your library already has a different image named …" — on the
	 * same channel as every other asset problem. Once per distinct set per story: the
	 * same unlandable row comes back on every manifest rev, and a poll must not repeat it.
	 */
	const reportPullWarnings = React.useCallback(
		(storyId: string, warnings: string[]) => {
			const key = [...warnings].sort().join('\n');

			if (key === (assetPullWarnings.current.get(storyId) ?? '')) {
				return;
			}

			assetPullWarnings.current.set(storyId, key);

			if (warnings.length > 0) {
				logSync('asset', 'pull warnings', storyId, () => ({warnings}));
				setLastError(warnings.join(' '));
			}
		},
		[]
	);

	/**
	 * Art coming DOWN into a story this browser already holds.
	 *
	 * Checkout used to be the only path, so a picture added by another editor never
	 * arrived: the card said synced and the stage drew `? bg forest` until the story was
	 * unpublished and published again. `pullStoryAssets` is cheap to ask — a manifest GET,
	 * then a compare against the local library — so every caller here simply asks.
	 *
	 * The result is handed back rather than swallowed, because one caller is now a dialog
	 * opening on this story, and it has to know whether anything arrived. `changed` is the
	 * honest field for that: `pull-assets.ts` reads it off what the library HOLDS once the
	 * pull is done, never off what the pull set out to fetch. `undefined` means no pull ran
	 * — no client, or not a story this browser syncs — or that one ran and threw, which is
	 * reported on `lastError` and is not something a caller can do anything else about.
	 */
	const runAssetPull = React.useCallback(
		(
			storyId: string,
			signature?: string
		): Promise<AssetPullResult | undefined> => {
			if (!client) {
				return Promise.resolve(undefined);
			}

			const inFlight = assetPulls.current.get(storyId);

			if (inFlight) {
				// SHARED, not dropped and not debounced: a second caller waits on the run
				// already going and gets its answer. Nothing is delayed and nothing is
				// silently discarded — two asks a millisecond apart describe the same
				// library, so a second manifest GET could only agree with the first.
				//
				// What the joiner does NOT get is its `signature` recorded, deliberately:
				// the run in flight was armed with whatever the caller before it knew, so
				// claiming the newer signature would say a row had been seen that this pull
				// never looked at. Left unrecorded, the next poll asks again, and the rev
				// guard in `pull-assets.ts` makes that ask one small GET.
				return inFlight;
			}

			const run = (async (): Promise<AssetPullResult | undefined> => {
				try {
					const pullOptions = {
						client,
						lastRev: assetPullRevs.current.get(storyId),
						onProgress: (next: AssetPullProgress) =>
							setStoryProgress(storyId, next),
						store: slidersAssetStore(storyId),
						storyId,
						syncedHashes: assetSyncedHashes.current.get(storyId)
					};
					const result = await pullStoryAssets(pullOptions);
					const synced = syncedHashesOf(result);

					assetPullRevs.current.set(storyId, result.rev);

					if (synced) {
						assetSyncedHashes.current.set(storyId, synced);
					}

					if (!result.skipped) {
						reportPullWarnings(storyId, result.warnings);
					}

					if (signature !== undefined) {
						assetSignatures.current.set(storyId, signature);
					}

					if (result.changed) {
						// Everything drawing on this library re-reads: the stage resolver and
						// both asset dialogs. It also schedules a push, which is the point of
						// `changed` being narrow — see the note in `pull-assets.ts`.
						refreshAssetLibrary();
					}

					return result;
				} catch (error) {
					// Missing art is worth saying out loud, but it must not mark the story in
					// error: its text is fine and still syncing.
					setLastError(error instanceof Error ? error.message : String(error));
					return undefined;
				}
			})().finally(() => {
				assetPulls.current.delete(storyId);
				setStoryProgress(storyId, undefined);
			});

			// Recorded after the promise exists, and the cleanup above is a `.finally` on the
			// OUTSIDE for that reason. A `finally` inside the async body runs synchronously if
			// the body throws before its first `await` — which is before this line — and the
			// entry it cleared would then be the one written here, leaving the story unable to
			// pull for the life of the tab.
			assetPulls.current.set(storyId, run);

			return run;
		},
		[client, reportPullWarnings, setStoryProgress]
	);

	const pullAssets = React.useCallback(
		(
			storyId: string,
			signature?: string
		): Promise<AssetPullResult | undefined> => {
			// The index signature is claimed only by a pull that actually ran. Claiming it
			// up front looks harmless and is not: a pull refused because the client was
			// mid-rebuild (the credentials just changed) would leave the signature saying
			// "seen", and the poll would never look at that story again — art stuck until
			// the page was reloaded. Measured exactly that way.
			if (!client) {
				return Promise.resolve(undefined);
			}

			// Only a story this browser holds AND syncs. A ghost's art arrives with its
			// checkout, and an unsynced local story has no business reading the server's.
			if (
				storiesRef.current.find(item => item.id === storyId)?.sync !== true
			) {
				return Promise.resolve(undefined);
			}

			return runAssetPull(storyId, signature);
		},
		[client, runAssetPull]
	);

	React.useEffect(() => {
		pullAssetsRef.current = pullAssets;
		runAssetPullRef.current = runAssetPull;
	}, [pullAssets, runAssetPull]);

	React.useEffect(() => {
		const timers = assetTimers.current;

		return () => {
			timers.forEach(timer => clearTimeout(timer));
			timers.clear();
		};
	}, []);

	// Art changed in a dialog. The signal is scope-less, so ask every synced story; the
	// fingerprint makes the ones whose library did not move free.
	React.useEffect(
		() =>
			onAssetLibraryChange(() => {
				storiesRef.current
					.filter(story => story.sync === true)
					.forEach(story => scheduleAssetSync(story));
			}),
		[scheduleAssetSync]
	);

	/**
	 * One story, one row of the decision table, applied.
	 *
	 * Both callers go through here: the poll, which learns `server` from an index entry,
	 * and the websocket, which learns it from a `story` / `deleted` / `revived` message. A
	 * second copy of this for the socket is exactly how the two paths would come to
	 * disagree about what a stale-and-dirty story means.
	 *
	 * `reconcileVerified`, not the bare table: a `conflict` out of the table is a
	 * SUSPICION taken on this browser's own bookkeeping, and one browser can be behind its
	 * own landed write (`docs/sliders/bugs/rev-lag.md`). The verification fetches and
	 * compares content, so what arrives here is an answer. This is the "next page load"
	 * path — the poll on mount is what repairs a tab-hide push whose receipt died.
	 */
	const reconcileStory = React.useCallback(
		async (
			story: Story,
			server: {rev: number; deleted: boolean; lastClient?: string} | undefined
		) => {
			if (!queue || !client) {
				return;
			}

			const decision = await reconcileVerified({
				client,
				local: story,
				records: recordStore,
				server: server ? {deleted: server.deleted, rev: server.rev} : undefined
			});

			switch (decision) {
				case 'pull':
					// A pull the store already refused at this rev is not worth asking for
					// again: landing one clears the story's undo stack, so a poll that
					// keeps trying would wipe the author's history on a timer. `Checkout`
					// is the way past this; the block lifts on its own the moment the
					// server's rev moves.
					if (
						server &&
						!pullAllowed(recordStore.get(story.id), server.rev)
					) {
						logSync('pull', 'skipped: refused at this rev', story.id, () => ({
							rev: server.rev
						}));
						break;
					}

					try {
						await pull(story.id);
					} catch (error) {
						setLastError(
							error instanceof Error ? error.message : String(error)
						);
					}
					break;

				case 'conflict':
					// Verified: the server really is holding something this browser did
					// not write. Only a person can say which copy wins.
					logSync('reconcile', 'conflict', story.id, () => ({
						conflictClient: server?.lastClient,
						conflictRev: server?.rev
					}));
					updateSyncRecord(story.id, {
						conflictClient: server?.lastClient,
						conflictRev: server?.rev,
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
		},
		[backendAutosave, client, pull, queue, recordStore]
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

		await Promise.all(
			storiesRef.current.map(story => {
				const entry = byId.get(story.id);

				return reconcileStory(
					story,
					entry
						? {
								deleted: entry.deleted,
								lastClient: entry.lastClient,
								rev: entry.rev
							}
						: undefined
				);
			})
		);
		setRecords({...allSyncRecords()});
	}, [client, queue, reconcileStory]);

	// Connect on mount, and whenever the credentials change.
	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	/**
	 * The poll's half of the pull. The index row carries each story's asset count, byte
	 * total and manifest rev, so a change in any of them says the art moved — no extra
	 * request to find out.
	 *
	 * First sight of a story counts as a change, and deliberately so: that is what repairs
	 * a browser holding art from before any of this existed. `pullAssets` answers a
	 * needless ask with one small GET.
	 */
	React.useEffect(() => {
		for (const entry of index) {
			if (entry.deleted) {
				continue;
			}

			// Not ours to pull yet — the stories may simply not have loaded. Leave the
			// signature unrecorded so the next sweep tries again.
			if (
				storiesRef.current.find(story => story.id === entry.id)?.sync !== true
			) {
				continue;
			}

			// `assetRev` is the manifest's OWN rev and moves on every manifest write. The
			// two totals move only when bytes are added or dropped, so without it an edit's
			// settings, an anchor or a cutout sidecar changed the art on one machine and
			// every other one kept drawing the old picture until its page was reloaded: the
			// 30s poll, the 5min poll and Refresh From Server all read the row as unmoved.
			//
			// A server too old to send it reports `undefined`, and the placeholder for that
			// is a CONSTANT on purpose. Anything derived from the moment — a counter, a
			// clock, a random — would make every signature differ from the last one and pull
			// every story on every poll, for as long as the tab is open, against a server
			// that by definition has nothing new to say. A constant degrades to exactly the
			// behaviour that shipped before this line: counts and bytes still wake the poll,
			// a metadata-only change does not, until the server is upgraded. `-` rather than
			// `0` so that "did not say" stays distinguishable from a real rev 0, which is
			// what a story whose manifest has never been written reports.
			const signature = `${entry.assetCount}:${entry.assetBytes}:${
				entry.assetRev ?? '-'
			}`;

			if (assetSignatures.current.get(entry.id) === signature) {
				continue;
			}

			// The signature is recorded by the pull itself, and only once it has run.
			void pullAssetsRef.current(entry.id, signature);
		}
	}, [index]);

	// The polling fallback. It is not disabled when the socket is up, only slowed: a
	// message lost across a reconnect would otherwise never be noticed.
	React.useEffect(() => {
		if (!client) {
			return;
		}

		const timer = setInterval(
			() => void refresh(),
			socketConnected ? SOCKET_POLL_INTERVAL : POLL_INTERVAL
		);

		return () => clearInterval(timer);
	}, [client, refresh, socketConnected]);

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
	// The websocket: the fast path in front of the poll, plus presence
	// ---------------------------------------------------------------------

	/**
	 * One message off the bus.
	 *
	 * Two folds of the same message, one line apart and deliberately not combined.
	 * `presenceReducer` says who is here; `handleServerMessage` (`server-message.ts`) says
	 * what our stories should do about it. Both are pure of React and tested without one —
	 * everything below is the wiring that makes hook state look like an env.
	 */
	const handleServerEvent = React.useCallback(
		(message: ServerMessage) => {
			setPresence(current => presenceReducer(current, message));

			handleServerMessage(message, {
				onReconciled: () => setRecords({...allSyncRecords()}),
				pullAssets: storyId => void pullAssetsRef.current(storyId),
				reconcile: reconcileStory,
				records: recordStore,
				refresh: () => void refresh(),
				setIndex,
				// A function, not `stories`: a message can land at any moment between
				// renders, and an array captured at render time answers for a browser that
				// no longer exists.
				stories: () => storiesRef.current
			});
		},
		[reconcileStory, recordStore, refresh]
	);

	// A ref so the socket's listener never has to be torn down and rebuilt: reconnecting
	// on every keystroke-driven re-render of the handler would be worse than useless.
	//
	// The indirection survives the move of the body into `server-message.ts` and has to.
	// `handleServerEvent` still changes identity whenever `reconcileStory` or `refresh`
	// does, and those follow `client`, `queue` and `backendAutosave`; the `socket.onMessage`
	// subscription below is made once per CONNECTION, so anything it captured directly
	// would freeze at whatever the first render handed it. Reading through the ref is what
	// lets the callback keep being replaced while the socket is left alone.
	const handlerRef = React.useRef(handleServerEvent);

	handlerRef.current = handleServerEvent;

	React.useEffect(() => {
		setPresence(current =>
			current.selfId === (backendClientId ?? '')
				? current
				: {...current, selfId: backendClientId ?? ''}
		);
	}, [backendClientId]);

	React.useEffect(() => {
		if (!backendUrl || !backendToken || !backendClientId) {
			setSocketConnected(false);
			setPresence(presenceDisconnected);
			return;
		}

		const socket = createEventsSocket({
			clientId: backendClientId,
			clientName,
			stories: () =>
				storiesRef.current
					.filter(story => story.sync === true)
					.map(story => story.id),
			token: backendToken,
			url: backendUrl
		});

		socketRef.current = socket;

		const offMessage = socket.onMessage(message => handlerRef.current(message));
		const offStatus = socket.onStatus(next => {
			setSocketConnected(next);

			if (!next) {
				// Presence that cannot be refreshed is worse than none: a banner naming
				// someone who left twenty minutes ago is a lie the user cannot check.
				setPresence(presenceDisconnected);
				return;
			}

			// Say where we are again. The editor almost always opens a passage before the
			// handshake finishes, and after a reconnect the hub has forgotten us entirely
			// — either way, without this the author holds a lock nobody can see.
			const focus = focusRef.current;

			if (focus) {
				socket.send({passage: focus.passage, story: focus.story, t: 'focus'});
			}
		});

		socket.connect();

		return () => {
			offMessage();
			offStatus();
			socket.dispose();

			if (socketRef.current === socket) {
				socketRef.current = undefined;
			}
		};
	}, [backendClientId, backendToken, backendUrl, clientName]);

	const focusPassage = React.useCallback(
		(storyId: string, passageId: string | null) => {
			focusRef.current = {passage: passageId, story: storyId};
			socketRef.current?.send({
				passage: passageId,
				story: storyId,
				t: 'focus'
			});
		},
		[]
	);

	const blurPassage = React.useCallback(
		(storyId: string, passageId: string | null) => {
			const focus = focusRef.current;

			if (focus && focus.story === storyId && focus.passage === passageId) {
				// Closing a passage leaves the author in the story map, and the hub reads
				// it the same way. Forgetting the story here instead would cost this
				// browser its place on the story-list card after any reconnect.
				focusRef.current =
					passageId === null ? undefined : {passage: null, story: storyId};
			}

			socketRef.current?.send({passage: passageId, story: storyId, t: 'blur'});
		},
		[]
	);

	const stealPassage = React.useCallback(
		(storyId: string, passageId: string) => {
			// No optimistic local state: the hub echoes `stolen` back to the stealer too,
			// so both banners are driven by the same message on the same code path.
			socketRef.current?.send({passage: passageId, story: storyId, t: 'steal'});
		},
		[]
	);

	// The hub expires a silent client after 60 s. That is the backstop for a closed
	// laptop; for a closed tab, saying so is instant and costs one frame.
	React.useEffect(() => {
		const release = () => {
			const focus = focusRef.current;

			if (focus) {
				socketRef.current?.send({
					passage: focus.passage,
					story: focus.story,
					t: 'blur'
				});
			}
		};

		window.addEventListener('pagehide', release);
		window.addEventListener('beforeunload', release);

		return () => {
			window.removeEventListener('pagehide', release);
			window.removeEventListener('beforeunload', release);
		};
	}, []);

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

			// Claim the hash before the PUT, not after: `sync: true` has just gone into
			// the store, so the watcher is about to see a change and queue a push. With a
			// blank hash that push would send this very body a second time — a wasted rev,
			// a burnt slot of the keep-N history, and a second row in the history dialog.
			//
			// `deleteSyncRecord` first, because this lowers a rev on purpose: the PUT
			// below carries no `If-Match` and overwrites whatever is on the server, so
			// anything this browser thought it knew is void. Records are monotonic in
			// `rev` (`sync-record.ts`), so a reset has to be said out loud — dropping the
			// record and minting it is that escape, and `checkoutStory` uses the same one.
			deleteSyncRecord(target.id);
			updateSyncRecord(target.id, {
				pushedHash: storyHash(target),
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
				// The claim above was optimistic; hand it back so the next edit retries.
				updateSyncRecord(target.id, {
					lastError: error instanceof Error ? error.message : String(error),
					pushedHash: '',
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

	const clientsIn = React.useCallback(
		(storyId: string) => clientsInStory(presence, storyId),
		[presence]
	);

	const lock = React.useCallback(
		(storyId: string, passageId: string) =>
			passageLock(presence, storyId, passageId),
		[presence]
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
			blurPassage,
			client,
			clientsIn,
			connected,
			focusPassage,
			ghosts,
			index,
			lastError,
			lock,
			presence,
			progress,
			pullAssets,
			records,
			socketConnected,
			stealPassage
		}),
		[
			blurPassage,
			checkout,
			client,
			clientsIn,
			connected,
			focusPassage,
			ghosts,
			index,
			lastError,
			lock,
			presence,
			progress,
			publish,
			pullAssets,
			records,
			refresh,
			removeFromServer,
			republish,
			resolveKeepMine,
			resolveTakeTheirs,
			setSync,
			socketConnected,
			stealPassage
		]
	);

	// The Playwright suite polls this instead of guessing at timings. Cheap enough to
	// leave on in production, and it makes a bug report reproducible.
	React.useEffect(() => {
		(globalThis as Record<string, unknown>).__slidersSync = {
			connected,
			ghosts,
			presence: presence.clients,
			records,
			socketConnected
		};
	}, [connected, ghosts, presence, records, socketConnected]);

	return value;
}
