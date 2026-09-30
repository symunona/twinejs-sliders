/**
 * Colour grade — the maths the asset editor bakes and a scene's `grade:` draws live.
 *
 * One copy, here, because three consumers need it and none of them may import the others:
 * the asset editor (`src/`) bakes pixels with it, the renderer (`render-dom`) turns it into
 * an SVG filter, and the parser (`scene-schema`) clamps against its ranges. A grade on
 * stage and the same numbers baked into the asset must land on the same picture, and the
 * only way that stays true is one function.
 *
 * Its own file rather than more of `index.ts`, which every session edits. Re-exported from
 * there, so nothing imports this path directly.
 */

export const GAMMA_RANGE = {max: 3, min: 0.1, step: 0.05};
export const LEVEL_RANGE = {max: 100, min: -100, step: 1};
export const HUE_RANGE = {max: 180, min: -180, step: 1};
/** One-sided: `pop` only ever adds. Taking it away is what `contrast` is for. */
export const POP_RANGE = {max: 100, min: 0, step: 1};
/** Radius in pixels of the art at its own size. */
export const BLUR_RANGE = {max: 50, min: 0, step: 0.5};

/**
 * The keys of a grade, in the order the asset editor's panel lists them — which is also
 * the order they are written back into YAML.
 */
export const GRADE_KEYS = [
	'brightness',
	'contrast',
	'gamma',
	'shadows',
	'highlights',
	'pop',
	'warmth',
	'tint',
	'saturation',
	'hue',
	'blur'
] as const;

export type GradeKey = (typeof GRADE_KEYS)[number];

/**
 * A colour grade. Every key optional; an absent key is that slider at rest.
 *
 * The shape of the colour half of `ImageEdits`, so a number means the same thing on a
 * baked asset and on a live `grade:`.
 */
export type EntityGrade = Partial<Record<GradeKey, number>>;

export interface GradeRange {
	min: number;
	max: number;
	step: number;
}

export const GRADE_RANGES: Record<GradeKey, GradeRange> = {
	blur: BLUR_RANGE,
	brightness: LEVEL_RANGE,
	contrast: LEVEL_RANGE,
	gamma: GAMMA_RANGE,
	highlights: LEVEL_RANGE,
	hue: HUE_RANGE,
	pop: POP_RANGE,
	saturation: LEVEL_RANGE,
	shadows: LEVEL_RANGE,
	tint: LEVEL_RANGE,
	warmth: LEVEL_RANGE
};

/** What a key reads as at rest, which for gamma is not zero. */
export function gradeNeutral(key: GradeKey): number {
	return key === 'gamma' ? 1 : 0;
}

/** One key's value, with absence read as rest. */
export function gradeLevel(grade: EntityGrade | undefined, key: GradeKey): number {
	return grade?.[key] ?? gradeNeutral(key);
}

/** Into the key's own range. NaN reads as rest. */
export function clampGradeValue(key: GradeKey, value: number): number {
	if (!Number.isFinite(value)) {
		return gradeNeutral(key);
	}

	const {max, min} = GRADE_RANGES[key];

	return Math.min(Math.max(value, min), max);
}

/**
 * The same grade with every key at rest dropped, in `GRADE_KEYS` order. `undefined` when
 * nothing is left — a stage entity carries no grade rather than an empty one, so "is this
 * graded" is one `!!` everywhere.
 */
export function normalizeGrade(
	grade: EntityGrade | null | undefined
): EntityGrade | undefined {
	if (!grade) {
		return undefined;
	}

	const out: EntityGrade = {};
	let any = false;

	for (const key of GRADE_KEYS) {
		const value = grade[key];

		if (value !== undefined && value !== gradeNeutral(key)) {
			out[key] = value;
			any = true;
		}
	}

	return any ? out : undefined;
}

/**
 * A beat's grade over the one the entity already has: per key, the beat wins where it
 * speaks. A key at rest in the patch RESETS that key (`warmth: 0`), which is how one
 * slider comes back without clearing the others.
 */
export function mergeGrade(
	base: EntityGrade | undefined,
	patch: EntityGrade | undefined
): EntityGrade | undefined {
	return normalizeGrade({...base, ...patch});
}

/** True when two grades draw the same picture. Absent and at rest are the same. */
export function sameGrade(
	a: EntityGrade | undefined,
	b: EntityGrade | undefined
): boolean {
	return GRADE_KEYS.every(key => gradeLevel(a, key) === gradeLevel(b, key));
}

/**
 * What a write has to say to get from `base` to `next` under `mergeGrade`: every key that
 * differs, a key going back to rest written as its rest value. `undefined` when they agree.
 */
export function gradeDelta(
	base: EntityGrade | undefined,
	next: EntityGrade | undefined
): EntityGrade | undefined {
	const out: EntityGrade = {};
	let any = false;

	for (const key of GRADE_KEYS) {
		const value = gradeLevel(next, key);

		if (value !== gradeLevel(base, key)) {
			out[key] = value;
			any = true;
		}
	}

	return any ? out : undefined;
}

// ---------------------------------------------------------------------------
// Pixel maths. Pure: numbers in, tables out.
// ---------------------------------------------------------------------------

/** The adjustments one grey curve can express, in the order the curve applies them. */
export const TONE_KEYS = [
	'brightness',
	'contrast',
	'gamma',
	'shadows',
	'highlights',
	'pop'
] as const;

/** What `buildLut` reads. Loose on purpose so a test can hand it three numbers. */
export type ToneGrade = Partial<Record<(typeof TONE_KEYS)[number], number>>;

/** -100..100, and 0 for an absent slider. */
export function clampLevel(value?: number): number {
	return Math.min(Math.max(value ?? 0, LEVEL_RANGE.min), LEVEL_RANGE.max);
}

/** The usual 3x-squared-minus-2x-cubed ease, on 0..1. Fixed at both ends. */
function smoothstep(unit: number): number {
	const clamped = Math.min(Math.max(unit, 0), 1);

	return clamped * clamped * (3 - 2 * clamped);
}

/**
 * The contrast factor `buildLut` uses: the usual one, which keeps 128 fixed and cannot blow
 * up until contrast reaches its 100 limit. Exported because it is exactly CSS
 * `contrast(factor)`, which is how the renderer draws a contrast-only grade natively.
 */
export function contrastFactor(contrast?: number): number {
	const level = Math.min(Math.max(contrast ?? 0, -100), 100) * 2.55;

	return (259 * (level + 255)) / (255 * (259 - level));
}

/**
 * A 256-entry lookup table for the tonal adjustments: brightness, contrast and gamma,
 * then the three that only touch one end of the range — shadows, highlights and pop.
 *
 * One table covers every channel, which is what makes a full-size preview cheap enough to
 * redraw as a slider is dragged. The tonal half of the panel is deliberately everything
 * that can live in a table like this; hue and saturation cannot, and cost a matrix.
 */
export function buildLut(tone: ToneGrade): Uint8ClampedArray {
	const lut = new Uint8ClampedArray(256);
	const offset = ((tone.brightness ?? 0) / 100) * 255;
	const factor = contrastFactor(tone.contrast);
	const exponent =
		1 / Math.min(Math.max(tone.gamma ?? 1, GAMMA_RANGE.min), GAMMA_RANGE.max);
	// Gains chosen so that every one of these curves stays monotonic at its limit: a
	// slider that can reorder two tones turns a gradient inside out, which reads as
	// corruption rather than as a strong edit.
	const shadows = (clampLevel(tone.shadows) / 100) * 0.25;
	const highlights = (clampLevel(tone.highlights) / 100) * 0.25;
	const pop = Math.min(Math.max(tone.pop ?? 0, 0), 100) / 100;

	for (let value = 0; value < 256; value++) {
		const shifted = factor * (value + offset - 128) + 128;
		let unit = Math.pow(Math.max(0, shifted) / 255, exponent);

		// Weighted by how dark (or how light) the pixel already is, so each of these two
		// leaves the other end of the range alone -- that is the whole point of having them
		// as well as brightness.
		unit += shadows * (1 - unit) * (1 - unit);
		unit += highlights * unit * unit;
		// Smoothstep: fixed at both ends, steeper through the middle. Mixed in rather than
		// replacing, so `pop` is a dial and not a switch.
		unit += pop * 0.5 * (smoothstep(unit) - unit);

		// Uint8ClampedArray rounds and clamps on assignment.
		lut[value] = 255 * unit;
	}

	return lut;
}

/** A copy of a LUT with every entry pushed by `offset` 0..255 units. */
function shiftLut(lut: Uint8ClampedArray, offset: number): Uint8ClampedArray {
	const shifted = new Uint8ClampedArray(256);

	for (let value = 0; value < 256; value++) {
		shifted[value] = lut[value] + offset;
	}

	return shifted;
}

/**
 * The tone curve, once per channel, with warmth and tint folded in as a push on the
 * channels that name those axes: warmth trades blue for red, tint trades magenta for
 * green. Both ride on top of the curve, so they grade the picture the sliders above them
 * produced.
 */
export function buildChannelLuts(grade: EntityGrade): {
	r: Uint8ClampedArray;
	g: Uint8ClampedArray;
	b: Uint8ClampedArray;
} {
	const tone = buildLut(grade);
	const warmth = (clampLevel(grade.warmth) / 100) * 40;
	const tint = (clampLevel(grade.tint) / 100) * 40;

	if (warmth === 0 && tint === 0) {
		// The common case, and worth catching: three references to one table cost nothing
		// and `applyChannelLuts` does not care that they are the same object.
		return {b: tone, g: tone, r: tone};
	}

	return {
		// Tint is split across red and blue against green so that it moves the hue without
		// also moving the brightness, the way warmth's opposed pair already does.
		b: shiftLut(tone, -warmth - tint / 2),
		g: shiftLut(tone, tint),
		r: shiftLut(tone, warmth - tint / 2)
	};
}

/** How much each channel weighs in the luminance these two matrices preserve. */
const LUMA = {b: 0.072, g: 0.715, r: 0.213};

/** `saturate()` from the CSS filter spec. */
function saturateMatrix(amount: number): number[] {
	const s = Math.max(0, amount);

	return [
		LUMA.r + (1 - LUMA.r) * s,
		LUMA.g - LUMA.g * s,
		LUMA.b - LUMA.b * s,
		LUMA.r - LUMA.r * s,
		LUMA.g + (1 - LUMA.g) * s,
		LUMA.b - LUMA.b * s,
		LUMA.r - LUMA.r * s,
		LUMA.g - LUMA.g * s,
		LUMA.b + (1 - LUMA.b) * s
	];
}

/** `hue-rotate()` from the CSS filter spec, which is where the odd constants come from. */
function hueMatrix(radians: number): number[] {
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);

	return [
		0.213 + cos * 0.787 - sin * 0.213,
		0.715 - cos * 0.715 - sin * 0.715,
		0.072 - cos * 0.072 + sin * 0.928,
		0.213 - cos * 0.213 + sin * 0.143,
		0.715 + cos * 0.285 + sin * 0.14,
		0.072 - cos * 0.072 - sin * 0.283,
		0.213 - cos * 0.213 - sin * 0.787,
		0.715 - cos * 0.715 + sin * 0.715,
		0.072 + cos * 0.928 + sin * 0.072
	];
}

/** Two 3x3 matrices, as one that does `a` after `b`. */
function multiply(a: number[], b: number[]): number[] {
	const out = new Array<number>(9);

	for (let row = 0; row < 3; row++) {
		for (let column = 0; column < 3; column++) {
			out[row * 3 + column] =
				a[row * 3] * b[column] +
				a[row * 3 + 1] * b[3 + column] +
				a[row * 3 + 2] * b[6 + column];
		}
	}

	return out;
}

/**
 * The `saturate()` amount the matrix uses: the slider, times the little lift `pop` adds.
 * Exported because it is exactly CSS `saturate(amount)`.
 */
export function saturationAmount(grade: EntityGrade): number {
	const pop = Math.min(Math.max(grade.pop ?? 0, 0), 100) / 100;

	return (1 + clampLevel(grade.saturation) / 100) * (1 + pop * 0.25);
}

/** Degrees of `hue-rotate()`, clamped to the slider. */
export function hueDegrees(grade: EntityGrade): number {
	return Math.min(Math.max(grade.hue ?? 0, HUE_RANGE.min), HUE_RANGE.max);
}

/**
 * A 3x3 colour matrix for saturation and hue, in that order.
 *
 * Both are the matrices the CSS filter spec gives for `saturate()` and `hue-rotate()`, so
 * these two sliders land where the equivalent `filter:` would. Worth keeping that way:
 * anything that wants to preview a grade without baking it can say it in CSS and get the
 * same picture.
 *
 * `pop` lifts saturation a little as well as bending the curve. Google Photos' slider of
 * that name does the same, and it is the reason it reads as "pop" rather than "contrast".
 */
export function buildColorMatrix(grade: EntityGrade): number[] {
	return multiply(
		saturateMatrix(saturationAmount(grade)),
		hueMatrix((hueDegrees(grade) * Math.PI) / 180)
	);
}
