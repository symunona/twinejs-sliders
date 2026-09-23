/**
 * `applyScene` — the merge rule everything else rests on (spec 02).
 *
 *                     no `from:` (snapshot)     with `from:` (patch)
 *   key absent        REMOVED from the stage    INHERITED unchanged
 *   mira: {pose: x}   full definition           shallow-merged onto the inherited entity
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
 * The backdrop a scene names, with `id:` as the default (spec 02).
 *
 * A snapshot named `tavern-night` almost always wants the `tavern-night` backdrop, so
 * spelling it twice was the confusing part — the same shorthand `props:` already gets,
 * where the entity key doubles as the asset name. `bg:` still wins when present, and
 * `bg: ~` is how a scene says it genuinely has no backdrop.
 *
 * A patch (`from:`) is left alone: its id names the variant, not the art, so defaulting
 * there would demand a backdrop file per variant instead of inheriting the one it came
 * from.
 */
export function sceneBg(scene: Scene): string | null | undefined {
	if (scene.bg !== undefined || scene.from !== undefined) {
		return scene.bg;
	}

	const id = scene.id?.trim();

	return id === '' ? undefined : id;
}

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
	const bg = sceneBg(scene);

	if (bg === null) {
		out.bg = undefined;
		out.bgImplicit = undefined;
		out.bgFx = undefined;
	} else if (bg !== undefined) {
		out.bg = bg;
		out.bgImplicit = scene.bg === undefined ? true : undefined;
		// The motion is read off `bg`, not off its own absence — the same rule `mergePatch`
		// uses for a step list. A scene that names a backdrop states its motion in full,
		// so `bg: cellar` after an inherited parallax STOPS it; an `id:`-derived backdrop
		// (no `bg:` line at all) leaves an inherited motion alone, because it asked for
		// nothing.
		if (scene.bgFx !== undefined) {
			out.bgFx = {...scene.bgFx};
		} else if (scene.bg !== undefined) {
			out.bgFx = undefined;
		}
	}
	// absent + patch -> inherited (already cloned); absent + snapshot -> `id:` or undefined.

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

	// --- music ---------------------------------------------------------------
	// Three states, not two: absent inherits (a snapshot starts empty, so there it means
	// silence), `null` is `music: ~` and silences a patch's inherited bed, a value plays.
	// Same shape as `bg`.
	//
	// So a scene that wants music says so, every time, even mid-chapter. That looks like
	// repetition and is not: `diffStages` compares id AND volume, so re-declaring the same
	// track emits no transition and the bed plays straight through the passage change. The
	// alternative — music that carries over silently — cannot work, because the editor
	// previews ONE passage and would have no way to know what was playing before it.
	if (scene.music !== undefined) {
		out.music = scene.music === null ? undefined : {...scene.music};
	}

	// --- entities -----------------------------------------------------------
	if (isPatch && (scene.replaceCast || scene.replaceProps || scene.replaceEntities)) {
		for (const id of Object.keys(out.entities)) {
			const kind = out.entities[id].kind;

			if (
				// `entities: !only` names no kind, so it clears the whole stage.
				scene.replaceEntities ||
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

			// `auto` is "the parser could not tell". It must not overwrite a kind the base
			// scene stated outright, or an `entities:` patch over a `cast:` entry would
			// throw away what the snapshot already knew.
			merged.kind = patch.kind === 'auto' ? inherited.kind : patch.kind;
			merged.ref = patch.ref;
			out.entities[id] = merged;
		}
	}

	return out;
}
