/**
 * Asset effects — the CSS half (spec 14).
 *
 * An effect is a live look an asset carries wherever it is drawn, so it cannot be baked
 * into the bytes the way a crop or a cutout is: there is no still frame of a glitch. It is
 * therefore CSS, generated from the asset's parameters, and it has to come out identical in
 * the asset editor's preview, in the scene preview and in the published player.
 *
 * That is what this module is for. It is PURE — parameters in, a class name and a stylesheet
 * out — and the DOM half below it only ever creates elements and sets a `src`. Splitting it
 * there is deliberate: nothing that composites pixels is provable under jest (see
 * `.claude/TRAPS.md`), while a stylesheet is a string, and a string can be asserted on.
 *
 * ## Why generated and not a static stylesheet
 *
 * The tear is a per-band track of pseudo-random offsets held for one frame each. Band count,
 * frame count and offset magnitude are all parameters, so the keyframes cannot be written
 * ahead of time — a static rule with custom properties can carry ONE offset, not a track of
 * forty. Generating them also makes the effect reproducible: the same parameters seed the
 * same pseudo-random sequence, so an author who nudges `speed` sees the tear they already
 * approved run faster rather than an entirely new one.
 *
 * ## The markup contract
 *
 * ```html
 * <div class="sliders-fx sliders-fx-<hash>" data-fx="glitch">
 *   <img class="sliders-fx-layer" data-fx="split-a" src="…">
 *   <img class="sliders-fx-layer" data-fx="split-b" src="…">
 *   <img class="sliders-fx-layer" data-fx="band" data-band="0" src="…">
 *   …one per band…
 *   <div class="sliders-fx-layer" data-fx="scanlines"></div>
 *   <div class="sliders-fx-layer" data-fx="noise"></div>
 * </div>
 * ```
 *
 * The host is an overlay over the art, never a wrapper around it. Wrapping would mean
 * reparenting the renderer's `<img>`, and remounting an `<img>` restarts animated WebP
 * playback and flashes — the same reason `setContent` goes to such lengths to keep the
 * element it has.
 *
 * The generated rules only ever write `translate`, `rotate`, `clip-path`, `opacity`,
 * `filter` and `background-position`. None of those is touched by `applyFrameFit` or
 * `layout`, which own `transform`, `transform-origin`, `object-fit` and `object-position`.
 * So an effect can be layered onto a mirrored, tilted, origin-pinned sprite without the two
 * ever fighting over a property — `translate` and `rotate` are their own longhands and
 * compose with `transform` rather than replacing it.
 */

import type {AssetEffect, GlitchEffect} from '@sliders/scene-types';

/** Where a glitch starts. Visible, legible, and not the full-tear cliché. */
export const GLITCH_DEFAULTS: GlitchEffect = {
	kind: 'glitch',
	amount: 35,
	rotate: 0,
	bands: 5,
	speed: 24,
	split: 30,
	period: 2.4,
	burst: 40,
	scanlines: 0,
	noise: 0
};

/**
 * What each parameter may be set to.
 *
 * Exported because the asset editor's sliders and this module's clamping have to agree, and
 * a range that exists twice is a range that drifts.
 */
export const GLITCH_RANGES: Record<
	keyof Omit<GlitchEffect, 'kind'>,
	{max: number; min: number; step: number}
> = {
	amount: {min: 0, max: 100, step: 1},
	// Degrees, not a 0..100 like its neighbours -- see `GlitchEffect.rotate`. Past about
	// thirty the band no longer reads as a torn strip of the picture, it reads as a second
	// picture lying on top of the first at an angle.
	rotate: {min: 0, max: 30, step: 1},
	bands: {min: 1, max: 12, step: 1},
	speed: {min: 1, max: 50, step: 1},
	split: {min: 0, max: 100, step: 1},
	period: {min: 0.4, max: 8, step: 0.1},
	burst: {min: 0, max: 100, step: 1},
	scanlines: {min: 0, max: 100, step: 1},
	noise: {min: 0, max: 100, step: 1}
};

/** `amount: 100` slides a band this far, as a percentage of the art's own width. */
const MAX_TEAR = 25;

/** `split: 100` pushes a colour channel this far each way, in percent of the width. */
const MAX_SPLIT = 2;

/**
 * How many steps of the tear clock one loop is cut into.
 *
 * Capped well below `period * speed` at the top of both ranges (8s × 50fps = 400) because
 * every step is a keyframe stop in the generated stylesheet, per band. Past about this many
 * the extra stops are invisible — the eye cannot follow a tear that changes 50 times a
 * second — and the CSS is measured in tens of kilobytes.
 */
const MAX_FRAMES = 48;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function round(value: number, places = 2): number {
	const factor = 10 ** places;

	return Math.round(value * factor) / factor;
}

/**
 * Every parameter forced into range, and NaN forced to the default.
 *
 * Between the wire, a hand-edited manifest and a bundle from an older build, the numbers
 * arriving here are not the ones the sliders produced. Clamping once, here, is what lets
 * everything below assume a sane `bands` rather than emitting a stylesheet with negative
 * clip paths in it.
 */
export function normalizeGlitch(effect: Partial<GlitchEffect> = {}): GlitchEffect {
	const keys = Object.keys(GLITCH_RANGES) as (keyof typeof GLITCH_RANGES)[];
	const out = {kind: 'glitch'} as GlitchEffect;

	for (const key of keys) {
		const {max, min, step} = GLITCH_RANGES[key];
		const raw = effect[key];
		const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : GLITCH_DEFAULTS[key];

		out[key] = round(clamp(value, min, max), step < 1 ? 2 : 0);
	}

	return out;
}

/** Normalizes whatever effect an asset carries, or reports that it carries none. */
export function normalizeEffect(
	effect: AssetEffect | undefined
): AssetEffect | undefined {
	if (!effect || effect.kind !== 'glitch') {
		return undefined;
	}

	return normalizeGlitch(effect);
}

/**
 * True when this effect would draw nothing.
 *
 * Asked before any DOM is built, so that turning every slider down is the same as having no
 * effect at all rather than eight invisible layers with `will-change` on them.
 */
export function effectIsIdle(effect: AssetEffect | undefined): boolean {
	const normal = normalizeEffect(effect);

	if (!normal) {
		return true;
	}

	return (
		!tears(normal) &&
		normal.split === 0 &&
		normal.scanlines === 0 &&
		normal.noise === 0
	);
}

/**
 * Whether the bands do anything.
 *
 * Either knob on its own is a tear: sliding without twisting is the analogue look, twisting
 * without sliding is a strip of the picture that lifts off and comes back. `burst` gates
 * both, because it is how often a band is corrupted at all — at zero there is no burst to
 * slide or twist in.
 */
function tears(glitch: GlitchEffect): boolean {
	return (glitch.amount > 0 || glitch.rotate > 0) && glitch.burst > 0;
}

/**
 * Parameters added after glitch shipped, which contribute to the class name only when they
 * are set to something.
 *
 * The class is the SEED of the tear as well as its name, so a hash that moved would hand
 * every already-tuned effect a different pseudo-random track — exactly what `seeded` exists
 * to prevent. Leaving a new key out while it is at zero keeps the old effects on their old
 * hash, and is sound because zero is what the normalizer gives a key that is missing
 * entirely: for these, "absent" and "off" are the same effect and must hash the same.
 *
 * Every future parameter belongs here, and its default has to be zero for that to hold.
 */
const LATE_KEYS = new Set<keyof typeof GLITCH_RANGES>(['rotate']);

/**
 * FNV-1a over the effect's own numbers.
 *
 * The class name is a hash rather than a counter so that two entities with identical
 * parameters share one generated rule, and so that the same asset produces the same class
 * on every reload — a counter would renumber on mount and invalidate nothing but itself.
 */
export function effectClass(effect: AssetEffect): string {
	const normal = normalizeGlitch(effect);
	const keys = Object.keys(GLITCH_RANGES).sort() as (keyof typeof GLITCH_RANGES)[];
	const text = `${normal.kind}|${keys
		.filter(key => !(LATE_KEYS.has(key) && normal[key] === 0))
		.map(key => `${key}:${normal[key]}`)
		.join('|')}`;
	let hash = 0x811c9dc5;

	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}

	return `sliders-fx-${hash.toString(36)}`;
}

/**
 * mulberry32, seeded from the class name.
 *
 * A named generator rather than `Math.random` for one reason: the tear has to be the same
 * every time these parameters are rendered. An author who sets a look, saves, reopens the
 * editor and sees a different tear has no way to tell whether the save worked.
 */
function seeded(seed: string): () => number {
	let state = 0x6d2b79f5;

	for (let index = 0; index < seed.length; index++) {
		state = (Math.imul(state ^ seed.charCodeAt(index), 0x85ebca6b) + 1) >>> 0;
	}

	return () => {
		state = (state + 0x6d2b79f5) >>> 0;

		let t = state;

		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** What the DOM half has to build for this effect, in paint order. */
export interface EffectLayer {
	/** Which band this is, for `data-band`. Only on `band` layers. */
	band?: number;
	/** True when the layer shows the asset's pixels, so it must be an `<img>`. */
	art: boolean;
	role: 'split-a' | 'split-b' | 'band' | 'scanlines' | 'noise';
}

/**
 * The layers this effect needs, in the order they paint.
 *
 * Splits first so a torn band covers its own colour fringe rather than the other way round,
 * and the two full-frame overlays last because they belong on top of everything.
 */
export function effectLayers(effect: AssetEffect | undefined): EffectLayer[] {
	const normal = normalizeEffect(effect);

	if (!normal || effectIsIdle(normal)) {
		return [];
	}

	const layers: EffectLayer[] = [];

	if (normal.split > 0) {
		layers.push({art: true, role: 'split-a'}, {art: true, role: 'split-b'});
	}

	if (tears(normal)) {
		for (let band = 0; band < normal.bands; band++) {
			layers.push({art: true, band, role: 'band'});
		}
	}

	if (normal.scanlines > 0) {
		layers.push({art: false, role: 'scanlines'});
	}

	if (normal.noise > 0) {
		layers.push({art: false, role: 'noise'});
	}

	return layers;
}

/**
 * One keyframe track, as CSS text.
 *
 * Consecutive equal values are collapsed into a single stop, which is not a micro
 * optimisation: with `burst` at its default the band is still for most of the loop, so the
 * naive track is forty stops of `translate: 0 0` and the collapsed one is four. It changes
 * nothing about how the animation runs — `steps(1, end)` holds each value until the next
 * stop either way.
 */
function track(
	name: string,
	frames: number,
	valueAt: (frame: number) => string
): string {
	const stops: string[] = [];
	let previous: string | undefined;

	for (let frame = 0; frame < frames; frame++) {
		const value = valueAt(frame);

		if (value !== previous) {
			stops.push(`\t${round((frame / frames) * 100)}% { ${value} }`);
			previous = value;
		}
	}

	// A closing stop so the last value holds to the end of the loop instead of the browser
	// interpolating back towards 0% early.
	stops.push(`\t100% { ${valueAt(0)} }`);

	return `@keyframes ${name} {\n${stops.join('\n')}\n}`;
}

/**
 * The stylesheet for one set of glitch parameters, scoped to `effectClass(effect)`.
 *
 * Everything that does not depend on the numbers lives in `FX_CSS` and is injected once.
 * What comes out of here is only the part that cannot: the per-band clip paths and the
 * pseudo-random tracks.
 */
export function effectCss(effect: AssetEffect): string {
	const glitch = normalizeGlitch(effect);
	const scope = effectClass(glitch);
	const rng = seeded(scope);
	const frames = clamp(Math.round(glitch.period * glitch.speed), 2, MAX_FRAMES);
	const chance = glitch.burst / 100;
	const tear = (glitch.amount / 100) * MAX_TEAR;
	const split = (glitch.split / 100) * MAX_SPLIT;
	const out: string[] = [];

	out.push(
		`.${scope} > .sliders-fx-layer {\n` +
			`\tanimation-duration: ${glitch.period}s;\n` +
			`\tanimation-iteration-count: infinite;\n` +
			// steps(1, end) is what makes this a glitch rather than a wobble: each value is
			// held until the next stop and then jumps. Interpolated, the same track reads as
			// the picture sliding around smoothly, which is seasickness, not interference.
			`\tanimation-timing-function: steps(1, end);\n` +
			`}`
	);

	// Rolled per band rather than shared, so the bands tear independently. One shared roll
	// makes the whole picture jump sideways as a unit, which looks like a camera shake.

	if (tears(glitch)) {
		for (let band = 0; band < glitch.bands; band++) {
			const name = `${scope}-band-${band}`;
			// Bands of equal height that tile the picture exactly. Unequal heights read as
			// more organic, but a gap between two bands shows a stripe of untorn art that
			// the eye reads as a seam.
			const top = round((band / glitch.bands) * 100);
			const bottom = round(100 - ((band + 1) / glitch.bands) * 100);
			const offsets: number[] = [];
			const angles: number[] = [];

			for (let frame = 0; frame < frames; frame++) {
				const torn = rng() < chance;

				offsets.push(torn ? round((rng() * 2 - 1) * tear) : 0);

				// Rolled only when the author asked for a twist, so a glitch with `rotate`
				// at zero draws the byte-identical track it drew before this key existed —
				// one extra draw per frame would shift the whole sequence.
				if (glitch.rotate > 0) {
					angles.push(torn ? round((rng() * 2 - 1) * glitch.rotate) : 0);
				}
			}

			out.push(
				`.${scope} > [data-fx='band'][data-band='${band}'] {\n` +
					`\tclip-path: inset(${top}% 0 ${bottom}% 0);\n` +
					`\tanimation-name: ${name};\n` +
					`}`
			);
			out.push(
				track(
					name,
					frames,
					// `rotate` is its own longhand, like `translate`, so the two compose
					// here and neither touches the `transform` the renderer's layout owns.
					// The band is clipped BEFORE it is transformed, so what turns is the
					// torn strip itself rather than a wedge of the whole picture.
					frame =>
						glitch.rotate > 0
							? `translate: ${offsets[frame]}% 0; rotate: ${angles[frame]}deg;`
							: `translate: ${offsets[frame]}% 0;`
				)
			);
		}
	}

	// The two channel copies. They ride the same clock as the bands and are offset in
	// opposite directions, which is what makes an edge come apart into red and cyan rather
	// than simply doubling.

	if (glitch.split > 0) {
		for (const [role, direction] of [
			['split-a', 1],
			['split-b', -1]
		] as const) {
			const name = `${scope}-${role}`;
			const offsets: number[] = [];

			for (let frame = 0; frame < frames; frame++) {
				// A constant hairline split even when clean, widening during a burst. Zero
				// between bursts would make the colour fringe blink on and off, and the
				// fringe is the part that reads as "this is a video signal".
				const scale = rng() < chance ? 1 + rng() * 2 : 0.35;

				offsets.push(round(direction * split * scale));
			}

			out.push(
				`.${scope} > [data-fx='${role}'] {\n\tanimation-name: ${name};\n}`
			);
			out.push(
				track(name, frames, frame => `translate: ${offsets[frame]}% 0;`)
			);
		}
	}

	if (glitch.scanlines > 0) {
		out.push(
			`.${scope} > [data-fx='scanlines'] {\n` +
				`\topacity: ${round(glitch.scanlines / 100)};\n` +
				`\tanimation-name: sliders-fx-scanline-drift;\n` +
				// Its own duration and a linear ease: the drift is a slow continuous crawl,
				// and the stepped clock above would make it judder in place.
				`\tanimation-duration: ${round(Math.max(1, 8 - glitch.speed / 8))}s;\n` +
				`\tanimation-timing-function: linear;\n` +
				`}`
		);
	}

	if (glitch.noise > 0) {
		const name = `${scope}-noise`;
		const jumps: string[] = [];

		for (let frame = 0; frame < frames; frame++) {
			jumps.push(
				`background-position: ${Math.round(rng() * 200)}px ${Math.round(
					rng() * 200
				)}px;`
			);
		}

		out.push(
			`.${scope} > [data-fx='noise'] {\n` +
				`\topacity: ${round(glitch.noise / 100)};\n` +
				`\tanimation-name: ${name};\n` +
				`}`
		);
		out.push(track(name, frames, frame => jumps[frame]));
	}

	return out.join('\n\n');
}

/**
 * Whether two effects would draw the same thing.
 *
 * Compared after normalizing, so a value the wire rounded differently is not a change, and
 * absent compares equal to an effect whose every knob is at zero. Lives here rather than in
 * the asset editor because the editor's dirty flag and this module's class names have to agree
 * about what "the same effect" means — the class is a hash of exactly these numbers.
 */
export function sameEffect(
	a: AssetEffect | undefined,
	b: AssetEffect | undefined
): boolean {
	const left = normalizeEffect(a);
	const right = normalizeEffect(b);

	if (!left || effectIsIdle(left)) {
		return !right || effectIsIdle(right);
	}

	if (!right || effectIsIdle(right)) {
		return false;
	}

	return effectClass(left) === effectClass(right);
}
