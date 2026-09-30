/**
 * `grade:` — a live colour grade, drawn as a CSS `filter` on the art (spec 02, "Colour
 * grade").
 *
 * Two halves, split like `effects.ts` / `effect-host.ts`: `gradeFilter` is PURE (numbers in,
 * a filter description out) and is where the parity with the asset editor lives; the rest
 * puts the SVG half into the document and takes it out again.
 *
 * ## Why two modes
 *
 * CSS has native functions for four of the eleven sliders, and they are EXACTLY the asset
 * editor's maths: `contrast()` is `buildLut`'s contrast factor, `hue-rotate()` and
 * `saturate()` are the CSS-spec matrices `buildColorMatrix` multiplies, `blur()` is a blur.
 * A grade that uses only those is drawn natively, and a native filter list interpolates —
 * so a beat that changes it fades smoothly, on the element's own CSS transition.
 *
 * The other seven cannot be said in CSS. Brightness is ADDITIVE in the editor
 * (`brightness()` multiplies), gamma, shadows, highlights and pop are curves, warmth and tint
 * push channels apart. Those go through one SVG `<filter>`: a `feComponentTransfer` whose
 * tables ARE `buildChannelLuts`' output and a `feColorMatrix` that IS `buildColorMatrix`'s,
 * so baking a grade in the asset editor and drawing it live land on the same picture and
 * cannot drift. The cost: a `url()` in a filter list is not interpolable, so a change into,
 * out of or between SVG grades snaps — which the renderer covers with a cross-fade.
 */

import {
	buildChannelLuts,
	buildColorMatrix,
	contrastFactor,
	gradeLevel,
	hueDegrees,
	normalizeGrade,
	saturationAmount,
	type EntityGrade
} from '@sliders/scene-types';
import {effectDefs} from './effect-host';

/** Keys CSS draws natively, with the editor's own maths. */
const NATIVE_KEYS = ['contrast', 'hue', 'saturation', 'blur'] as const;

/**
 * The custom property a sprite's blur is scaled by: CSS px per pixel of the art.
 *
 * A grade's `blur` is in the asset editor's unit — pixels of the picture at its own size —
 * and the same sprite draws at a dozen sizes. The renderer writes the ratio next to the
 * geometry it already computes, and `calc()` does the rest, so a resize needs no new filter.
 */
export const GRADE_PX_VAR = '--sliders-grade-px';

export interface GradeSvg {
	/** Element id. A hash of the tables, so the same grade is the same filter. */
	id: string;
	/** `tableValues` for `feFuncR/G/B`, 0..1, one entry per 8-bit input. */
	tables: {r: string; g: string; b: string};
	/** `values` for a 4x5 `feColorMatrix`. Absent when it would be the identity. */
	matrix?: string;
}

export interface GradeFilter {
	/** The CSS `filter` value. Empty when the grade draws nothing. */
	css: string;
	/** The SVG filter `css` points at, when it needs one. */
	svg?: GradeSvg;
}

/** Four decimals, trailing zeros off. */
function num(value: number): string {
	return String(Math.round(value * 10000) / 10000);
}

function table(lut: Uint8ClampedArray): string {
	return Array.from(lut, value => num(value / 255)).join(' ');
}

/** FNV-1a, the same hash `effectClass` uses, to base 36. */
function hash(text: string): string {
	let value = 0x811c9dc5;

	for (let index = 0; index < text.length; index++) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 0x01000193) >>> 0;
	}

	return value.toString(36);
}

function blurCss(grade: EntityGrade): string {
	return `blur(calc(${num(gradeLevel(grade, 'blur'))}px * var(${GRADE_PX_VAR}, 1)))`;
}

/** True when only the keys CSS draws natively are off rest. */
export function gradeIsNative(grade: EntityGrade | undefined): boolean {
	const normal = normalizeGrade(grade);

	return (
		!normal ||
		Object.keys(normal).every(key =>
			(NATIVE_KEYS as readonly string[]).includes(key)
		)
	);
}

/**
 * The filter a grade draws with.
 *
 * Native mode ALWAYS writes all four functions in one order, rest values included, because
 * CSS only interpolates two filter lists function by function: `saturate(0.8)` to
 * `hue-rotate(10deg)` would snap, `contrast(1) hue-rotate(0deg) saturate(0.8) blur(…)` to
 * `contrast(1) hue-rotate(10deg) saturate(1) blur(…)` glides.
 */
export function gradeFilter(grade: EntityGrade | undefined): GradeFilter {
	const normal = normalizeGrade(grade);

	if (!normal) {
		return {css: ''};
	}

	if (gradeIsNative(normal)) {
		return {
			css: [
				`contrast(${num(contrastFactor(normal.contrast))})`,
				`hue-rotate(${num(hueDegrees(normal))}deg)`,
				`saturate(${num(saturationAmount(normal))})`,
				blurCss(normal)
			].join(' ')
		};
	}

	const luts = buildChannelLuts(normal);
	const tables = {b: table(luts.b), g: table(luts.g), r: table(luts.r)};
	const identity =
		(normal.hue ?? 0) === 0 &&
		(normal.saturation ?? 0) === 0 &&
		(normal.pop ?? 0) === 0;
	let matrix: string | undefined;

	if (!identity) {
		const m = buildColorMatrix(normal).map(num);

		matrix = `${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0`;
	}

	const id = `sliders-grade-${hash(
		`${tables.r}|${tables.g}|${tables.b}|${matrix ?? ''}`
	)}`;

	return {
		css: `url(#${id})${normal.blur ? ` ${blurCss(normal)}` : ''}`,
		svg: {id, ...(matrix ? {matrix} : {}), tables}
	};
}

// ---------------------------------------------------------------------------
// DOM: one <filter> per distinct grade, counted, removed when nothing uses it.
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Held {
	count: number;
	el: Element;
}

const held = new WeakMap<Document, Map<string, Held>>();

/** How many grade filters a document holds right now. For tests. */
export function gradeFilterCount(doc: Document): number {
	return held.get(doc)?.size ?? 0;
}

function buildFilter(doc: Document, svg: GradeSvg): Element {
	const filter = doc.createElementNS(SVG_NS, 'filter');

	filter.setAttribute('id', svg.id);
	// The spec's default is linearRGB, and the editor's maths and CSS's own shorthand
	// filters are both sRGB. Without this every table would land on a different picture.
	filter.setAttribute('color-interpolation-filters', 'sRGB');
	// The element's own box, no margin: nothing here reaches past a pixel.
	filter.setAttribute('x', '0');
	filter.setAttribute('y', '0');
	filter.setAttribute('width', '1');
	filter.setAttribute('height', '1');

	const transfer = doc.createElementNS(SVG_NS, 'feComponentTransfer');

	for (const [name, values] of [
		['feFuncR', svg.tables.r],
		['feFuncG', svg.tables.g],
		['feFuncB', svg.tables.b]
	] as const) {
		const func = doc.createElementNS(SVG_NS, name);

		func.setAttribute('type', 'table');
		func.setAttribute('tableValues', values);
		transfer.appendChild(func);
	}

	filter.appendChild(transfer);

	if (svg.matrix) {
		const matrix = doc.createElementNS(SVG_NS, 'feColorMatrix');

		matrix.setAttribute('type', 'matrix');
		matrix.setAttribute('values', svg.matrix);
		filter.appendChild(matrix);
	}

	return filter;
}

export interface GradeHandle {
	/** The CSS `filter` value. Empty for no grade. */
	css: string;
	/** Drop this hold. The filter goes when the last one does. Idempotent. */
	release(): void;
}

/**
 * The filter for a grade, with its SVG half in the document for as long as the handle is
 * held.
 *
 * Counted rather than pruned on a sweep: the renderer knows exactly when a sprite stops
 * using a grade (a new grade, an exit, an unmount), and a slider dragged through a hundred
 * values in the grade popover then leaves nothing behind — each value is released the
 * moment the next one is held.
 */
export function holdGrade(
	doc: Document | undefined,
	grade: EntityGrade | undefined
): GradeHandle {
	const {css, svg} = gradeFilter(grade);

	if (!svg || !doc) {
		return {css, release() {}};
	}

	let map = held.get(doc);

	if (!map) {
		map = new Map();
		held.set(doc, map);
	}

	let entry = map.get(svg.id);

	if (!entry) {
		const defs = effectDefs(doc);
		const el = buildFilter(doc, svg);

		defs?.appendChild(el);
		entry = {count: 0, el};
		map.set(svg.id, entry);
	}

	// Re-attached if something swept the document out from under it: a held filter that is
	// not in the document draws nothing, and the sprite would silently lose its grade.
	if (!entry.el.isConnected) {
		effectDefs(doc)?.appendChild(entry.el);
	}

	entry.count++;

	let released = false;

	return {
		css,
		release() {
			if (released) {
				return;
			}

			released = true;

			const current = map!.get(svg.id);

			if (current && --current.count <= 0) {
				current.el.remove();
				map!.delete(svg.id);
			}
		}
	};
}
