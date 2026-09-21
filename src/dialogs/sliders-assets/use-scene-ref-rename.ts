/**
 * Carrying the scenes along when a piece of art is renamed.
 *
 * Both places that rename an asset offer it -- the tile in the asset browser and the image
 * editor's own title -- so the dispatch lives here rather than in either: one action for
 * the lot, so the whole rename is a single undo rather than one undo per passage.
 *
 * The rewrite itself is `renameSceneRefs`. This only decides which passages actually
 * change, which is not the same as which passages `useAssetUsage` lists: a block with a
 * YAML error is left alone on purpose.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useStoriesContext} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {renameSceneRefs} from '../../util/rename-scene-refs';
import {useAssetScope} from './asset-store-context';

/** Rewrites every scene that names `oldName`. Returns how many passages changed. */
export type SceneRefRename = (oldName: string, newName: string) => number;

export function useSceneRefRename(): SceneRefRename {
	const storyId = useAssetScope();
	const {stories} = useStoriesContext();
	const {dispatch} = useUndoableStoriesContext();
	const {t} = useTranslation();
	const story = stories.find(candidate => candidate.id === storyId);

	return React.useCallback(
		(oldName, newName) => {
			if (!story) {
				return 0;
			}

			const passageUpdates: Record<string, {text: string}> = {};

			for (const passage of story.passages) {
				const text = renameSceneRefs(passage.text, oldName, newName);

				if (text !== passage.text) {
					passageUpdates[passage.id] = {text};
				}
			}

			const count = Object.keys(passageUpdates).length;

			if (count > 0) {
				dispatch(
					{passageUpdates, storyId: story.id, type: 'updatePassages'},
					t('dialogs.slidersAssets.renameChange', {name: oldName})
				);
			}

			return count;
		},
		[dispatch, story, t]
	);
}
