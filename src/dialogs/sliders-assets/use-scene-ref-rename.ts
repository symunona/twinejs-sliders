/**
 * Carrying the scenes along when a piece of art is renamed.
 *
 * Both places that rename an asset do it -- the tile in the asset browser and the image
 * editor's own title -- so the dispatch lives here rather than in either: one action for
 * the lot, so the whole rename is a single undo rather than one undo per passage.
 *
 * The rewrite itself is `sceneRenames` (see `rename-plan.ts`). A block with a YAML error
 * is left alone on purpose.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useStoriesContext} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {sceneRenames} from '../../util/rename-plan';
import {useAssetScope} from './asset-store-context';

/**
 * Rewrites every scene in this story that names `oldName`, plus the scenes of `others`
 * this device holds (Rename Everywhere on shared art). Returns how many passages of THIS
 * story changed.
 */
export type SceneRefRename = (
	oldName: string,
	newName: string,
	others?: {storyId: string}[]
) => number;

export function useSceneRefRename(): SceneRefRename {
	const storyId = useAssetScope();
	const {stories} = useStoriesContext();
	const {dispatch} = useUndoableStoriesContext();
	const {t} = useTranslation();
	const story = stories.find(candidate => candidate.id === storyId);

	return React.useCallback(
		(oldName, newName, others = []) => {
			const subjects = [
				story,
				...others.map(usage =>
					stories.find(candidate => candidate.id === usage.storyId)
				)
			];
			let count = 0;

			// One action per story, so each story's undo takes its whole rename back.
			subjects.forEach((subject, index) => {
				if (!subject || (index > 0 && subject === story)) {
					return;
				}

				const passageUpdates = sceneRenames(subject.passages, oldName, newName);
				const changed = Object.keys(passageUpdates).length;

				if (index === 0) {
					count = changed;
				}

				if (changed > 0) {
					dispatch(
						{passageUpdates, storyId: subject.id, type: 'updatePassages'},
						t('dialogs.slidersAssets.renameChange', {name: oldName})
					);
				}
			});

			return count;
		},
		[dispatch, stories, story, t]
	);
}
