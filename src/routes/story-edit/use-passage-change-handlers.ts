import * as React from 'react';
import {useDialogsContext} from '../../dialogs';
import {
	ScenePreviewDialog,
	setScenePreviewDismissed
} from '../../dialogs/scene-preview';
import {
	deselectPassage,
	movePassages,
	Passage,
	selectPassage,
	selectPassagesInRect,
	Story,
	updatePassage
} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {Point, Rect} from '../../util/geometry';
import {ScenePreviewSourceContext} from './scene-preview-source-context';

export function usePassageChangeHandlers(story: Story) {
	const selectedPassages = React.useMemo(
		() => story.passages.filter(passage => passage.selected),
		[story.passages]
	);
	const {dispatch: undoableStoriesDispatch} = useUndoableStoriesContext();
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {pickFromMap} = React.useContext(ScenePreviewSourceContext);

	const handleDeselectPassage = React.useCallback(
		(passage: Passage) =>
			undoableStoriesDispatch(deselectPassage(story, passage)),
		[story, undoableStoriesDispatch]
	);

	const handleDragPassages = React.useCallback(
		(change: Point) => {
			// Ignore tiny drags--they're probably caused by the user moving their
			// mouse slightly during double-clicking.

			if (Math.abs(change.left) < 1 && Math.abs(change.top) < 1) {
				return;
			}

			undoableStoriesDispatch(
				movePassages(
					story,
					story.passages.reduce<string[]>(
						(result, current) =>
							current.selected ? [...result, current.id] : result,
						[]
					),
					change.left / story.zoom,
					change.top / story.zoom
				),
				selectedPassages.length > 1
					? 'undoChange.movePassages'
					: 'undoChange.movePassages'
			);
		},
		[selectedPassages.length, story, undoableStoriesDispatch]
	);

	/**
	 * A passage opens on its stage, large: the scene editor maximized, whether or not the
	 * passage has a scene yet. The `</>` editor stays shut -- it is one click away in the
	 * preview's header. `pickFromMap` names this passage to the preview, so neither an
	 * editor open on another passage nor a wider selection keeps it off the stage.
	 */
	const handleEditPassage = React.useCallback(
		(passage: Passage) => {
			if (!passage.selected) {
				undoableStoriesDispatch(selectPassage(story, passage, true));
			}

			pickFromMap(passage.id);
			setScenePreviewDismissed(false);
			dialogsDispatch((dispatch, state) => {
				const index = state().findIndex(
					dialog => dialog.component === ScenePreviewDialog
				);

				if (index === -1) {
					dispatch({
						type: 'addDialog',
						component: ScenePreviewDialog,
						maximized: true,
						props: {storyId: story.id}
					});
				} else {
					dispatch({type: 'setDialogCollapsed', collapsed: false, index});
					dispatch({type: 'setDialogMaximized', maximized: true, index});
				}
			});
		},
		[dialogsDispatch, pickFromMap, story, undoableStoriesDispatch]
	);

	const handleRenamePassage = React.useCallback(
		(passage: Passage, name: string) =>
			// Don't create newly linked passages here, for the reason the toolbar's rename
			// button gives: the update would see the new links before it saw the new name.
			undoableStoriesDispatch(
				updatePassage(story, passage, {name}, {dontUpdateOthers: true})
			),
		[story, undoableStoriesDispatch]
	);

	const handleSelectPassage = React.useCallback(
		(passage: Passage, exclusive: boolean) => {
			undoableStoriesDispatch(selectPassage(story, passage, exclusive));
			// A click on the map means "this passage" to the preview too.
			pickFromMap(passage.id);
		},
		[pickFromMap, story, undoableStoriesDispatch]
	);

	const handleSelectRect = React.useCallback(
		(rect: Rect, additive: boolean) => {
			// The rect we receive is in screen coordinates--we need to convert to
			// logical ones.
			const logicalRect: Rect = {
				height: rect.height / story.zoom,
				left: rect.left / story.zoom,
				top: rect.top / story.zoom,
				width: rect.width / story.zoom
			};

			// This should not be undoable.
			undoableStoriesDispatch(
				selectPassagesInRect(
					story,
					logicalRect,
					additive ? selectedPassages.map(passage => passage.id) : []
				)
			);
		},
		[selectedPassages, story, undoableStoriesDispatch]
	);

	return {
		handleDeselectPassage,
		handleDragPassages,
		handleEditPassage,
		handleRenamePassage,
		handleSelectPassage,
		handleSelectRect
	};
}
