/**
 * Asset effects — the DOM half (spec 14).
 *
 * `effects.ts` decides what an effect looks like. This decides where it lives: the layers it
 * needs as elements, the generated stylesheet injected once per distinct parameter set, and
 * the two support objects (a stylesheet of constants and an SVG `<defs>`) every effect shares.
 *
 * Both consumers go through here — the asset editor's live preview and the renderer's
 * sprites — so the preview an author tunes is the same DOM the player builds, layer for layer.
 */

import type {AssetEffect} from '@sliders/scene-types';
import {
	effectClass,
	effectCss,
	effectIsIdle,
	effectLayers,
	normalizeEffect
} from './effects';

const SUPPORT_STYLE_ID = 'sliders-fx-styles';

const SUPPORT_DEFS_ID = 'sliders-fx-defs';

/** Cheap snow. Inline so an effect needs no asset of its own and works offline. */
const NOISE_URI =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

/**
 * Everything about an effect that does not depend on its parameters.
 *
 * Separate from `RENDER_DOM_CSS` because the asset editor wants effects without the
 * renderer's stage, letterbox and dialogue styles, and a preview that quietly inherited
 * `.sliders-root`'s black background would be lying about what the asset looks like.
 */
export const FX_CSS = `
.sliders-fx {
	position: absolute;
	inset: 0;
	overflow: hidden;
	/* The host covers the art, so without this it would eat every click meant for the
	   sprite underneath — including the visual editor's hit tests. */
	pointer-events: none;
}

.sliders-fx-layer {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	/* Matches the renderer's own sprite rule, so a layer lines up with the <img> it was
	   cloned from rather than stretching to the box. */
	object-fit: contain;
	will-change: translate, clip-path, opacity, background-position;
}

/* A plane's picture fills the stage, so its layers have to as well. */
.sliders-fx[data-fx-fit='cover'] > .sliders-fx-layer {
	object-fit: cover;
	object-position: 50% 50%;
}

/* The colour channels.

   \`lighten\` rather than \`screen\`, and this is the whole trick: a layer holding only the red
   channel is darker than the base in green and blue and equal in red, so a per-channel max
   against the base is the IDENTITY while the layer is not displaced. Move it sideways and
   only the difference shows — a red fringe on one edge, cyan on the other. Screen would
   brighten the picture even at rest, which reads as a washed-out photo rather than a signal
   coming apart. */
.sliders-fx-layer[data-fx='split-a'],
.sliders-fx-layer[data-fx='split-b'] {
	mix-blend-mode: lighten;
}

.sliders-fx-layer[data-fx='split-a'] { filter: url(#sliders-fx-chan-a); }
.sliders-fx-layer[data-fx='split-b'] { filter: url(#sliders-fx-chan-b); }

.sliders-fx-layer[data-fx='scanlines'] {
	background-image: repeating-linear-gradient(
		to bottom,
		rgba(0, 0, 0, 0.55) 0 1px,
		rgba(255, 255, 255, 0.04) 1px 3px
	);
	mix-blend-mode: multiply;
}

.sliders-fx-layer[data-fx='noise'] {
	background-image: ${NOISE_URI};
	mix-blend-mode: screen;
}

@keyframes sliders-fx-scanline-drift {
	from { background-position: 0 0; }
	to { background-position: 0 6px; }
}

/* An author who has asked the OS for less motion gets the picture and none of the
   interference. The base <img> is not ours, so hiding the overlay leaves the asset intact
   rather than blank. */
@media (prefers-reduced-motion: reduce) {
	.sliders-fx { display: none; }
}
`;

/**
 * The channel-isolating filters, as an inline SVG the CSS above points at by fragment.
 *
 * A filter cannot be expressed in CSS — `filter: url()` is the only way to touch one channel
 * without touching the others — and a fragment reference resolves against the DOCUMENT, so
 * these have to be in the same document as the layers. That is why it is injected rather than
 * shipped as a file: the published player is one HTML file with no assets beside it.
 */
const SUPPORT_DEFS_SVG = `<filter id="sliders-fx-chan-a" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter><filter id="sliders-fx-chan-b" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/></filter>`;

function head(doc: Document): HTMLElement | SVGElement | null {
	return doc.head ?? doc.documentElement;
}

/**
 * Puts the shared stylesheet and the filter definitions in a document. Idempotent, so every
 * mount can call it.
 */
export function injectEffectSupport(
	doc: Document | undefined = globalThis.document
): void {
	if (!doc) {
		return;
	}

	const parent = head(doc);

	if (!parent) {
		return;
	}

	if (!doc.getElementById(SUPPORT_STYLE_ID)) {
		const style = doc.createElement('style');

		style.id = SUPPORT_STYLE_ID;
		style.textContent = FX_CSS;
		parent.appendChild(style);
	}

	if (!doc.getElementById(SUPPORT_DEFS_ID)) {
		const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');

		svg.setAttribute('id', SUPPORT_DEFS_ID);
		// Not `display: none`: a filter inside a hidden subtree is not applied in every
		// engine. Zero size and out of flow keeps it live and invisible.
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('width', '0');
		svg.setAttribute('height', '0');
		svg.setAttribute(
			'style',
			'position:absolute;width:0;height:0;overflow:hidden'
		);
		svg.innerHTML = `<defs>${SUPPORT_DEFS_SVG}</defs>`;
		parent.appendChild(svg);
	}
}

/**
 * Injects the generated rules for one parameter set and hands back its class name.
 *
 * One `<style>` per distinct parameter set, keyed by the hash, rather than one per host: ten
 * sprites carrying the same effect share a stylesheet, and re-tuning a slider adds a new one
 * instead of rewriting the old — which matters because rewriting a `<style>` that an animation
 * is running against restarts every animation in the document that uses it.
 *
 * The cost is a stylesheet per intermediate value while a slider is being dragged. Bounded by
 * `pruneEffectCss`, which the preview calls when the drag ends.
 */
export function injectEffectCss(
	effect: AssetEffect,
	doc: Document | undefined = globalThis.document
): string {
	const className = effectClass(effect);

	if (!doc) {
		return className;
	}

	injectEffectSupport(doc);

	const parent = head(doc);

	if (parent && !doc.getElementById(className)) {
		const style = doc.createElement('style');

		style.id = className;
		style.dataset.slidersFx = 'generated';
		style.textContent = effectCss(effect);
		parent.appendChild(style);
	}

	return className;
}

/**
 * Drops generated stylesheets nothing is using any more.
 *
 * Dragging a slider leaves one behind per value it passed through, and a long tuning session
 * is hundreds. Called on pointer-up rather than on every change: removing the stylesheet the
 * live preview is running against would strip the effect mid-drag.
 */
export function pruneEffectCss(
	keep: Iterable<string>,
	doc: Document | undefined = globalThis.document
): void {
	if (!doc) {
		return;
	}

	const keeping = new Set(keep);

	for (const style of Array.from(
		doc.querySelectorAll<HTMLStyleElement>('style[data-sliders-fx=generated]')
	)) {
		if (!keeping.has(style.id)) {
			style.remove();
		}
	}
}

export interface SyncEffectOptions {
	/** How a layer fits its box. Mirrors the sprite's own `object-fit`. */
	fit?: 'contain' | 'cover';
	/** The sprite's `object-position`, so a layer letterboxes exactly as the art does. */
	objectPosition?: string;
}

/**
 * Brings a host element in line with an effect: the right layers, in the right order, all
 * pointed at `src`, under the generated class.
 *
 * Reuses the elements it finds. A glitch is a running animation, and rebuilding the layers on
 * every parameter change would restart all of them from frame zero — the tear would appear to
 * stutter back to the top of its loop each time a slider moved by one.
 *
 * `src` empty, no effect, or an effect with every knob at zero all mean the same thing: empty
 * the host. Nothing is left behind, so an asset whose effect was cleared costs nothing.
 */
export function syncEffect(
	host: HTMLElement,
	effect: AssetEffect | undefined,
	src: string | undefined,
	options: SyncEffectOptions = {}
): void {
	const doc = host.ownerDocument;
	const normal = normalizeEffect(effect);
	const layers = src ? effectLayers(normal) : [];

	if (!normal || !layers.length || effectIsIdle(normal)) {
		host.className = 'sliders-fx';
		host.removeAttribute('data-fx');
		host.textContent = '';
		return;
	}

	const className = injectEffectCss(normal, doc);

	host.className = `sliders-fx ${className}`;
	host.dataset.fx = normal.kind;

	if (options.fit === 'cover') {
		host.dataset.fxFit = 'cover';
	} else {
		delete host.dataset.fxFit;
	}

	// Keyed by role and band so a layer keeps its element across a parameter change. Band
	// count is the one change that cannot be absorbed -- a new band has no element to reuse --
	// and that is fine: the bands that already existed keep their running animations.
	const existing = new Map<string, HTMLElement>();

	for (const child of Array.from(host.children)) {
		const el = child as HTMLElement;

		existing.set(`${el.dataset.fx ?? ''}:${el.dataset.band ?? ''}`, el);
	}

	const wanted: HTMLElement[] = [];

	for (const layer of layers) {
		const key = `${layer.role}:${layer.band ?? ''}`;
		let el = existing.get(key);

		existing.delete(key);

		if (!el) {
			el = doc.createElement(layer.art ? 'img' : 'div');
			el.className = 'sliders-fx-layer';
			el.dataset.fx = layer.role;

			if (layer.band !== undefined) {
				el.dataset.band = String(layer.band);
			}

			if (layer.art) {
				const img = el as HTMLImageElement;

				img.alt = '';
				img.draggable = false;
				img.decoding = 'async';
			}
		}

		if (layer.art) {
			const img = el as HTMLImageElement;

			if (img.getAttribute('src') !== src) {
				img.src = src!;
			}

			// Written inline because the sprite's own is inline too: a stylesheet cannot
			// outrank `applyFrameFit`, and a layer whose pixels sit a few percent off the
			// art's reads as a permanent double image rather than as a tear.
			if (options.objectPosition) {
				img.style.objectPosition = options.objectPosition;
			}
		}

		wanted.push(el);
	}

	for (const orphan of existing.values()) {
		orphan.remove();
	}

	// Append in paint order. `appendChild` on an element already in place is a move, and a
	// move that changes nothing still does not restart a CSS animation.
	for (const el of wanted) {
		host.appendChild(el);
	}
}
