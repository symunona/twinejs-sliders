/**
 * Particle emitters — the parameters, their ranges and presets.
 *
 * An emitter is an ASSET: kind `fx`, its bytes are the particle sprite, its `particles`
 * metadata is the emitter. Placed in a scene like any prop, so it has a position, scale,
 * z and opacity for free, and the scene editor drags it like a candle. A scene's `emit:`
 * key overrides the asset's numbers per entity, merged per key like `grade:`.
 *
 * One copy, here, because the parser clamps against these ranges, the renderer simulates
 * with them and the particle editor draws its sliders from them.
 *
 * Units, so one emitter draws the same at any size:
 *
 * | | |
 * |---|---|
 * | distance | fraction of the emitter BOX width (`ParticleSpec.box`) |
 * | time | seconds |
 * | angle | degrees, 0 = up, clockwise positive (same sense as `rot:`) |
 */

export const EMIT_BLENDS = ['add', 'normal'] as const;

export type EmitBlend = (typeof EMIT_BLENDS)[number];

/** The numeric keys, in the order the editor lists them and YAML writes them. */
export const EMIT_NUMBER_KEYS = [
	'rate',
	'life',
	'speed',
	'angle',
	'spread',
	'gravity',
	'size',
	'grow',
	'fade',
	'spin',
	'area'
] as const;

export type EmitNumberKey = (typeof EMIT_NUMBER_KEYS)[number];

/** Every key `emit:` accepts. */
export const EMIT_KEYS = [
	...EMIT_NUMBER_KEYS,
	'color',
	'colorEnd',
	'blend',
	'sprite'
] as const;

export type EmitKey = (typeof EMIT_KEYS)[number];

/** A full set of emitter parameters. What the simulation reads. */
export interface EmitParams {
	/** Particles born per second. 0 stops the emitter; the ones in flight finish. */
	rate: number;
	/** Seconds a particle lives. */
	life: number;
	/** Launch speed, box widths per second. */
	speed: number;
	/** Launch direction, degrees. 0 = up, 90 = right. */
	angle: number;
	/** Cone width around `angle`, degrees. 360 = every way. */
	spread: number;
	/** Downward pull, box widths per second squared. Negative floats up. */
	gravity: number;
	/** Particle size at birth, fraction of box width. */
	size: number;
	/** Size at death as a multiple of `size`. 0 shrinks to nothing. */
	grow: number;
	/** How far opacity drops by death. 1 = gone, 0 = no fade. */
	fade: number;
	/** Spin, degrees per second, each particle a random share of it either way. 0 = upright. */
	spin: number;
	/** Spawn disc radius around the emitter's origin, fraction of box width. */
	area: number;
	/** Tint at birth, `#rrggbb`. Multiplies the sprite: white art takes it exactly. */
	color: string;
	/** Tint at death, `#rrggbb`. */
	colorEnd: string;
	/** `add` glows (fire, sparks, magic). `normal` paints (smoke, snow, leaves). */
	blend: EmitBlend;
	/**
	 * The particle picture: ANY static image asset, by name (same namespace scene YAML
	 * uses everywhere). Absent = the built-in soft dot. The emitter asset itself is a
	 * preset, not a picture.
	 */
	sprite?: string;
}

/** What `emit:` writes and what the asset carries: any subset. Absent = default. */
export type EmitPatch = Partial<EmitParams>;

/** An emitter asset's `particles` metadata. */
export interface ParticleSpec extends EmitPatch {
	/**
	 * The emitter's own box in PIXELS at scale 1 — what a prop's art size is for a picture.
	 * Particles may leave it; it sizes and places the emitter, it does not clip it. The
	 * asset's `origin` is the emission point inside it.
	 */
	box?: {w: number; h: number};
}

export interface EmitRange {
	min: number;
	max: number;
	step: number;
}

export const EMIT_RANGES: Record<EmitNumberKey, EmitRange> = {
	angle: {max: 180, min: -180, step: 1},
	area: {max: 1, min: 0, step: 0.01},
	fade: {max: 1, min: 0, step: 0.01},
	gravity: {max: 3, min: -3, step: 0.01},
	grow: {max: 4, min: 0, step: 0.05},
	life: {max: 8, min: 0.1, step: 0.05},
	rate: {max: 400, min: 0, step: 1},
	size: {max: 1, min: 0.01, step: 0.01},
	speed: {max: 3, min: 0, step: 0.01},
	spin: {max: 720, min: -720, step: 5},
	spread: {max: 360, min: 0, step: 1}
};

/** A warm, rising glow. What an emitter with no numbers draws. */
export const EMIT_DEFAULTS: EmitParams = {
	angle: 0,
	area: 0.12,
	blend: 'add',
	color: '#ffd27a',
	colorEnd: '#ff2a00',
	fade: 1,
	gravity: -0.3,
	grow: 0.35,
	life: 1.1,
	rate: 70,
	size: 0.4,
	speed: 0.4,
	spin: 0,
	spread: 18
};

/** Default emitter box, pixels. Tall: most effects rise or fall. */
export const DEFAULT_EMIT_BOX = {h: 320, w: 200};

/**
 * Starting points in the particle editor. Numbers only — the sprite is the asset's own
 * bytes, picked separately (`texture` names the pack sprite each one was tuned on).
 * `box`/`origin` are for a NEW emitter; applying a preset to one keeps its own.
 */
export const EMIT_PRESETS: Record<
	string,
	{
		params: EmitParams;
		texture: string;
		box?: {w: number; h: number};
		origin?: {x: number; y: number};
	}
> = {
	fire: {params: EMIT_DEFAULTS, texture: 'p-flame'},
	smoke: {
		params: {
			angle: 0,
			area: 0.12,
			blend: 'normal',
			color: '#9a9a9a',
			colorEnd: '#3a3a3a',
			fade: 1,
			gravity: -0.05,
			grow: 2.5,
			life: 3.5,
			rate: 10,
			size: 0.25,
			speed: 0.15,
			spin: 30,
			spread: 30
		},
		texture: 'p-puff'
	},
	sparks: {
		params: {
			angle: 0,
			area: 0.02,
			blend: 'add',
			color: '#fff6c0',
			colorEnd: '#ff7a00',
			fade: 1,
			gravity: 1.2,
			grow: 0.3,
			life: 1,
			rate: 45,
			size: 0.12,
			speed: 1.1,
			spin: 0,
			spread: 70
		},
		texture: 'p-spark'
	},
	snow: {
		params: {
			angle: 180,
			area: 1,
			blend: 'normal',
			color: '#ffffff',
			colorEnd: '#dfefff',
			fade: 0.3,
			gravity: 0.02,
			grow: 1,
			life: 6,
			rate: 25,
			size: 0.025,
			speed: 0.12,
			spin: 90,
			spread: 40
		},
		// Falls from the top edge across a wide box.
		box: {h: 400, w: 600},
		origin: {x: 0.5, y: 0},
		texture: 'p-flake'
	},
	magic: {
		params: {
			angle: 0,
			area: 0.3,
			blend: 'add',
			color: '#9ef0ff',
			colorEnd: '#b04dff',
			fade: 1,
			gravity: -0.1,
			grow: 0,
			life: 1.6,
			rate: 35,
			size: 0.08,
			speed: 0.1,
			spin: 180,
			spread: 360
		},
		// Hangs round its middle.
		origin: {x: 0.5, y: 0.5},
		texture: 'p-star'
	}
};

const HEX = /^#[0-9a-f]{6}$/i;

/** `#abc` → `#aabbcc`, lower case. Undefined for anything that is not a hex colour. */
export function normalizeHex(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
	const long = short
		? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
		: value;

	return HEX.test(long) ? long.toLowerCase() : undefined;
}

/** Into the key's own range. NaN reads as the default. */
export function clampEmitValue(key: EmitNumberKey, value: number): number {
	if (!Number.isFinite(value)) {
		return EMIT_DEFAULTS[key];
	}

	const {max, min} = EMIT_RANGES[key];

	return Math.min(Math.max(value, min), max);
}

/**
 * Only the keys that are valid, clamped. `undefined` when nothing is left — an entity
 * carries no `emit` rather than an empty one, like `grade`.
 */
export function normalizeEmit(
	patch: EmitPatch | null | undefined
): EmitPatch | undefined {
	if (!patch || typeof patch !== 'object') {
		return undefined;
	}

	const out: EmitPatch = {};

	for (const key of EMIT_NUMBER_KEYS) {
		const value = patch[key];

		if (typeof value === 'number') {
			out[key] = clampEmitValue(key, value);
		}
	}

	for (const key of ['color', 'colorEnd'] as const) {
		const hex = normalizeHex(patch[key]);

		if (hex) {
			out[key] = hex;
		}
	}

	if (patch.blend && (EMIT_BLENDS as readonly string[]).includes(patch.blend)) {
		out.blend = patch.blend;
	}

	if (typeof patch.sprite === 'string' && patch.sprite.trim()) {
		out.sprite = patch.sprite.trim();
	}

	return Object.keys(out).length ? out : undefined;
}

/** A beat's `emit:` over the one the entity already has: per key, the beat wins. */
export function mergeEmit(
	base: EmitPatch | undefined,
	patch: EmitPatch | undefined
): EmitPatch | undefined {
	return normalizeEmit({...base, ...patch});
}

/** Defaults, then the asset's emitter, then the scene's `emit:`. What the renderer runs. */
export function resolveEmit(
	spec: ParticleSpec | undefined,
	emit: EmitPatch | undefined
): EmitParams {
	return {...EMIT_DEFAULTS, ...normalizeEmit(spec), ...normalizeEmit(emit)};
}

/** The emitter box in pixels, defaulted. */
export function emitBox(spec: ParticleSpec | undefined): {w: number; h: number} {
	const box = spec?.box;

	return box && box.w > 0 && box.h > 0 ? {h: box.h, w: box.w} : DEFAULT_EMIT_BOX;
}

/** True when two patches say the same thing. */
export function sameEmit(
	a: EmitPatch | undefined,
	b: EmitPatch | undefined
): boolean {
	const x = normalizeEmit(a) ?? {};
	const y = normalizeEmit(b) ?? {};

	return EMIT_KEYS.every(key => x[key] === y[key]);
}
