import * as React from 'react';
import {useParams} from 'react-router-dom';
import {MainContent} from '../../components/container/main-content';
import {DocumentTitle} from '../../components/document-title/document-title';
import {DialogsContextProvider} from '../../dialogs';
import {AssetScopeProvider} from '../../dialogs/sliders-assets/asset-store-context';
import {lockedPassages} from '../../store/persistence/server/presence';
import {useServerSyncContext} from '../../store/persistence/server/use-server-sync';
import {usePrefsContext} from '../../store/prefs';
import {Passage, storyWithId} from '../../store/stories';
import {brokenLinkGhosts} from '../../util/broken-link-ghosts';
import {
	UndoableStoriesContextProvider,
	useCreateLinkedPassage,
	useUndoableStoriesContext
} from '../../store/undoable-stories';
import {MarqueeablePassageMap} from './marqueeable-passage-map';
import {PassageFuzzyFinder} from './passage-fuzzy-finder';
import {ScenePreviewAutoOpen} from './scene-preview-auto-open';
import {ScenePreviewSourceProvider} from './scene-preview-source-context';
import {StoryEditToolbar} from './toolbar';
import {useInitialPassageCreation} from './use-initial-passage-creation';
import {usePassageChangeHandlers} from './use-passage-change-handlers';
import {useStorySceneErrors} from './use-story-scene-errors';
import {useViewCenter} from './use-view-center';
import {useZoomShortcuts} from './use-zoom-shortcuts';
import {useZoomTransition} from './use-zoom-transition';
import './story-edit-route.css';

export const InnerStoryEditRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {prefs} = usePrefsContext();
	const {stories} = useUndoableStoriesContext();
	const story = storyWithId(stories, storyId);
	const [fuzzyFinderOpen, setFuzzyFinderOpen] = React.useState(false);
	const mainContent = React.useRef<HTMLDivElement>(null);
	const {getCenter, setCenter} = useViewCenter(story, mainContent);
	const {
		handleDeselectPassage,
		handleDragPassages,
		handleEditPassage,
		handleRenamePassage,
		handleSelectPassage,
		handleSelectRect
	} = usePassageChangeHandlers(story);
	const visibleZoom = useZoomTransition(story.zoom, mainContent.current);
	const sceneErrorCounts = useStorySceneErrors(story.passages);
	// Links with no passage behind them, drawn as dashed placeholders. A scene's `links:`
	// cannot auto-create the way `[[…]]` does, so this is how an author gets from a link
	// to the passage it names.
	const ghosts = React.useMemo(() => brokenLinkGhosts(story), [story]);
	const createLinkedPassage = useCreateLinkedPassage(story);
	const handleCreateGhost = React.useCallback(
		// Created at the rect it was drawn at, so the card does not jump on click.
		(ghost: Passage) =>
			createLinkedPassage(ghost.name, {
				height: ghost.height,
				left: ghost.left,
				top: ghost.top,
				width: ghost.width
			}),
		[createLinkedPassage]
	);
	const {blurPassage, focusPassage, presence} = useServerSyncContext();
	// Passage id -> the other editor holding it. Empty with no socket, and the map draws
	// exactly as it always has.
	const passageLocks = React.useMemo(
		() => lockedPassages(presence, story.id),
		[presence, story.id]
	);

	// Being in the story map at all is presence too -- it is what puts an initial on the
	// story-list card. A null passage is what says "here, but not in anything".
	React.useEffect(() => {
		focusPassage(storyId, null);

		return () => blurPassage(storyId, null);
	}, [blurPassage, focusPassage, storyId]);

	useZoomShortcuts(story);
	useInitialPassageCreation(story, getCenter);

	return (
		// The scope covers the toolbar as well as the map: the shortcuts that open the
		// asset manager, the character editor and the scene preview are all on toolbar
		// buttons, and clicking one of those leaves focus there. With the scope on the
		// map alone, the next keystroke resolves to `global` and the key looks dead.
		<div className="story-edit-route" data-hotkey-scope="story-map">
			<DocumentTitle title={story.name} />
			<StoryEditToolbar
				getCenter={getCenter}
				onOpenFuzzyFinder={() => setFuzzyFinderOpen(true)}
				story={story}
			/>
			<MainContent grabbable padded={false} ref={mainContent}>
				<MarqueeablePassageMap
					container={mainContent}
					errorCounts={sceneErrorCounts}
					formatName={story.storyFormat}
					formatVersion={story.storyFormatVersion}
					ghosts={ghosts}
					onCreateGhost={handleCreateGhost}
					onDeselect={handleDeselectPassage}
					onDrag={handleDragPassages}
					onEdit={handleEditPassage}
					onRename={handleRenamePassage}
					onSelect={handleSelectPassage}
					onSelectRect={handleSelectRect}
					passageLocks={passageLocks}
					passages={story.passages}
					startPassageId={story.startPassage}
					tagColors={story.tagColors}
					tagDisplay={prefs.passageTagDisplay}
					visibleZoom={visibleZoom}
					zoom={story.zoom}
				/>
				<PassageFuzzyFinder
					onClose={() => setFuzzyFinderOpen(false)}
					onOpen={() => setFuzzyFinderOpen(true)}
					open={fuzzyFinderOpen}
					setCenter={setCenter}
					story={story}
				/>
			</MainContent>
		</div>
	);
};

// This is a separate component so that the inner one can use
// `useDialogsContext()` and `useUndoableStoriesContext()` inside it.

export const StoryEditRoute: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();

	// Assets belong to the story being edited, and every asset dialog opens from this
	// route, so the scope is set once, here, above the dialog stack.
	// The scene preview is one dialog for the whole route, not one per passage editor. The
	// registry it reads sits ABOVE the dialogs, because the publishers are passage editors
	// that `DialogsContextProvider` renders itself.
	return (
		<AssetScopeProvider storyId={storyId}>
			<UndoableStoriesContextProvider>
				<ScenePreviewSourceProvider>
					<DialogsContextProvider>
						<InnerStoryEditRoute />
						<ScenePreviewAutoOpen storyId={storyId} />
					</DialogsContextProvider>
				</ScenePreviewSourceProvider>
			</UndoableStoriesContextProvider>
		</AssetScopeProvider>
	);
};
