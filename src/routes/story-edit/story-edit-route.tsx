import * as React from 'react';
import {useParams} from 'react-router-dom';
import {MainContent} from '../../components/container/main-content';
import {DocumentTitle} from '../../components/document-title/document-title';
import {DialogsContextProvider} from '../../dialogs';
import {AssetScopeProvider} from '../../dialogs/sliders-assets/asset-store-context';
import {lockedPassages} from '../../store/persistence/server/presence';
import {useServerSyncContext} from '../../store/persistence/server/use-server-sync';
import {usePrefsContext} from '../../store/prefs';
import {storyWithId} from '../../store/stories';
import {
	UndoableStoriesContextProvider,
	useUndoableStoriesContext
} from '../../store/undoable-stories';
import {MarqueeablePassageMap} from './marqueeable-passage-map';
import {PassageFuzzyFinder} from './passage-fuzzy-finder';
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
		handleSelectPassage,
		handleSelectRect
	} = usePassageChangeHandlers(story);
	const visibleZoom = useZoomTransition(story.zoom, mainContent.current);
	const sceneErrorCounts = useStorySceneErrors(story.passages);
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
		<div className="story-edit-route">
			<DocumentTitle title={story.name} />
			<StoryEditToolbar
				getCenter={getCenter}
				onOpenFuzzyFinder={() => setFuzzyFinderOpen(true)}
				story={story}
			/>
			<MainContent
				data-hotkey-scope="story-map"
				grabbable
				padded={false}
				ref={mainContent}
			>
				<MarqueeablePassageMap
					container={mainContent}
					errorCounts={sceneErrorCounts}
					formatName={story.storyFormat}
					formatVersion={story.storyFormatVersion}
					onDeselect={handleDeselectPassage}
					onDrag={handleDragPassages}
					onEdit={handleEditPassage}
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
	return (
		<AssetScopeProvider storyId={storyId}>
			<UndoableStoriesContextProvider>
				<DialogsContextProvider>
					<InnerStoryEditRoute />
				</DialogsContextProvider>
			</UndoableStoriesContextProvider>
		</AssetScopeProvider>
	);
};
