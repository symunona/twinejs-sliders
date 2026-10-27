import {initStateRecorder} from './state-recorder';
import {initStateSnapshots} from './state-snapshots';
import {initBackstageCustomElements} from './custom-elements/init';
import {initNotes} from './notes';
import {mountGridToggle} from '../sliders/grid';

/**
 * Initializes Chapbook's backstage functionality and adds the backstage UI to
 * the DOM.
 */
export function initBackstage() {
	initNotes();
	initStateRecorder();
	initStateSnapshots();
	initBackstageCustomElements();

	// Sliders: starts collapsed, so a test play opens on the scene and not on the
	// State tab; the arrow on the right edge opens it.
	const sidebar = document.createElement('backstage-sidebar');

	sidebar.setAttribute('collapsed', '');
	document.body.appendChild(sidebar);
	mountGridToggle(sidebar);
}
