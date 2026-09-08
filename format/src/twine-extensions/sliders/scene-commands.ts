/**
 * The Scene menu's commands. The static ones are plain text insertions and are folded
 * into Chapbook's own insert-text commands; the two that read the last-scene handoff need
 * a function, because what they paste depends on what the author last edited.
 */

import {Editor} from 'codemirror';
import {readLastNamedScene, readLastScene} from './last-scene';
import {
	BEATS_SNIPPET,
	CAST_SNIPPET,
	LINKS_SNIPPET,
	SCENE_SKELETON,
	lastSceneSnippet,
	overlaySnippet
} from './skeletons';

/** Command name -> the text it inserts. */
export const sceneInsertText = {
	insertScene: SCENE_SKELETON,
	insertSceneBeats: BEATS_SNIPPET,
	insertSceneCast: CAST_SNIPPET,
	insertSceneLinks: LINKS_SNIPPET
};

/**
 * The two that depend on stored state. Both fall back to the full skeleton: a menu item
 * that does nothing reads as broken, and the skeleton is never the wrong answer.
 */
export const sceneCommands = {
	insertLastScene(editor: Editor) {
		const record = readLastScene();

		editor.replaceSelection(record ? lastSceneSnippet(record) : SCENE_SKELETON);
		editor.focus();
	},
	insertLastSceneOverlay(editor: Editor) {
		const record = readLastNamedScene();

		editor.replaceSelection(record ? overlaySnippet(record) : SCENE_SKELETON);
		editor.focus();
	}
};
