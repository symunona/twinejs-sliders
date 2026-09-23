/**
 * The asset editor's side of walk areas: moving one between the SOURCE picture the editor
 * shows and the BAKED picture the meta stores, and the compares `dirty` needs.
 *
 * Why two frames at all: the editor draws on the whole original with the crop drawn over
 * it, the same way it places the anchor, while a walk area is stored against the finished
 * bytes the player draws. So the editor holds it in source fractions and folds the crop in
 * on the way out. A crop changed after drawing therefore moves nothing on screen -- the
 * points stay on their pixels -- and only the save decides what the crop cut off.
 */
import {remapWalkArea} from '@sliders/scene-core';
import type {CropRect, Frac2, WalkArea} from '@sliders/scene-types';

/** A source-fraction point as a fraction of the cropped picture. Unclamped. */
export function toCropFrac(
	p: Frac2,
	crop: CropRect,
	sourceWidth: number,
	sourceHeight: number
): Frac2 {
	return {
		x: (p.x * sourceWidth - crop.x) / crop.w,
		y: (p.y * sourceHeight - crop.y) / crop.h
	};
}

/** The inverse of `toCropFrac`. */
export function fromCropFrac(
	p: Frac2,
	crop: CropRect,
	sourceWidth: number,
	sourceHeight: number
): Frac2 {
	return {
		x: (crop.x + p.x * crop.w) / sourceWidth,
		y: (crop.y + p.y * crop.h) / sourceHeight
	};
}

function validCrop(crop: CropRect | undefined, w: number, h: number): boolean {
	return !!crop && crop.w > 0 && crop.h > 0 && w > 0 && h > 0;
}

/**
 * What a save writes: the walk area as fractions of the cropped picture, rings clipped
 * to it, shapes the crop removed dropped. Undefined for an empty area, so an asset that
 * never had one gets no key.
 */
export function walkToBaked(
	walk: WalkArea,
	crop: CropRect,
	sourceWidth: number,
	sourceHeight: number
): WalkArea | undefined {
	if (emptyWalk(walk)) {
		return undefined;
	}

	const baked = validCrop(crop, sourceWidth, sourceHeight)
		? remapWalkArea(walk, p => toCropFrac(p, crop, sourceWidth, sourceHeight))
		: remapWalkArea(walk, p => p);

	return emptyWalk(baked) ? undefined : baked;
}

/** A stored walk area put back over the whole original, for editing. */
export function walkToSource(
	walk: WalkArea | undefined,
	crop: CropRect | undefined,
	sourceWidth: number,
	sourceHeight: number
): WalkArea {
	if (!walk) {
		return {shapes: []};
	}

	return crop && validCrop(crop, sourceWidth, sourceHeight)
		? remapWalkArea(
				walk,
				p => fromCropFrac(p, crop, sourceWidth, sourceHeight),
				false
		  )
		: walk;
}

/** No ring worth keeping and no depth. What an absent `walk` means. */
export function emptyWalk(walk: WalkArea | undefined): boolean {
	return (
		!walk ||
		(!walk.depth && !walk.shapes.some(shape => shape.points.length >= 3))
	);
}

/** Whether two walk areas would store the same. Absent and empty are one thing. */
export function sameWalk(
	a: WalkArea | undefined,
	b: WalkArea | undefined
): boolean {
	if (emptyWalk(a) || emptyWalk(b)) {
		return emptyWalk(a) === emptyWalk(b);
	}

	return JSON.stringify(normal(a!)) === JSON.stringify(normal(b!));
}

function normal(walk: WalkArea) {
	return {
		depth: walk.depth
			? {
					far: {scale: walk.depth.far.scale, y: walk.depth.far.y},
					near: {scale: walk.depth.near.scale, y: walk.depth.near.y}
			  }
			: null,
		shapes: walk.shapes
			.filter(shape => shape.points.length >= 3)
			.map(shape => ({
				id: shape.id,
				op: shape.op,
				points: shape.points.map(p => [p.x, p.y])
			}))
	};
}

/**
 * Everything that relates the picture on screen to the picture a save bakes: the source
 * size, the crop and the output size. Resizing moves no fraction, but it can change the
 * picture's aspect, and the aspect decides how the backdrop covers the stage.
 */
export interface WalkFrame {
	sourceWidth: number;
	sourceHeight: number;
	crop: CropRect;
	out: {width: number; height: number};
}

export function frameToBaked(frame: WalkFrame, p: Frac2): Frac2 {
	return validCrop(frame.crop, frame.sourceWidth, frame.sourceHeight)
		? toCropFrac(p, frame.crop, frame.sourceWidth, frame.sourceHeight)
		: p;
}

export function frameToSource(frame: WalkFrame, p: Frac2): Frac2 {
	return validCrop(frame.crop, frame.sourceWidth, frame.sourceHeight)
		? fromCropFrac(p, frame.crop, frame.sourceWidth, frame.sourceHeight)
		: p;
}

/** The baked picture's size, what `scene-core` measures distance and cover against. */
export function bakedSize(frame: WalkFrame): {w: number; h: number} {
	return {h: frame.out.height, w: frame.out.width};
}

/**
 * The stage's height as a fraction of the SOURCE picture's height.
 *
 * The backdrop covers the stage, so the stage is as tall as the baked picture unless the
 * picture is narrower than the stage's aspect, when it is cropped top and bottom and the
 * stage is shorter. A character's size is a fraction of stage height, so this is what
 * turns `characterMetrics` into pixels over the art.
 */
export function stageHeightOfSource(frame: WalkFrame, aspect: number): number {
	const {height, width} = frame.out;

	if (!(height > 0) || !(width > 0) || !(frame.sourceHeight > 0)) {
		return 1;
	}

	const stageBaked = Math.min(height, width / aspect);
	const cropH = frame.crop.h > 0 ? frame.crop.h : frame.sourceHeight;

	return (stageBaked * (cropH / height)) / frame.sourceHeight;
}
