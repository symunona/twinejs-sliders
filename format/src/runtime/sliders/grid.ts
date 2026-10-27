/**
 * The measuring grid over a test play's stage, and its switch in the backstage sidebar.
 *
 * Off unless the author turns it on: a test play is mostly for watching the scene, and a
 * grid that was always there sat on every frame of it. The choice is remembered across
 * test plays, like the editor's own grid (`sliders.preview.grid`), so an author measuring
 * a scene does not have to switch it back on after every Ctrl+Enter.
 *
 * Test mode only. A normal play has no sidebar, and `gridOn()` is false there whatever is
 * in storage.
 */

import {get} from '../state';

export const GRID_KEY = 'sliders.player.grid';

/** On `window` when the switch flips; every stage on the page follows it. */
export const GRID_EVENT = 'sliders-grid-change';

export function gridOn(): boolean {
	if (!get('config.testing')) {
		return false;
	}

	try {
		return window.localStorage.getItem(GRID_KEY) === 'true';
	} catch {
		return false;
	}
}

export function setGridOn(on: boolean): void {
	try {
		if (on) {
			window.localStorage.setItem(GRID_KEY, 'true');
		} else {
			window.localStorage.removeItem(GRID_KEY);
		}
	} catch {
		// Storage blocked: the switch still works for this play.
	}

	window.dispatchEvent(new CustomEvent(GRID_EVENT, {detail: {on}}));
}

/**
 * Puts the Grid switch at the top of the backstage sidebar, above its tabs. Called by
 * `backstage/init.ts` right after the sidebar is in the DOM.
 */
export function mountGridToggle(sidebar: HTMLElement): void {
	const content = sidebar.querySelector('.content');

	if (!content) {
		return;
	}

	const bar = document.createElement('div');
	const button = document.createElement('button');
	let on = gridOn();
	const update = () => {
		button.setAttribute('aria-pressed', String(on));
		button.textContent = on ? '▦ Grid: on' : '▦ Grid: off';
	};

	bar.className = 'sliders-backstage-tools';
	button.type = 'button';
	button.className = 'sliders-grid-toggle';
	button.title = 'Show the measuring grid over the stage';
	button.addEventListener('click', () => {
		on = !on;
		setGridOn(on);
		update();
	});
	update();
	bar.append(button);
	content.prepend(bar);
}
