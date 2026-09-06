import {Frac2} from '@sliders/scene-types';

/**
 * The nine named spots on a frame, as fractions of it.
 *
 * Ordered the way the grid draws them: rows top to bottom, columns left to right, so the
 * selector can lay them out with a single map.
 */
export const ANCHOR_PRESETS = [
	{id: 'top-left', value: {x: 0, y: 0}},
	{id: 'top-center', value: {x: 0.5, y: 0}},
	{id: 'top-right', value: {x: 1, y: 0}},
	{id: 'middle-left', value: {x: 0, y: 0.5}},
	{id: 'middle-center', value: {x: 0.5, y: 0.5}},
	{id: 'middle-right', value: {x: 1, y: 0.5}},
	{id: 'bottom-left', value: {x: 0, y: 1}},
	{id: 'bottom-center', value: {x: 0.5, y: 1}},
	{id: 'bottom-right', value: {x: 1, y: 1}}
] as const;

export type AnchorPresetId = (typeof ANCHOR_PRESETS)[number]['id'];

/** Feet, bottom centre — what an asset with no anchor of its own is drawn at. */
export const DEFAULT_ANCHOR: Frac2 = {x: 0.5, y: 1};

/**
 * How close a hand-placed anchor has to be to a preset before the selector calls it that
 * preset. Anchors are stored to three decimals, so anything looser would light up a preset
 * button for a point visibly beside it.
 */
const PRESET_TOLERANCE = 0.0005;

/** The preset an anchor is sitting on, or undefined when it is somewhere of its own. */
export function anchorPreset(origin: Frac2 | undefined): AnchorPresetId | undefined {
	if (!origin) {
		return undefined;
	}

	return ANCHOR_PRESETS.find(
		preset =>
			Math.abs(preset.value.x - origin.x) <= PRESET_TOLERANCE &&
			Math.abs(preset.value.y - origin.y) <= PRESET_TOLERANCE
	)?.id;
}

/** Clamped to the frame and rounded to three decimals, which is finer than anyone can click. */
export function roundAnchor(origin: Frac2): Frac2 {
	return {x: roundFraction(origin.x), y: roundFraction(origin.y)};
}

function roundFraction(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

export function sameAnchor(a: Frac2 | undefined, b: Frac2 | undefined): boolean {
	if (!a || !b) {
		return a === b;
	}

	return a.x === b.x && a.y === b.y;
}
