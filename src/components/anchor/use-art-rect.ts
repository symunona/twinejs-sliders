import * as React from 'react';

export interface ArtRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * Offsets of `art` inside `container`, in layout px.
 *
 * Walks the offset chain rather than subtracting bounding rects, because a rect carries
 * every transform above it: a dialog caught mid-pop is scaled, and rect numbers measured
 * then are wrong the moment the animation lands. Offsets are transform-free and
 * scroll-free, so one measurement holds.
 *
 * Falls back to rects when the chain does not reach the container, which only happens if
 * the container is not a positioned element.
 */
function offsetRect(art: HTMLElement, container: HTMLElement): ArtRect {
	let left = 0;
	let top = 0;
	let node: HTMLElement | null = art;

	while (node && node !== container) {
		left += node.offsetLeft;
		top += node.offsetTop;
		node = node.offsetParent as HTMLElement | null;
	}

	if (!node) {
		const a = art.getBoundingClientRect();
		const c = container.getBoundingClientRect();

		return {height: a.height, left: a.left - c.left, top: a.top - c.top, width: a.width};
	}

	return {height: art.offsetHeight, left, top, width: art.offsetWidth};
}

/**
 * Where an image or canvas actually ended up inside its positioned container, in px.
 *
 * Measured rather than derived. Art in this app is letterboxed by `max-width`/`max-height`
 * and its own aspect ratio, so the painted rect is neither the container's rect nor
 * anything CSS can hand a sibling overlay — and an anchor marker drawn against the
 * container instead of the art sits beside the point it claims to mark.
 *
 * Re-measures when either element resizes, which also covers the image finishing loading:
 * that is what gives the element its intrinsic size in the first place.
 */
export function useArtRect(
	art: React.RefObject<HTMLElement>,
	container: React.RefObject<HTMLElement>
): ArtRect | undefined {
	const [rect, setRect] = React.useState<ArtRect>();
	/**
	 * React attaches a parent's ref only after its children's layout effects have run, and
	 * the container here is a parent of the marker — so on the very first pass there is
	 * nothing to measure against. One passive tick later both elements are in place.
	 */
	const [mounted, setMounted] = React.useState(false);

	React.useEffect(() => setMounted(true), []);

	React.useLayoutEffect(() => {
		const artEl = art.current;
		const containerEl = container.current;

		if (!artEl || !containerEl) {
			return;
		}

		function measure() {
			setRect(current => {
				const next = offsetRect(artEl!, containerEl!);

				// Same numbers, same object: this runs from a ResizeObserver, and a fresh
				// object every tick would re-render every consumer forever.
				return current &&
					current.left === next.left &&
					current.top === next.top &&
					current.width === next.width &&
					current.height === next.height
					? current
					: next;
			});
		}

		measure();

		// Built from the element's OWN window, not this one: a preview portalled into a
		// popped-out window is in another realm, and an observer from this realm never
		// delivers for it.
		const view = artEl.ownerDocument.defaultView as
			| (Window & typeof globalThis)
			| null;

		if (!view?.ResizeObserver) {
			return;
		}

		const observer = new view.ResizeObserver(measure);

		observer.observe(artEl);
		observer.observe(containerEl);

		return () => observer.disconnect();
	}, [art, container, mounted]);

	return rect;
}
