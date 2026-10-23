import {extractSceneBlock} from '@sliders/scene-index';
import * as React from 'react';
import {addPassageEditors, useDialogsContext} from '../../dialogs';
import {ScenePreviewDialog} from '../../dialogs/scene-preview';
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

export function usePassageChangeHandlers(story: Story) {
	const selectedPassages = React.useMemo(
		() => story.passages.filter(passage => passage.selected),
		[story.passages]
	);
	const {dispatch: undoableStoriesDispatch} = useUndoableStoriesContext();
	const {dispatch: dialogsDispatch} = useDialogsContext();

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
	 * A scene passage opens on its stage, large: the scene editor maximized, the `</>`
	 * editor beside it in the column. The `</>` editor still opens because it is what tells
	 * the preview which passage to show (see `usePublishScenePreview`); without it, an
	 * editor already open on another passage would keep the stage.
	 */
	const handleEditPassage = React.useCallback(
		(passage: Passage) =>
			dialogsDispatch((dispatch, state) => {
				addPassageEditors(story.id, [passage.id])(dispatch, state);

				if (!extractSceneBlock(passage.text)) {
					return;
				}

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
			}),
		[dialogsDispatch, story.id]
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
		(passage: Passage, exclusive: boolean) =>
			undoableStoriesDispatch(selectPassage(story, passage, exclusive)),
		[story, undoableStoriesDispatch]
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
