/**
 * Geometry for the sprite preview: where art lands inside the character's box, and how far
 * a handle may be dragged outside it.
 *
 * Kept apart from the component because both answers are arithmetic over rectangles, and
 * arithmetic is worth testing without a DOM.
 */

export interface Box {
	width: number;
	height: number;
}

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * The rect an image paints when it is drawn `object-fit: contain` in `box`.
 *
 * The element fills the box, but the picture inside it does not: the shorter axis is
 * letterboxed and centred. Drawing the frame outline against the element would put a line
 * around empty space, which is exactly the thing an author is trying to see past.
 */
export function containRect(natural: Box, box: Box): Rect | undefined {
	if (!(natural.width > 0) || !(natural.height > 0)) {
		return undefined;
	}

	if (!(box.width > 0) || !(box.height > 0)) {
		return undefined;
	}

	const scale = Math.min(box.width / natural.width, box.height / natural.height);
	const width = natural.width * scale;
	const height = natural.height * scale;

	return {
		height,
		left: (box.width - width) / 2,
		top: (box.height - height) / 2,
		width
	};
}

/**
 * How far outside the character's box a fraction may go, given the area on screen the
 * author can actually see and click.
 *
 * Anchors are fractions of the box, but the art is often bigger than the box — a sword
 * hilt or a hat brim can sit well outside it, and pinning one there is a legitimate rig.
 * So handles run to the edges of the preview area rather than stopping at the box.
 */
export function fractionLimits(
	box: DOMRect,
	area: DOMRect
): {maxX: number; maxY: number; minX: number; minY: number} {
	if (!(box.width > 0) || !(box.height > 0)) {
		return {maxX: 1, maxY: 1, minX: 0, minY: 0};
	}

	return {
		maxX: (area.right - box.left) / box.width,
		maxY: (area.bottom - box.top) / box.height,
		minX: (area.left - box.left) / box.width,
		minY: (area.top - box.top) / box.height
	};
}
