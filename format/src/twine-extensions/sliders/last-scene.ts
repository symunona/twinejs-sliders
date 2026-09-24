/**
 * Reading the "last scene" handoff the editor writes.
 *
 * A format extension is handed a CodeMirror instance and nothing else — it cannot see
 * Twine's stores — so the editor drops the scene block an author last touched into
 * localStorage and this reads it back. THE WRITER IS
 * `src/dialogs/passage-edit/scene-preview/use-last-scene.ts`; both sides must agree on
 * the keys and the record shape below.
 */

/** The last scene edited, whatever it was. What "Insert Last Scene" pastes. */
export const LAST_SCENE_KEY = 'sliders-last-scene';

export interface LastSceneRecord {
	/** The scene block body, with the `[scene]` line itself removed. */
	text: string;
	/** Entity ids, so an overlay can name the cast and props it inherits. */
	cast?: string[];
	props?: string[];
	/** Passage the scene was written in. Its name is what a `from:` overlay points at. */
	passageName?: string;
	/** Epoch ms, so a stale record is obvious in devtools. */
	updated?: number;
}

/**
 * A stored scene, if there is a usable one. Everything here is defensive: the record was
 * written by another build of another app, and a toolbar that throws takes the whole
 * passage editor's toolbar with it.
 */
export function readLastScene(
	key: string = LAST_SCENE_KEY
): LastSceneRecord | undefined {
	let raw: string | null = null;

	try {
		raw = window.localStorage.getItem(key);
	} catch (error) {
		// Storage disabled. There is no handoff, which is not an error.
		return undefined;
	}

	if (!raw) {
		return undefined;
	}

	try {
		const parsed = JSON.parse(raw) as LastSceneRecord;

		if (!parsed || typeof parsed.text !== 'string' || parsed.text.trim() === '') {
			return undefined;
		}

		return parsed;
	} catch (error) {
		return undefined;
	}
}

/** What to call a stored scene in a menu item. */
export function lastSceneLabel(record: LastSceneRecord): string {
	return record.passageName ?? 'unnamed';
}
