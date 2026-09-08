/**
 * "Last scene" tracking.
 *
 * Whenever an author changes a passage's `[scene]` block, that block is stored
 * as the last scene. The story format's Scene toolbar menu reads it back, so
 * "Insert Last Scene" drops it into the next passage, and "Overlay on …" writes
 * a `from:` patch pointing at it.
 *
 * localStorage is the channel because format extensions cannot see anything of
 * Twine's — they are handed a CodeMirror instance and nothing else. The reader is
 * `format/src/twine-extensions/sliders/last-scene.ts`; both sides must agree on
 * the keys and the record shape below.
 */

import * as React from 'react';
import {extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';

/** The last scene edited, whatever it was. What "Insert Last Scene" pastes. */
export const LAST_SCENE_KEY = 'sliders-last-scene';

/**
 * The last scene edited that had an `id:`. Kept apart because only a named scene
 * can be the target of a `from:` overlay, and the scenes an author writes in
 * between — a pasted copy, a quick anonymous stage — would otherwise erase the
 * one thing an overlay needs.
 */
export const LAST_NAMED_SCENE_KEY = 'sliders-last-named-scene';

export interface LastSceneRecord {
	/** The scene block body, with the `[scene]` line itself removed. */
	text: string;
	/** The scene's `id:`, when it had one. An overlay needs it for `from:`. */
	id?: string;
	/** Entity ids, so an overlay can name the cast and props it inherits. */
	cast: string[];
	props: string[];
	/** Passage the scene was written in. Labels the menu item when there is no id. */
	passageName: string;
	/** Epoch ms, so a stale record is obvious in devtools. */
	updated: number;
}

/**
 * Store a passage's scene block as the last scene. Returns what was stored, or
 * undefined when the passage has no scene to store.
 *
 * A half-written scene is stored just like a finished one: the author is mid
 * keystroke, this runs debounced, and the last write is what they left behind.
 */
export function saveLastScene(
	passageText: string,
	passageName: string
): LastSceneRecord | undefined {
	const block = extractSceneBlock(passageText);

	if (!block || block.text.trim() === '') {
		return undefined;
	}

	const cast: string[] = [];
	const props: string[] = [];
	let id: string | undefined;

	try {
		const {scene} = parseScene(block.text);

		id = scene.id;

		for (const entityId of Object.keys(scene.entities)) {
			const patch = scene.entities[entityId];

			if (patch) {
				(patch.kind === 'cast' ? cast : props).push(entityId);
			}
		}
	} catch (error) {
		// The parser is best-effort and not supposed to throw, but the text is
		// worth keeping even if it did.
		console.warn('Could not parse the scene being tracked', error);
	}

	const record: LastSceneRecord = {
		cast,
		id,
		passageName,
		props,
		text: block.text,
		updated: Date.now()
	};

	try {
		const json = JSON.stringify(record);

		window.localStorage.setItem(LAST_SCENE_KEY, json);

		if (record.id) {
			window.localStorage.setItem(LAST_NAMED_SCENE_KEY, json);
		}
	} catch (error) {
		// Quota or a locked-down browser. Losing the handoff is not worth an
		// error dialog over the editor.
		console.warn('Could not store the last scene', error);
		return undefined;
	}

	return record;
}

/** A stored scene, if any. Exists for tests and for future editor-side use. */
export function readLastScene(
	key: string = LAST_SCENE_KEY
): LastSceneRecord | undefined {
	try {
		const raw = window.localStorage.getItem(key);

		return raw ? (JSON.parse(raw) as LastSceneRecord) : undefined;
	} catch (error) {
		return undefined;
	}
}

/**
 * Save the passage's scene block as the last scene as the author edits it.
 *
 * Opening a passage is not editing it — otherwise merely looking at an old
 * passage would replace the scene the author is actually working from — so the
 * text a passage arrives with is taken as a baseline and never stored.
 */
export function useLastSceneTracker(
	passageId: string,
	passageName: string,
	text: string,
	delay = 500
): void {
	const baseline = React.useRef<{passageId: string; text: string}>();

	React.useEffect(() => {
		if (baseline.current?.passageId !== passageId) {
			baseline.current = {passageId, text};
			return;
		}

		if (baseline.current.text === text) {
			return;
		}

		const timer = window.setTimeout(
			() => saveLastScene(text, passageName),
			delay
		);

		return () => window.clearTimeout(timer);
	}, [delay, passageId, passageName, text]);
}
