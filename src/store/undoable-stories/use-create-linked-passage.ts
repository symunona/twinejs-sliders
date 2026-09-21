import * as React from 'react';
import {Story} from '../stories';
import {useUndoableStoriesContext} from './undoable-stories-context';

/**
 * Creates the passage a link points at, for the two places that offer it: the ghost card
 * on the story map and the "create this passage" fix on a scene error. A scene's `links:`
 * is never auto-created the way `[[…]]` is--`to: Tav` is a complete link on every
 * keystroke, so creation is something the author asks for (see
 * `createNewlyLinkedPassages`).
 *
 * One helper so the two offers cannot drift on the undo label, on the name-already-exists
 * guard, or on where the card lands. The caller passes the rect--position AND size: the
 * ghost already has one, drawn on screen, and must be created at exactly that rect so the
 * card does not jump, which it would if the ghost were drawn with a scene preview and the
 * real passage came up small.
 */
export function useCreateLinkedPassage(story: Story) {
	const {dispatch} = useUndoableStoriesContext();

	return React.useCallback(
		(
			name: string,
			rect: {height?: number; left: number; top: number; width?: number}
		) => {
			if (story.passages.some(passage => passage.name === name)) {
				return;
			}

			dispatch(
				{
					type: 'createPassages',
					storyId: story.id,
					props: [{...rect, name}]
				},
				'undoChange.newPassage'
			);
		},
		[dispatch, story.id, story.passages]
	);
}
