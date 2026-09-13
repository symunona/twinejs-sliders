import {Thunk} from 'react-hook-thunk-reducer';
import {
	CreatePassagesAction,
	Passage,
	StoriesState,
	Story
} from '../stories.types';
import {newPassagePositions} from './new-passage-positions';
import {parseLinks} from '../../../util/parse-links';

/**
 * Creates newly linked passages from a passage. You shouldn't need to call this
 * directly--it will be invoked automatically by updatePassage() if you change
 * the passage text.
 *
 * Deliberately `parseLinks` and not `passageLinks`: a scene's `links:` entries are NOT
 * auto-created. `[[…]]` has a closing delimiter, so a link only exists once the author
 * has finished typing it, but YAML `to: Tavern` is complete on every keystroke — this
 * would spawn `T`, `Ta`, `Tav`… as the author types, and `deleteOrphanedPassages` would
 * then delete off any typo. Scene link targets get an explicit "Create passage" fix in
 * the passage editor's error list instead (see
 * `dialogs/passage-edit/scene-errors/scene-errors.tsx`).
 */
export function createNewlyLinkedPassages(
	story: Story,
	passage: Passage,
	newText: string,
	oldText: string
): Thunk<StoriesState, CreatePassagesAction> {
	if (!story.passages.some(p => p.id === passage.id)) {
		throw new Error('This passage does not belong to this story.');
	}

	return dispatch => {
		const oldLinks = parseLinks(oldText);
		const toCreate = parseLinks(newText).filter(
			l => !oldLinks.includes(l) && !story.passages.some(p => p.name === l)
		);

		if (toCreate.length === 0) {
			return;
		}

		const positions = newPassagePositions(story, passage, toCreate.length);

		dispatch({
			type: 'createPassages',
			storyId: story.id,
			props: toCreate.map((name, index) => ({...positions[index], name}))
		});
	};
}
