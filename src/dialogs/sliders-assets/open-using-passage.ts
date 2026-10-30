/**
 * Ctrl/Cmd-click on a Library tile: show a scene that uses this art in the passage editor.
 *
 * ONLY when a passage editor is already open. The Library is where an author goes to
 * look at art, and a click that pops an editor open would be a surprise there; with one
 * already open the author is writing, and "where is this used?" is a question about the
 * text in front of them. No editor = the click stays whatever it was before.
 *
 * Repeated clicks walk the passages that use it: the editor in front already showing one
 * of them moves to the next, in story order, wrapping.
 */

import * as React from 'react';
import type {Story} from '../../store/stories';
import {useStoriesContext} from '../../store/stories';
import {addPassageEditors, useDialogsContext} from '../context';
import type {DialogsState} from '../dialogs.types';
import {PassageEditStack} from '../passage-edit';

/**
 * The passage a Ctrl-click should bring up, or undefined when it should do nothing: no
 * passage editor open for this story, or nothing uses the art.
 */
export function usingPassageTarget(
	dialogs: DialogsState,
	story: Story | undefined,
	usedIn: string[] | undefined
): string | undefined {
	if (!story || !usedIn || usedIn.length === 0) {
		return;
	}

	const stack = dialogs.find(
		dialog =>
			dialog.component === PassageEditStack &&
			dialog.props?.storyId === story.id
	);

	if (!stack) {
		return;
	}

	// `usedIn` holds the names the scenes were found under, so this is store identity, not
	// link resolution.
	const ids = usedIn
		.map(
			name =>
				// eslint-disable-next-line no-restricted-syntax -- names straight off `story.passages`, not a link the author typed.
				story.passages.find(passage => passage.name === name)?.id
		)
		.filter((id): id is string => !!id);

	if (ids.length === 0) {
		return;
	}

	const front: string | undefined = stack.props?.passageIds?.[0];
	const at = front ? ids.indexOf(front) : -1;

	return ids[(at + 1) % ids.length];
}

/**
 * True when the click lands on one of the tile's own controls (buttons in the bar, the
 * rename or tag prompt). Those keep their meaning under Ctrl too.
 */
function onTileControl(target: EventTarget) {
	return (
		target instanceof Element &&
		!!target.closest('.button-bar, input, textarea, select, .card-button-card')
	);
}

/**
 * Makes a tile's click-capture handler. A plain click, a click on the tile's controls, or a
 * Ctrl-click with nothing to show passes straight through.
 */
export function useOpenUsingPassage() {
	const {dialogs, dispatch} = useDialogsContext();
	const {stories} = useStoriesContext();

	return React.useCallback(
		(storyId: string, usedIn: string[] | undefined) =>
			(event: React.MouseEvent) => {
				if (!(event.ctrlKey || event.metaKey) || onTileControl(event.target)) {
					return;
				}

				const story = stories.find(candidate => candidate.id === storyId);
				const passageId = usingPassageTarget(dialogs, story, usedIn);

				if (!story || !passageId) {
					return;
				}

				// Taken: the tile's own click (the character art opens its editor) must not
				// also run.
				event.preventDefault();
				event.stopPropagation();
				dispatch(addPassageEditors(story.id, [passageId]));

				const index = dialogs.findIndex(
					dialog => dialog.component === PassageEditStack
				);

				if (index !== -1 && dialogs[index].collapsed) {
					dispatch({type: 'setDialogCollapsed', collapsed: false, index});
				}
			},
		[dialogs, dispatch, stories]
	);
}
