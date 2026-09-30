/**
 * "Match bg": a first guess at a grade that sits a sprite into its backdrop.
 *
 * The heuristic is PURE — pixel buffers in, a grade out — so it can be tested without a
 * browser (`jest-canvas-mock` hands back blank pixels, `.claude/TRAPS.md`). The DOM half,
 * which draws the backdrop and the sprite into canvases to get those buffers, lives in
 * `match-bg-dom.ts`.
 *
 * It is a SUGGESTION. It moves the sprite part of the way towards the backdrop's light and
 * colour cast, never all the way: a character graded to exactly the average of a sunset is
 * orange mud, and the author tunes from here.
 */

import {clampGradeValue, normalizeGrade} from '@sliders/scene-types';
import type {EntityGrade} from '@sliders/scene-types';

export interface ColourStats {
	/** Mean channel values, 0..255. */
	r: number;
	g: number;
	b: number;
	/** Mean Rec. 709 luma, 0..255 — the weights the grade's own matrices preserve. */
	luma: number;
	/** Mean chroma (max channel minus min channel), 0..255. */
	chroma: number;
	/** Pixels counted. */
	count: number;
}

/** Below this alpha a sprite pixel is edge or air, and would drag its stats to black. */
export const OPAQUE_ALPHA = 128;

/**
 * Averages over an RGBA buffer. With `opaqueOnly`, pixels under `OPAQUE_ALPHA` are left
 * out — the sprite's cut-out surroundings are not part of its colour. Undefined when no
 * pixel counted.
 */
export function colourStats(
	pixels: Uint8ClampedArray,
	opaqueOnly = false
): ColourStats | undefined {
	let r = 0;
	let g = 0;
	let b = 0;
	let chroma = 0;
	let count = 0;

	for (let index = 0; index + 3 < pixels.length; index += 4) {
		if (opaqueOnly && pixels[index + 3] < OPAQUE_ALPHA) {
			continue;
		}

		const pr = pixels[index];
		const pg = pixels[index + 1];
		const pb = pixels[index + 2];

		r += pr;
		g += pg;
		b += pb;
		chroma += Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
		count++;
	}

	if (count === 0) {
		return undefined;
	}

	r /= count;
	g /= count;
	b /= count;

	return {
		b,
		chroma: chroma / count,
		count,
		g,
		luma: 0.213 * r + 0.715 * g + 0.072 * b,
		r
	};
}

/**
 * How far towards the backdrop the suggestion goes. Half: enough to read as the same light,
 * little enough that the character is still the character.
 */
export const MATCH_STRENGTH = 0.5;

/** Hard limits per key, tighter than the sliders: a first guess should never be extreme. */
const LIMITS = {
	brightness: 40,
	saturation: 50,
	tint: 50,
	warmth: 60
};

function limit(value: number, bound: number): number {
	return Math.round(Math.min(Math.max(value, -bound), bound));
}

/**
 * A grade that moves `sprite` towards `bg`.
 *
 * Each key is solved against what that slider actually does in `buildChannelLuts` /
 * `buildLut`, so the numbers mean something:
 *
 * - brightness adds `brightness / 100 * 255` to every channel, so the luma gap maps straight
 *   onto it.
 * - warmth pushes red up and blue down by `warmth / 100 * 40` each: the red-minus-blue gap
 *   moves by `0.8 * warmth`.
 * - tint pushes green up by `tint / 100 * 40` and red and blue down by half that: green
 *   minus the red/blue average moves by `0.6 * tint`.
 * - saturation scales chroma by `1 + saturation / 100`, so the chroma RATIO maps onto it.
 *
 * All four are then scaled by `MATCH_STRENGTH`, clamped to `LIMITS` and to the sliders'
 * ranges, and rounded to whole slider steps. Keys that come out at rest are dropped.
 */
export function suggestGrade(
	sprite: ColourStats,
	bg: ColourStats,
	strength = MATCH_STRENGTH
): EntityGrade | undefined {
	const brightness = ((bg.luma - sprite.luma) / 255) * 100 * strength;
	const warmCast = bg.r - bg.b - (sprite.r - sprite.b);
	const warmth = (warmCast / 0.8) * strength;
	const tintCast = bg.g - (bg.r + bg.b) / 2 - (sprite.g - (sprite.r + sprite.b) / 2);
	const tint = (tintCast / 0.6) * strength;
	// Chroma below a few units is noise: a grey sprite has no saturation to scale.
	const saturation =
		sprite.chroma > 4 ? (bg.chroma / sprite.chroma - 1) * 100 * strength : 0;

	return normalizeGrade({
		brightness: clampGradeValue('brightness', limit(brightness, LIMITS.brightness)),
		saturation: clampGradeValue('saturation', limit(saturation, LIMITS.saturation)),
		tint: clampGradeValue('tint', limit(tint, LIMITS.tint)),
		warmth: clampGradeValue('warmth', limit(warmth, LIMITS.warmth))
	});
}

/** A rectangle, in whatever pixels the caller is using. */
export interface PixelRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Where a rectangle on screen falls in the SOURCE pixels of an `object-fit` image.
 *
 * `element` is the `<img>` element's box and `target` the region to sample, both in the
 * same screen pixels; `natural` is the picture's own size. `position` is `object-position`
 * as fractions (the backdrop's is centred). Clipped to the picture; undefined when nothing
 * of the region is on it.
 */
export function sourceRect(
	element: PixelRect,
	target: PixelRect,
	natural: {w: number; h: number},
	fit: 'cover' | 'contain' = 'cover',
	position: {x: number; y: number} = {x: 0.5, y: 0.5}
): PixelRect | undefined {
	if (!(natural.w > 0 && natural.h > 0 && element.w > 0 && element.h > 0)) {
		return undefined;
	}

	const sx = element.w / natural.w;
	const sy = element.h / natural.h;
	const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
	const left = element.x + (element.w - natural.w * scale) * position.x;
	const top = element.y + (element.h - natural.h * scale) * position.y;
	const x0 = Math.max(0, (target.x - left) / scale);
	const y0 = Math.max(0, (target.y - top) / scale);
	const x1 = Math.min(natural.w, (target.x + target.w - left) / scale);
	const y1 = Math.min(natural.h, (target.y + target.h - top) / scale);

	if (!(x1 > x0 && y1 > y0)) {
		return undefined;
	}

	return {h: y1 - y0, w: x1 - x0, x: x0, y: y0};
}
