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

/**
 * The last scene edited that had an `id:`. Kept apart because only a named scene can be
 * the target of a `from:` overlay, and the scenes an author writes in between — a pasted
 * copy, a quick anonymous stage — would otherwise erase the one thing an overlay needs.
 */
export const LAST_NAMED_SCENE_KEY = 'sliders-last-named-scene';

export interface LastSceneRecord {
	/** The scene block body, with the `[scene]` line itself removed. */
	text: string;
	/** The scene's `id:`, when it had one. An overlay needs it for `from:`. */
	id?: string;
	/** Entity ids, so an overlay can name the cast and props it inherits. */
	cast?: string[];
	props?: string[];
	/** Passage the scene was written in. Labels the menu item when there is no id. */
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

/** The last scene that can be a `from:` target, i.e. the last one with an id. */
export function readLastNamedScene(): LastSceneRecord | undefined {
	const record = readLastScene(LAST_NAMED_SCENE_KEY);

	return record?.id ? record : undefined;
}

/** What to call a stored scene in a menu item. */
export function lastSceneLabel(record: LastSceneRecord): string {
	return record.id ?? record.passageName ?? 'unnamed';
}
