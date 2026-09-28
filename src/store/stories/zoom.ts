export const minZoom = 0.2;
export const maxZoom = 2;

/**
 * The levels the zoom buttons and keys step through. A wheel zoom lands between
 * them, and a step from there goes to the next one in that direction.
 */
export const zoomSteps = [
	0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2
];

export function clampZoom(zoom: number) {
	return Math.min(Math.max(zoom, minZoom), maxZoom);
}

/**
 * The next zoom step above (direction 1) or below (direction -1) a zoom. Stays
 * put at either end.
 */
export function steppedZoom(
	zoom: number,
	direction: 1 | -1,
	steps: number[] = zoomSteps
) {
	// The epsilon keeps a zoom of 0.6000001 from stepping "up" to 0.6.
	const next =
		direction > 0
			? steps.find(step => step > zoom + 0.001)
			: [...steps].reverse().find(step => step < zoom - 0.001);

	return (
		next ?? Math.min(Math.max(zoom, steps[0]), steps[steps.length - 1])
	);
}
