/**
 * `diffStages` — the heart of the whole design.
 *
 * Authors write declarative snapshots; the engine derives the animation. If this function
 * is wrong, "paste a block anywhere and get the same stage" stops being true.
 *
 * The transitions are hints for the renderer. `Renderer.apply(stage, transitions)` always
 * receives the full target stage too, so a missing transition means "snap", never "wrong".
 */

import type {Camera, Stage, StageEntity, StageFx, Transition, Vec2} from '@sliders/scene-types';

/** Seconds. Deliberately in one place so a renderer or theme can override them. */
export const DEFAULT_DURATIONS: Record<Transition['kind'], number> = {
	bg: 0.5,
	camera: 0.5,
	enter: 0.3,
	exit: 0.3,
	flip: 0.15,
	frame: 0.15,
	fx: 0.3,
	move: 0.3
};

/** What a `move` transition carries: everything that places an entity in space. */
export interface Placement {
	at: Vec2;
	layer: StageEntity['layer'];
	z?: number;
	opacity: number;
}

function placementOf(entity: StageEntity): Placement {
	return {
		at: {x: entity.at.x, y: entity.at.y},
		layer: entity.layer,
		opacity: entity.opacity,
		z: entity.z
	};
}

function sameVec(a: Vec2, b: Vec2): boolean {
	return a.x === b.x && a.y === b.y;
}

function samePlacement(a: StageEntity, b: StageEntity): boolean {
	return (
		sameVec(a.at, b.at) &&
		a.layer === b.layer &&
		a.z === b.z &&
		a.opacity === b.opacity
	);
}

function sameCamera(a: Camera, b: Camera): boolean {
	return sameVec(a.at, b.at) && a.zoom === b.zoom;
}

function fxById(list: StageFx[]): Map<string, StageFx> {
	const map = new Map<string, StageFx>();

	for (const fx of list) {
		map.set(fx.id, fx);
	}

	return map;
}

/**
 * Every change needed to get from `prev` to `next`.
 *
 * Order is stable and deterministic: bg, camera, then entities by id (exits and enters
 * included), then fx by id. Nothing here depends on insertion order of the stage records.
 */
export function diffStages(prev: Stage, next: Stage): Transition[] {
	const out: Transition[] = [];

	if (prev.bg !== next.bg) {
		out.push({
			duration: DEFAULT_DURATIONS.bg,
			from: prev.bg,
			kind: 'bg',
			to: next.bg
		});
	}

	if (!sameCamera(prev.camera, next.camera)) {
		out.push({
			duration: DEFAULT_DURATIONS.camera,
			from: {at: {...prev.camera.at}, zoom: prev.camera.zoom},
			kind: 'camera',
			to: {at: {...next.camera.at}, zoom: next.camera.zoom}
		});
	}

	const ids = new Set<string>([
		...Object.keys(prev.entities),
		...Object.keys(next.entities)
	]);

	for (const id of [...ids].sort()) {
		const before = prev.entities[id];
		const after = next.entities[id];

		if (before === undefined && after !== undefined) {
			out.push({
				duration: DEFAULT_DURATIONS.enter,
				entityId: id,
				kind: 'enter',
				to: after
			});
			continue;
		}

		if (before !== undefined && after === undefined) {
			out.push({
				duration: DEFAULT_DURATIONS.exit,
				entityId: id,
				from: before,
				kind: 'exit'
			});
			continue;
		}

		if (before === undefined || after === undefined) {
			continue;
		}

		// A swapped ref (mira -> joren under the same id) is a replacement, not a move.
		if (before.ref !== after.ref || before.kind !== after.kind) {
			out.push({
				duration: DEFAULT_DURATIONS.exit,
				entityId: id,
				from: before,
				kind: 'exit'
			});
			out.push({
				duration: DEFAULT_DURATIONS.enter,
				entityId: id,
				kind: 'enter',
				to: after
			});
			continue;
		}

		if (!samePlacement(before, after)) {
			out.push({
				duration: DEFAULT_DURATIONS.move,
				entityId: id,
				from: placementOf(before),
				kind: 'move',
				to: placementOf(after)
			});
		}

		if (before.frame !== after.frame) {
			out.push({
				duration: DEFAULT_DURATIONS.frame,
				entityId: id,
				from: before.frame,
				kind: 'frame',
				to: after.frame
			});
		}

		if (before.flip !== after.flip) {
			out.push({
				duration: DEFAULT_DURATIONS.flip,
				entityId: id,
				from: before.flip,
				kind: 'flip',
				to: after.flip
			});
		}
	}

	const beforeFx = fxById(prev.fx);
	const afterFx = fxById(next.fx);
	const fxIds = new Set<string>([...beforeFx.keys(), ...afterFx.keys()]);

	for (const id of [...fxIds].sort()) {
		const before = beforeFx.get(id);
		const after = afterFx.get(id);

		if (before && after && before.amount === after.amount) {
			continue;
		}

		out.push({
			duration: DEFAULT_DURATIONS.fx,
			from: before ? {...before} : undefined,
			kind: 'fx',
			to: after ? {...after} : undefined
		});
	}

	return out;
}
