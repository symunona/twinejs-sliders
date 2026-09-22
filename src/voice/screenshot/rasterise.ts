/**
 * Turn a mounted stage into a picture the model can look at.
 *
 * The stage is DOM (`packages/render-dom`) — sprites are `<img>` under CSS transforms and
 * bubbles are elements with borders and clip paths. There is no canvas renderer to reuse,
 * and writing one is a bigger job than this whole feature, so the picture is made the only
 * other way: serialise the subtree into an SVG `<foreignObject>` and draw that to a canvas.
 * That is what `html-to-image` does.
 *
 * Two things must be inlined or the picture LIES, which is worse than no picture:
 *
 * - Web fonts. A bubble measured with the story's font and drawn with the fallback wraps
 *   differently, so the model would be looking at a layout the reader never sees.
 * - Images. A `blob:` URL means nothing inside a serialised SVG; every sprite has to be a
 *   data URI by the time the canvas draws.
 *
 * `html-to-image` does both. Assets are same-origin OPFS blobs, so nothing taints the
 * canvas and `toDataURL` is allowed to read it back.
 */

import {toCanvas} from 'html-to-image';

/** The long edge the model gets. Bigger costs tokens and shows it nothing new. */
export const SCREENSHOT_LONG_EDGE = 768;

export interface Raster {
	/** Base64, no data-URI prefix — that is what an inline image part wants. */
	data: string;
	height: number;
	mime: string;
	width: number;
}

/**
 * Wait until the thing on screen is the thing that will be drawn.
 *
 * A stage that has just mounted is a stage whose sprites are still decoding, and a
 * screenshot taken a frame too early is a picture of empty boxes — which the model will
 * then describe with total confidence.
 */
export async function settle(node: HTMLElement): Promise<void> {
	const images = [...node.querySelectorAll('img')];

	await Promise.all([
		// `decode()` rejects on a broken image. A missing sprite is a thing the author may
		// well be asking about, so it must not stop the picture being taken.
		...images.map(image => image.decode().catch(() => undefined)),
		document.fonts?.ready ?? Promise.resolve()
	]);

	// One more frame, so the layout the decoded images caused has actually happened.
	await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
}

/** How much to shrink a canvas so its long edge is `longEdge`. Never enlarges. */
export function scaleFor(
	width: number,
	height: number,
	longEdge = SCREENSHOT_LONG_EDGE
): number {
	return Math.min(1, longEdge / Math.max(width, height));
}

/** Rasterise a node, downscaled so its long edge is `longEdge`. */
export async function rasterise(
	node: HTMLElement,
	longEdge = SCREENSHOT_LONG_EDGE
): Promise<Raster> {
	await settle(node);

	const rect = node.getBoundingClientRect();

	if (rect.width < 1 || rect.height < 1) {
		throw new Error('the stage has no size on screen yet');
	}

	const canvas = await toCanvas(node, {
		// Pixel ratio 1: the model does not need the author's retina display, and a 2x
		// canvas is four times the bytes for the same picture.
		pixelRatio: 1,
		skipFonts: false
	});

	const scale = scaleFor(canvas.width, canvas.height, longEdge);
	const out = document.createElement('canvas');

	out.width = Math.max(1, Math.round(canvas.width * scale));
	out.height = Math.max(1, Math.round(canvas.height * scale));

	const context = out.getContext('2d');

	if (!context) {
		throw new Error('this browser would not give us a 2d canvas');
	}

	context.drawImage(canvas, 0, 0, out.width, out.height);

	const url = out.toDataURL('image/png');

	return {
		data: url.slice(url.indexOf(',') + 1),
		height: out.height,
		mime: 'image/png',
		width: out.width
	};
}
