/**
 * "Add to current scene" from the Particles dialog. The dialog knows the emitter, the scene
 * editor knows the scene: an editable scene editor registers an adder here while mounted,
 * the dialog calls it. Last registered wins (the scene editor opened most recently).
 *
 * Module level, like `particle-focus.ts`: the two are sibling dialogs, no shared React
 * parent to carry a callback.
 */

import * as React from 'react';

/** Adds an emitter (asset name) to the scene, selects it. One undo step. */
export type ParticleSceneAdder = (ref: string) => void;

const targets: ParticleSceneAdder[] = [];
const listeners = new Set<() => void>();

function changed() {
	for (const listener of [...listeners]) {
		listener();
	}
}

export function registerParticleSceneTarget(add: ParticleSceneAdder): () => void {
	targets.push(add);
	changed();

	return () => {
		const index = targets.lastIndexOf(add);

		if (index !== -1) {
			targets.splice(index, 1);
			changed();
		}
	};
}

export function hasParticleSceneTarget(): boolean {
	return targets.length > 0;
}

/** False when no scene editor is open to take it. */
export function addParticleToScene(ref: string): boolean {
	const add = targets[targets.length - 1];

	if (!add) {
		return false;
	}

	add(ref);

	return true;
}

/** Is a scene editor open to add to? Re-renders when one opens or closes. */
export function useParticleSceneTarget(): boolean {
	const [has, setHas] = React.useState(hasParticleSceneTarget);

	React.useEffect(() => {
		const listener = () => setHas(hasParticleSceneTarget());

		listeners.add(listener);
		listener();

		return () => {
			listeners.delete(listener);
		};
	}, []);

	return has;
}

/** Tests only. */
export function resetParticleSceneTargets(): void {
	targets.length = 0;
	changed();
}
