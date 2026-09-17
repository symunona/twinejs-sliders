/**
 * The auto-advance value "Insert Scene" seeds into the skeleton it writes.
 *
 * THIS IS A TEMPLATE SEED AND NOTHING ELSE. It is never read by the player, it never
 * changes how a scene already in the story plays, and a scene with no `autoAdvance:` in
 * its own text is unaffected by it. Changing it re-times nothing; it only changes what the
 * next Insert Scene types for you.
 *
 * localStorage rather than the prefs store because it is a scratch editor setting with no
 * business in a story file or on the sync wire. The key is `sliders.insertScene.*` and not
 * the `sliders.preview.*` the rest of the scene editor uses, deliberately: a reader of
 * either name should be in no doubt that this one touches the preview's behaviour not at
 * all.
 */

const KEY = 'sliders.insertScene.autoAdvance';

/**
 * Seconds, or `undefined` for "write no key and leave it to the reader".
 *
 * Anything unparseable reads as unset. A stored value is a string an author could have
 * edited by hand in devtools, and a skeleton is not worth a thrown error.
 */
export function insertSceneAutoAdvance(): number | undefined {
	const raw = window.localStorage.getItem(KEY);

	if (raw === null) {
		return undefined;
	}

	const seconds = Number(raw);

	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export function setInsertSceneAutoAdvance(seconds: number | undefined): void {
	if (seconds === undefined) {
		window.localStorage.removeItem(KEY);
	} else {
		window.localStorage.setItem(KEY, String(seconds));
	}
}
