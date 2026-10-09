/**
 * The one rename flow every asset and character rename runs through.
 *
 * Scenes ALWAYS follow a rename: a name the scenes keep writing after the art moved is a
 * broken scene, and nobody asked for one. So the only question left is REACH, and it only
 * exists for shared art:
 *
 * | the art is | asks | then |
 * |---|---|---|
 * | this story's own (used or not) | nothing | rename, scenes follow |
 * | shared | Rename Everywhere / Rename Just Here | scope `all` / `fork`, scenes follow |
 *
 * Everywhere also rewrites the other stories on this device (the caller knows which).
 * Just Here forks a copy under the new name, so the other stories keep the old one.
 */

import type {SharedInfo} from '../store/asset-library/story-asset-store';
import type {Passage} from '../store/stories/stories.types';
import {renameSceneRefs} from './rename-scene-refs';

/** `now`: rename without a word. `ask`: one question first, about reach. */
export type RenameStep = 'now' | 'ask';

/** Worked out BEFORE the rename runs, so the author is asked once or not at all. */
export function planRename(info: SharedInfo | undefined): RenameStep {
	return info?.shared ? 'ask' : 'now';
}

/**
 * The passage updates a rename needs: only the passages whose text actually changes.
 *
 * `rewrite` is `renameSceneRefs` for art (entity keys plus `bg:`, `fx:`, sounds) and
 * `renameSceneCharacter` for a character, which never names a backdrop.
 */
export function sceneRenames(
	passages: Pick<Passage, 'id' | 'text'>[],
	oldName: string,
	newName: string,
	rewrite: (text: string, oldName: string, newName: string) => string = renameSceneRefs
): Record<string, {text: string}> {
	const updates: Record<string, {text: string}> = {};

	for (const passage of passages) {
		const text = rewrite(passage.text, oldName, newName);

		if (text !== passage.text) {
			updates[passage.id] = {text};
		}
	}

	return updates;
}
