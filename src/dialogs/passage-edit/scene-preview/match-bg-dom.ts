/**
 * The DOM half of "Match bg": read the backdrop under a sprite and the sprite itself out of
 * the preview the author is looking at, and hand both to `suggestGrade`.
 *
 * Reads the RENDERER's own elements rather than re-deriving the stage mapping: the backdrop
 * `<img>` is already laid out with the camera, the view zoom and `object-fit: cover`, so
 * the two screen rectangles are the mapping. Rotation is ignored — the bounding box is the
 * sample, which is all a colour average needs.
 *
 * Small canvases on purpose (`SAMPLE`): an average does not need every pixel, and a 4K
 * backdrop drawn full size on every probe would stall the editor.
 */

import type {EntityGrade} from '@sliders/scene-types';
import {colourStats, sourceRect, suggestGrade} from './match-bg';

/** Longest side of a sampling canvas, px. */
const SAMPLE = 64;

export type MatchProbe =
	| {ok: true; grade: EntityGrade | undefined}
	| {ok: false; reason: 'noBg' | 'noSprite' | 'tainted'};

function loaded(img: HTMLImageElement | null | undefined): img is HTMLImageElement {
	return !!img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
}

/** Draws a region of an image small and reads it back. Throws on a tainted canvas. */
function pixels(
	img: HTMLImageElement,
	region: {x: number; y: number; w: number; h: number}
): Uint8ClampedArray | undefined {
	const scale = Math.min(1, SAMPLE / Math.max(region.w, region.h));
	const w = Math.max(1, Math.round(region.w * scale));
	const h = Math.max(1, Math.round(region.h * scale));
	const canvas = img.ownerDocument.createElement('canvas');

	canvas.width = w;
	canvas.height = h;

	const context = canvas.getContext('2d');

	if (!context) {
		return undefined;
	}

	context.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, w, h);

	return context.getImageData(0, 0, w, h).data;
}

function box(el: Element) {
	const rect = el.getBoundingClientRect();

	return {h: rect.height, w: rect.width, x: rect.left, y: rect.top};
}

/** The backdrop on screen: the newest non-tile `.sliders-bg` that has loaded. */
function backdrop(root: ParentNode): HTMLImageElement | undefined {
	const all = Array.from(
		root.querySelectorAll<HTMLImageElement>('img.sliders-bg:not(.sliders-bg-tile)')
	).filter(loaded);

	return all[all.length - 1];
}

function sprite(root: ParentNode, id: string): HTMLImageElement | undefined {
	// Compared, not interpolated into a selector: jsdom has no CSS.escape, and an id is the
	// author's word.
	const box = Array.from(
		root.querySelectorAll<HTMLElement>('.sliders-entity[data-entity-id]')
	).find(el => el.dataset.entityId === id);
	// The live picture: inside the art wrapper, not a pose cross-fade's outgoing ghost
	// and not a grade cross-fade's copy of the wrapper.
	const img =
		box?.querySelector<HTMLImageElement>(
			':scope > .sliders-entity-art > img:not(.sliders-ghost)'
		) ?? undefined;

	return loaded(img) ? img : undefined;
}

/**
 * Try it. `ok: false` says why the button should be off: no backdrop behind the sprite, no
 * picture to measure, or a backdrop served cross-origin without CORS, which taints the
 * canvas and makes its pixels unreadable.
 */
export function probeMatch(root: ParentNode | null, id: string): MatchProbe {
	const bg = root ? backdrop(root) : undefined;

	if (!bg) {
		return {ok: false, reason: 'noBg'};
	}

	const art = root ? sprite(root, id) : undefined;

	if (!art) {
		return {ok: false, reason: 'noSprite'};
	}

	const view = bg.ownerDocument.defaultView;
	const fit = view?.getComputedStyle(bg).objectFit === 'contain' ? 'contain' : 'cover';
	const region = sourceRect(
		box(bg),
		box(art),
		{h: bg.naturalHeight, w: bg.naturalWidth},
		fit
	);

	if (!region) {
		return {ok: false, reason: 'noBg'};
	}

	try {
		const under = pixels(bg, region);
		const own = pixels(art, {
			h: art.naturalHeight,
			w: art.naturalWidth,
			x: 0,
			y: 0
		});
		const bgStats = under && colourStats(under);
		const spriteStats = own && colourStats(own, true);

		if (!bgStats || !spriteStats) {
			return {ok: false, reason: 'noSprite'};
		}

		return {grade: suggestGrade(spriteStats, bgStats), ok: true};
	} catch {
		// SecurityError from getImageData: somebody else's picture, no CORS.
		return {ok: false, reason: 'tainted'};
	}
}
