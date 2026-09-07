/**
 * Has the author closed the scene preview?
 *
 * The preview opens itself the first time a scene appears, because it used to be always
 * on and an author who never finds the button would think it had been taken away. Closing
 * it has to mean something, though, so the dismissal is remembered: the dialog comes back
 * only when it is asked for, from the Story toolbar or `scene.togglePreview`, and asking
 * for it clears the flag so the automatic opening resumes.
 *
 * One key, not per story: it is a working habit, the same way the stage lock and the grid
 * are (`sliders.preview.locked`, `sliders.preview.grid`).
 */
const DISMISSED_KEY = 'sliders.preview.dismissed';

export function scenePreviewDismissed(): boolean {
	return window.localStorage.getItem(DISMISSED_KEY) === 'true';
}

export function setScenePreviewDismissed(value: boolean): void {
	if (value) {
		window.localStorage.setItem(DISMISSED_KEY, 'true');
	} else {
		window.localStorage.removeItem(DISMISSED_KEY);
	}
}
