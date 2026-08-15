/**
 * `applyScene` — the merge rule everything else rests on (spec 02).
 *
 *                     no `from:` (snapshot)     with `from:` (patch)
 *   key absent        REMOVED from the stage    INHERITED unchanged
 *   mira: {frame: x}  full definition           shallow-merged onto the inherited entity
 *   mira: ~           n/a                       explicitly REMOVED
 *   cast: !only {…}   n/a                       replaces the whole cast
 */

import {emptyStage} from '@sliders/scene-types';
import type {Scene, Stage, StageEntity} from '@sliders/scene-types';
import {
	CAMERA_DEFAULT,
	cloneCamera,
	cloneFx,
	cloneStage,
	cloneVec,
	materialize,
	mergePatch
} from './stage';

/**
 * Merge a scene onto a base stage.
 *
 * `base` is the stage named by `from:`. When the scene has no `from:` it is a complete
 * snapshot, so `base` is ignored entirely and the merge starts from an empty stage — which
 * is what makes a scene block copy-pasteable.
 */
export function applyScene(base: Stage, scene: Scene): Stage {
	const isPatch = scene.from !== undefined;
	const out: Stage = isPatch ? cloneStage(base) : emptyStage();

	// --- bg -----------------------------------------------------------------
	if (scene.bg === null) {
		out.bg = undefined;
	} else if (scene.bg !== undefined) {
		out.bg = scene.bg;
	}
	// absent + patch -> inherited (already cloned); absent + snapshot -> undefined.

	// --- camera -------------------------------------------------------------
	if (scene.camera) {
		if (!isPatch) {
			out.camera = cloneCamera(CAMERA_DEFAULT);
		}

		if (scene.camera.at !== undefined) {
			out.camera.at = cloneVec(scene.camera.at);
		}

		if (scene.camera.zoom !== undefined) {
			out.camera.zoom = scene.camera.zoom;
		}
	}

	// --- fx -----------------------------------------------------------------
	// A declared fx list replaces the inherited one wholesale; `fx: []` therefore clears it.
	if (scene.fx !== undefined) {
		out.fx = cloneFx(scene.fx);
	}

	// --- entities -----------------------------------------------------------
	if (isPatch && (scene.replaceCast || scene.replaceProps)) {
		for (const id of Object.keys(out.entities)) {
			const kind = out.entities[id].kind;

			if (
				(scene.replaceCast && kind === 'cast') ||
				(scene.replaceProps && kind === 'prop')
			) {
				delete out.entities[id];
			}
		}
	}

	for (const id of Object.keys(scene.entities)) {
		const patch = scene.entities[id];

		if (patch === null) {
			// Removal. In snapshot mode the entity was never there, so this is a no-op —
			// the parser has already flagged it as bad-value.
			delete out.entities[id];
			continue;
		}

		const inherited: StageEntity | undefined = out.entities[id];

		if (inherited === undefined) {
			out.entities[id] = materialize(id, patch);
		} else {
			const merged = mergePatch(inherited, patch);

			merged.kind = patch.kind;
			merged.ref = patch.ref;
			out.entities[id] = merged;
		}
	}

	return out;
}
