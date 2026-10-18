/**
 * `stageAt` — the stage partway through a beat, as a still picture.
 *
 * The renderer animates a beat with CSS transitions, so the in-between frames exist only in
 * the browser while it plays. The timing overlay wants them on demand: hover a moment of
 * the scene, see the stage at that moment. This computes it from the same two stages and
 * the same timed transitions the renderer is handed, so the scrubbed picture is the frame
 * the player would draw at that time.
 *
 * Continuous kinds (`move`, `scale`, `rot`, `camera`, an `enter`/`exit` fade) are eased and
 * interpolated. Discrete kinds (`pose`, `flip`, `grade`, `bg`, `fx`, `music`) are a
 * cross-fade in the renderer and switch at their midpoint here. Pure.
 */

import {cssEase} from '@sliders/scene-types';
import type {
	Camera,
	EntityId,
	Stage,
	StageEntity,
	Transition,
	TransitionKind,
	Vec2
} from '@sliders/scene-types';
import {cloneStage} from './stage';

const KEYWORD_EASES: Record<string, [number, number, number, number]> = {
	ease: [0.25, 0.1, 0.25, 1],
	'ease-in': [0.42, 0, 1, 1],
	'ease-in-out': [0.42, 0, 0.58, 1],
	'ease-out': [0, 0, 0.58, 1]
};

function bezier(
	[x1, y1, x2, y2]: [number, number, number, number],
	x: number
): number {
	const at = (a: number, b: number, s: number) =>
		3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
	let lo = 0;
	let hi = 1;
	let s = x;

	// Bisection: x(s) is monotonic for any legal curve (x1, x2 in 0..1). 30 rounds ~ 1e-9.
	for (let i = 0; i < 30; i++) {
		s = (lo + hi) / 2;

		if (at(x1, x2, s) < x) {
			lo = s;
		} else {
			hi = s;
		}
	}

	return at(y1, y2, s);
}

/** CSS `linear(…)`: stops with optional percentages, missing ones spread evenly. */
function linearStops(body: string, x: number): number {
	const stops = body.split(',').map(part => {
		const [value, at] = part.trim().split(/\s+/);

		return {
			at: at?.endsWith('%') ? parseFloat(at) / 100 : undefined,
			value: parseFloat(value)
		};
	});

	if (stops.length === 0 || stops.some(stop => Number.isNaN(stop.value))) {
		return x;
	}

	if (stops.length === 1) {
		return stops[0].value;
	}

	stops[0].at = stops[0].at ?? 0;
	stops[stops.length - 1].at = stops[stops.length - 1].at ?? 1;

	for (let i = 1; i < stops.length - 1; i++) {
		if (stops[i].at !== undefined) {
			continue;
		}

		let j = i;

		while (stops[j].at === undefined) {
			j++;
		}

		const from = stops[i - 1].at!;
		const step = (stops[j].at! - from) / (j - i + 1);

		for (let k = i; k < j; k++) {
			stops[k].at = from + step * (k - i + 1);
		}
	}

	for (let i = 1; i < stops.length; i++) {
		const a = stops[i - 1];
		const b = stops[i];

		if (x <= b.at! || i === stops.length - 1) {
			const span = b.at! - a.at!;

			return span > 0 ? a.value + ((b.value - a.value) * (x - a.at!)) / span : b.value;
		}
	}

	return x;
}

/**
 * How far along a CSS timing function is at `x` (0..1). `cubic-bezier`, `linear(…)` and the
 * CSS keywords; anything else is linear. May leave 0..1 — `back_out` overshoots.
 */
export function easeAt(css: string, x: number): number {
	const p = Math.min(1, Math.max(0, x));
	const token = css.trim();
	const keyword = KEYWORD_EASES[token];

	if (keyword) {
		return bezier(keyword, p);
	}

	const cubic = /^cubic-bezier\(([^)]*)\)$/.exec(token);

	if (cubic) {
		const n = cubic[1].split(',').map(parseFloat);

		return n.length === 4 && n.every(Number.isFinite)
			? bezier(n as [number, number, number, number], p)
			: p;
	}

	const linear = /^linear\((.*)\)$/.exec(token);

	return linear ? linearStops(linear[1], p) : p;
}

function lerp(a: number, b: number, p: number): number {
	return a + (b - a) * p;
}

function lerpVec(a: Vec2, b: Vec2, p: number): Vec2 {
	return {x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p)};
}

/**
 * The stage `t` seconds into a beat that goes from `before` to `after` by `transitions`
 * (`beatTransitions` output: timed and eased). Both stages RESOLVED, as the renderer takes
 * them. `t` past every transition's end is `after`.
 */
export function stageAt(
	before: Stage,
	after: Stage,
	transitions: Transition[],
	t: number
): Stage {
	const progress = (kind: TransitionKind, entityId?: EntityId): number => {
		const found = transitions.find(
			one => one.kind === kind && one.entityId === entityId
		);

		if (!found || found.duration <= 0) {
			return t >= 0 ? 1 : 0;
		}

		return easeAt(cssEase(found.ease, kind), t / found.duration);
	};
	// Raw (uneased) fraction for a cross-fade: switches at its midpoint in time.
	const switched = (kind: TransitionKind, entityId?: EntityId): boolean => {
		const found = transitions.find(
			one => one.kind === kind && one.entityId === entityId
		);

		return !found || found.duration <= 0 ? t >= 0 : t >= found.duration / 2;
	};
	const out = cloneStage(after);
	const from = cloneStage(before);

	if (!switched('bg')) {
		out.bg = from.bg;
		out.bgFx = from.bgFx;

		if (!out.bgFx) {
			delete out.bgFx;
		}
	}

	if (!switched('fx')) {
		out.fx = from.fx;
	}

	if (!switched('music')) {
		out.music = from.music;

		if (!out.music) {
			delete out.music;
		}
	}

	const camera = progress('camera');
	const cam: Camera = {
		at: lerpVec(from.camera.at, out.camera.at, camera),
		zoom: lerp(from.camera.zoom, out.camera.zoom, camera)
	};

	out.camera = cam;

	const entities: Record<EntityId, StageEntity> = {};
	const ids = [
		...Object.keys(out.entities),
		...Object.keys(from.entities).filter(id => !(id in out.entities))
	];

	for (const id of ids) {
		const a = from.entities[id];
		const b = out.entities[id];
		const replaced = !!a && !!b && (a.ref !== b.ref || a.kind !== b.kind);

		if (a && (!b || replaced)) {
			const gone = progress('exit', id);

			if (gone < 1) {
				entities[id] = {...a, opacity: a.opacity * (1 - gone)};
				continue;
			}

			if (!b) {
				continue;
			}
		}

		if (b && (!a || replaced)) {
			entities[id] = {...b, opacity: b.opacity * progress('enter', id)};
			continue;
		}

		if (!a || !b) {
			continue;
		}

		const move = progress('move', id);
		const scale = progress('scale', id);
		const rot = progress('rot', id);
		const entity: StageEntity = {
			...b,
			at: lerpVec(a.at, b.at, move),
			opacity: lerp(a.opacity, b.opacity, move),
			scale: lerp(a.scale, b.scale, scale)
		};

		if (a.z !== undefined && b.z !== undefined) {
			entity.z = lerp(a.z, b.z, move);
		}

		if (a.stretch || b.stretch) {
			entity.stretch = lerpVec(
				a.stretch ?? {x: 1, y: 1},
				b.stretch ?? {x: 1, y: 1},
				scale
			);
		}

		if ((a.rot ?? 0) !== (b.rot ?? 0)) {
			entity.rot = lerp(a.rot ?? 0, b.rot ?? 0, rot);
		}

		if (!switched('pose', id)) {
			entity.pose = a.pose;
			entity.steps = a.steps;
			entity.poseLoop = a.poseLoop;
		}

		if (!switched('flip', id)) {
			entity.flip = a.flip;
		}

		if (!switched('grade', id)) {
			entity.grade = a.grade;
		}

		for (const key of ['pose', 'steps', 'poseLoop', 'grade', 'rot', 'stretch', 'z'] as const) {
			if (entity[key] === undefined) {
				delete entity[key];
			}
		}

		entities[id] = entity;
	}

	out.entities = entities;

	return out;
}
