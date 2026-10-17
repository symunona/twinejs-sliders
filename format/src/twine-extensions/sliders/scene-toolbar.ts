/**
 * The Scene menu — the first menu in the passage toolbar, and the one thing that makes
 * this format's editor different from Chapbook's.
 *
 * The editor appends its own "Scene Help" item to whatever menu is labelled `Scene`
 * (`src/dialogs/passage-edit/story-format-toolbar.tsx`), so the label below is load
 * bearing. Renaming it silently removes the help button from the app.
 */

import {
	lastSceneLabel,
	readLastScene
} from './last-scene';

/** The label the editor looks for when it appends Scene Help. Do not rename. */
export const SCENE_MENU_LABEL = 'Scene';

export interface SceneMenuItem {
	type: string;
	label?: string;
	command?: string;
	disabled?: boolean;
}

export function sceneMenu(icon: string, disabled: boolean) {
	const last = readLastScene();

	return {
		type: 'menu',
		icon,
		label: SCENE_MENU_LABEL,
		disabled,
		items: [
			{type: 'button', label: 'Insert Empty Scene', command: 'insertEmptyScene'},
			{
				type: 'button',
				label: last
					? `Copy of Last Scene (${lastSceneLabel(last)})`
					: 'Copy of Last Scene',
				command: 'insertLastScene',
				disabled: !last
			},
			{
				type: 'button',
				label: last?.passageName
					? `From '${last.passageName}' (template)`
					: 'From Last Scene (template)',
				command: 'insertLastSceneOverlay',
				disabled: !last?.passageName
			},
			{type: 'separator'},
			{type: 'button', label: 'Full Skeleton (every key)', command: 'insertScene'},
			{type: 'button', label: 'Cast and Props', command: 'insertSceneCast'},
			{type: 'button', label: 'Beats', command: 'insertSceneBeats'},
			{type: 'button', label: 'Links', command: 'insertSceneLinks'}
		] as SceneMenuItem[]
	};
}
