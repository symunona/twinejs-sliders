/**
 * The sizes the passage editor's Size menu offers.
 *
 * A passage has no size *name* on it--only width and height--so the dimensions are the
 * enum. `largeWithPreview` is therefore a size nothing else uses: 215 tall is a wide
 * card's worth of text (100) plus a 16:9 stage the width of the card (107, plus the
 * margin above it). The stage is drawn to its own aspect, so any extra height here would
 * be letterbox bars rather than a bigger picture.
 *
 * `widePreview` is the picture and nothing else: a 16:9 card, the title laid
 * over the top of the stage. As wide as a `wide` card; 113 is 16:9 of that, and unique,
 * so the dimensions still name it (100 would collide with `wide`).
 */
export const passageSizes = {
	small: {height: 100, width: 100},
	large: {height: 200, width: 200},
	tall: {height: 200, width: 100},
	wide: {height: 100, width: 200},
	largeWithPreview: {height: 215, width: 200},
	widePreview: {height: 113, width: 200}
} as const;

export function isPassageSize(
	passage: {height: number; width: number},
	size: {height: number; width: number}
): boolean {
	return passage.height === size.height && passage.width === size.width;
}

/** Does this passage's size ask for its scene to be drawn on the card? */
export function passagePreviewsScene(passage: {
	height: number;
	width: number;
}): boolean {
	return (
		isPassageSize(passage, passageSizes.largeWithPreview) ||
		passageIsPreviewOnly(passage)
	);
}

/** Is this card the scene alone, title over the picture, no excerpt? */
export function passageIsPreviewOnly(passage: {
	height: number;
	width: number;
}): boolean {
	return isPassageSize(passage, passageSizes.widePreview);
}
