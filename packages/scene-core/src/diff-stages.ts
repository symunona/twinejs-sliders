/**
 * `diffStages` — the heart of the whole design.
 *
 * Authors write declarative snapshots; the engine derives the animation. If this function
 * is wrong, "paste a block anywhere and get the same stage" stops being true.
 *
 * The transitions are hints for the renderer. `Renderer.apply(stage, transitions)` always
 * receives the full target stage too, so a missing transition means "snap", never "wrong".
 */

import type {
	Camera,
	Stage,
	StageEntity,
	StageFx,
	StageSound,
	Transition,
	Vec2
} from '@sliders/scene-types';

/** Seconds. Deliberately in one place so a renderer or theme can override them. */
export const DEFAULT_DURATIONS: Record<Transition['kind'], number> = {
	bg: 0.5,
	camera: 0.5,
	enter: 0.3,
	exit: 0.3,
	flip: 0.15,
	frame: 0.15,
	fx: 0.3,
	move: 0.3,
	// A bed crossfades rather than cuts. Longer than anything visual on purpose: a picture
	// that takes a second to change looks broken, and music that changes in a tenth of one
	// sounds like a mistake.
	music: 1.5,
	scale: 0.3
};

/**
 * What a `move` transition carries: everything that places an entity in space.
 *
 * `scale` is deliberately NOT in here. Size is its own transition kind, like `flip` and
 * `frame`, so a renderer can time a resize separately from a walk across the stage.
 */
export interface Placement {
	at: Vec2;
	z?: number;
	opacity: number;
}

function placementOf(entity: StageEntity): Placement {
	return {
		at: {x: entity.at.x, y: entity.at.y},
		opacity: entity.opacity,
		z: entity.z
	};
}

function sameVec(a: Vec2, b: Vec2): boolean {
	return a.x === b.x && a.y === b.y;
}

/**
 * What the sprite is drawing, pose and cycle together.
 *
 * A cycle carries its first step in `frame`, so `frame: idle` -> `frame: [idle, blink]`
 * leaves that string alone while the sprite starts moving. Comparing the whole thing is
 * what makes that a `frame` transition, which is the one the renderer cross-fades and
 * restarts the cycle on.
 */
function frameKey(entity: StageEntity): string {
	return entity.frames
		? `${entity.frame ?? ''}\u0000${entity.frameLoop ?? ''}\u0000${JSON.stringify(
				entity.frames
		  )}`
		: entity.frame ?? '';
}

function samePlacement(a: StageEntity, b: StageEntity): boolean {
	return (
		sameVec(a.at, b.at) &&
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

		if (before.scale !== after.scale) {
			out.push({
				duration: DEFAULT_DURATIONS.scale,
				entityId: id,
				from: before.scale,
				kind: 'scale',
				to: after.scale
			});
		}

		if (frameKey(before) !== frameKey(after)) {
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

	// The bed. Compared by id AND volume, so turning the same track down is a transition and
	// re-declaring the same track at the same volume is not — walking from scene to scene
	// under one piece of music must not restart it.
	if (!sameSound(prev.music, next.music)) {
		out.push({
			duration: DEFAULT_DURATIONS.music,
			from: prev.music ? {...prev.music} : undefined,
			kind: 'music',
			to: next.music ? {...next.music} : undefined
		});
	}

	return out;
}

function sameSound(
	a: StageSound | undefined,
	b: StageSound | undefined
): boolean {
	if (!a || !b) {
		return a === b;
	}

	return a.id === b.id && a.amount === b.amount;
}

/**
 * Re-time a beat's transitions to its `dur:`.
 *
 * Deliberately NOT a third argument to `diffStages`. WHAT changed is a function of two
 * stages and nothing else — that is the promise at the top of this file and the reason the
 * differ is testable at all. HOW LONG it takes is the caller's question, because only the
 * caller knows which beat produced the change, and the scene-entry diff is produced by no
 * beat at all.
 *
 * Every kind is re-timed, `bg` and `camera` included: `dur:` means "this beat IS the
 * animation", so a beat that also swaps the backdrop crossfades over the same span rather
 * than running to its own clock.
 */
export function timeTransitions(
	transitions: Transition[],
	seconds: number | undefined
): Transition[] {
	if (seconds === undefined) {
		return transitions;
	}

	const duration = Math.max(0, seconds);

	return transitions.map(transition => ({...transition, duration}));
}
