import * as React from 'react';
import {SceneSidebarTabId} from './scene-sidebar';

/**
 * Selecting a particle emitter opens its Particles tab -- that is what an emitter is
 * clicked for. Stage press and layers row both land here, they only set the selection.
 *
 * `emitterId`: the single selected entity once its asset resolved as an emitter, else
 * undefined. Resolution is async, so the selection effect shows `selection` first and
 * this follows a render later.
 *
 * Fires on a NEW emitter only: the author picking another tab afterwards is left alone.
 * Links stays put, as for any selection. A selection moving off an emitter while the
 * Particles tab is open falls back to `selection` -- the tab is gone, and the sidebar
 * would otherwise land on its first tab. Deselecting is the selection effect's job.
 */
export function useParticleTab(
	emitterId: string | undefined,
	hasSelection: boolean,
	active: SceneSidebarTabId,
	setActive: (id: SceneSidebarTabId) => void
) {
	const activeRef = React.useRef(active);

	activeRef.current = active;

	React.useEffect(() => {
		if (!hasSelection) {
			return;
		}

		const current = activeRef.current;

		if (emitterId) {
			if (current !== 'particles' && current !== 'links') {
				setActive('particles');
			}
		} else if (current === 'particles') {
			setActive('selection');
		}
	}, [emitterId, hasSelection, setActive]);
}
