import * as React from 'react';
import {useServerSyncContext} from '../persistence/server/use-server-sync';
import {passageWithId, storyWithId, updatePassage} from '../stories';
import {useUndoableStoriesContext} from '../undoable-stories';
import {
	PassageDoc,
	PassageDocRegistry,
	RegistryDeps
} from './passage-doc-registry';

export const PassageDocsContext = React.createContext<
	PassageDocRegistry | undefined
>(undefined);

PassageDocsContext.displayName = 'PassageDocs';

function findPassage(
	stories: ReturnType<typeof useUndoableStoriesContext>['stories'],
	storyId: string,
	passageId: string
) {
	try {
		const story = storyWithId(stories, storyId);

		return {passage: passageWithId(stories, storyId, passageId), story};
	} catch {
		return undefined;
	}
}

/**
 * The route's passage Docs. Sits above the dialog stack: passage editors and the scene
 * preview are both dialogs, and both hold the same Doc.
 *
 * Store, dispatch and the lock calls are read through refs. The undoable dispatch is
 * memoised on the stories state and reverses against the state it closed over (TRAPS), and
 * the registry outlives every render.
 */
export const PassageDocsProvider: React.FC = props => {
	const {dispatch, stories} = useUndoableStoriesContext();
	const {blurPassage, focusPassage} = useServerSyncContext();
	const live = React.useRef({blurPassage, dispatch, focusPassage, stories});

	live.current = {blurPassage, dispatch, focusPassage, stories};

	const [registry] = React.useState(() => {
		const deps: RegistryDeps = {
			claim: (storyId, passageId) =>
				live.current.focusPassage(storyId, passageId),
			commit(storyId, passageId, text) {
				const found = findPassage(live.current.stories, storyId, passageId);

				if (found) {
					live.current.dispatch(
						updatePassage(found.story, found.passage, {text})
					);
				}
			},
			storeText: (storyId, passageId) =>
				findPassage(live.current.stories, storyId, passageId)?.passage.text,
			unclaim: (storyId, passageId) =>
				live.current.blurPassage(storyId, passageId)
		};

		return new PassageDocRegistry(deps);
	});

	React.useEffect(() => registry.syncFromStore(), [registry, stories]);

	React.useEffect(() => {
		const flush = () => registry.flushAll();

		window.addEventListener('pagehide', flush);

		return () => {
			window.removeEventListener('pagehide', flush);
			flush();
		};
	}, [registry]);

	return (
		<PassageDocsContext.Provider value={registry}>
			{props.children}
		</PassageDocsContext.Provider>
	);
};

export function usePassageDocRegistry(): PassageDocRegistry {
	const registry = React.useContext(PassageDocsContext);

	if (!registry) {
		throw new Error('usePassageDocRegistry: no PassageDocsProvider');
	}

	return registry;
}

/**
 * Holds this passage's Doc for as long as the caller is mounted on it. Undefined for one
 * render after mount or a passage change, and for no passage at all.
 */
export function usePassageDoc(
	storyId: string | undefined,
	passageId: string | undefined
): PassageDoc | undefined {
	const registry = usePassageDocRegistry();
	const [handle, setHandle] = React.useState<PassageDoc>();

	React.useLayoutEffect(() => {
		if (!storyId || !passageId) {
			setHandle(undefined);
			return;
		}

		const acquired = registry.acquire(storyId, passageId);

		setHandle(acquired);

		return () => registry.release(acquired);
	}, [passageId, registry, storyId]);

	// A handle for a passage the caller has moved off of is a leftover.
	return handle?.passageId === passageId && handle?.storyId === storyId
		? handle
		: undefined;
}

function useSubscribed<T>(
	handle: PassageDoc | undefined,
	read: (handle: PassageDoc) => T
): T | undefined {
	const readRef = React.useRef(read);
	const [, bump] = React.useReducer((value: number) => value + 1, 0);

	readRef.current = read;

	React.useLayoutEffect(() => {
		if (!handle) {
			return;
		}

		let last = readRef.current(handle);

		// Catch anything between render and subscribe.
		bump();

		return handle.subscribe(() => {
			const next = readRef.current(handle);

			if (next !== last) {
				last = next;
				bump();
			}
		});
	}, [handle]);

	return handle ? read(handle) : undefined;
}

/** The Doc's text, live: every write, any origin. */
export function usePassageDocText(handle: PassageDoc | undefined) {
	return useSubscribed(handle, current => current.doc.getValue());
}

/** The `</>` editor attached to this Doc, if one is open. */
export function usePassageDocView(handle: PassageDoc | undefined) {
	return useSubscribed(handle, current => current.view());
}
