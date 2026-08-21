import {Thunk} from 'react-hook-thunk-reducer';
import {
	CreateStoryAction,
	StoriesState,
	Story,
	UpdateStoryAction
} from '../stories.types';
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

				dispatch({props, type: 'updateStory', storyId: existingStory.id});
			} else {
				dispatch({props, type: 'createStory'});
			}
		});
	};
}
