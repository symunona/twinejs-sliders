import {Thunk} from 'react-hook-thunk-reducer';
import {
	CreateStoryAction,
	StoriesState,
	Story,
	UpdateStoryAction
} from '../stories.types';
import {noteSyncReason} from '../../persistence/server/sync-reason';
import {storyFileName} from '../../../electron/shared';

export interface ImportStoriesOptions {
	/**
	 * Keep the ids of stories that are created, instead of minting new ones.
	 *
	 * Set by the bundle importer only. Assets are stored per story id, so the bundle's
	 * art has to be written under the id the story will actually have — which means the
	 * caller picks the id, before any of this runs. Stories that overwrite an existing one
	 * keep the existing id regardless; there is nothing to choose there.
	 */
	keepIds?: boolean;
}

/**
 * Imports stories, overwriting any stories with the same name.
 */
export function importStories(
	toImport: Story[],
	existingStories: Story[],
	options: ImportStoriesOptions = {}
): Thunk<StoriesState, CreateStoryAction | UpdateStoryAction> {
	toImport.forEach(importStory => {
		if (
			toImport.some(
				otherStory =>
					otherStory !== importStory &&
					storyFileName(otherStory) === storyFileName(importStory)
			)
		) {
			throw new Error(
				`Stories to import cannot have the same name: "${importStory.name}"`
			);
		}
	});

	return dispatch => {
		toImport.forEach(importStory => {
			const props: Partial<Story> = {...importStory};
			const existingStory = existingStories.find(
				s => storyFileName(s) === storyFileName(importStory)
			);

			// Remove the temp ID that was assigned to the new story, unless the caller
			// asked for it and the story is a new one.

			if (existingStory || !options.keepIds) {
				delete props.id;
			}

			// Do an update so that if something goes awry, we won't have deleted the
			// story. We need to update passage props so that their parent story ID is
			// set properly.

			if (existingStory) {
				if (props.passages) {
					props.passages = props.passages.map(passage => ({
						...passage,
						story: existingStory.id
					}));
				}

				// An import overwrites a whole story at once. Derived from the bytes that
				// reads as "+ Some Passage +93 more", which says nothing. See
				// `sync-reason.ts`.
				noteSyncReason(existingStory.id, 'import');
				dispatch({props, type: 'updateStory', storyId: existingStory.id});
			} else {
				// A new story only has an id here when the bundle importer picked one —
				// otherwise the reducer mints it and there is nothing yet to label.
				if (props.id) {
					noteSyncReason(props.id, 'import');
				}

				dispatch({props, type: 'createStory'});
			}
		});
	};
}
