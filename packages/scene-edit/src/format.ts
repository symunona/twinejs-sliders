/**
 * How a written value looks. Every number that reaches the text goes through here.
 *
 * Coordinates are normalized floats coming out of pointer math, so an unrounded write
 * produces `at: -0.40000000000000002` — legal YAML, unreadable diff, and it grows a digit
 * every time somebody nudges the sprite (spec 07, "Snapping and guides").
 */

import {stringify} from 'yaml';
import {LAYER_BASELINE, type Vec2} from '@sliders/scene-types';

const DECIMALS = 3;

/** Rounded to 3 decimals, trailing zeros stripped: `-0.4`, never `-0.400`. */
export function formatNumber(value: number): string {
	if (!Number.isFinite(value)) {
		return '0';
	}

	const rounded = Number(value.toFixed(DECIMALS));

	// `Number((-0.0001).toFixed(3))` is -0, and `String(-0)` is '0' in JS but '-0' is what
	// a naive template literal on the raw value would give. Normalize it either way.
	return Object.is(rounded, -0) ? '0' : String(rounded);
}

/**
 * `at: -0.4` (bare, y at the layer baseline) or `at: [x, y]`.
 *
 * Bare stays bare. A horizontal drag on `at: -0.4` that wrote `at: [-0.3, -0.85]` would
 * burn the baseline constant into every author's file — the moment LAYER_BASELINE moves,
 * or a character's height changes, those scenes are pinned to the old floor.
 */
export function formatAt(at: Vec2, baseline = LAYER_BASELINE): string {
	const x = formatNumber(at.x);

	if (formatNumber(at.y) === formatNumber(baseline)) {
		return x;
	}

	return `[${x}, ${formatNumber(at.y)}]`;
}

function isVec2(value: unknown): value is Vec2 {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as Vec2).x === 'number' &&
		typeof (value as Vec2).y === 'number'
	);
}

/** One scalar, inline. Never a block scalar — the result has to fit inside `{…}`. */
function formatScalar(value: unknown): string {
	if (value === null || value === undefined) {
		return '~';
	}

	if (typeof value === 'number') {
		return formatNumber(value);
	}

	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}

	if (typeof value === 'string') {
		// A multi-line string would come back from `stringify` as a `|-` block, which
		// cannot live in a flow map. Double quotes are the only inline form that survives
		// embedded newlines.
		if (/[\n\r]/.test(value)) {
			return JSON.stringify(value);
		}

		// Otherwise let yaml decide about quoting: it knows that `yes`, `1.5` and `~`
		// re-parse as non-strings and need quotes, and that `idle` does not.
		return stringify(value, {lineWidth: 0}).replace(/\n$/, '');
	}

	return stringify(value, {lineWidth: 0}).trim();
}

/**
 * The written form of one entity key's value. `at` is the only key with its own shape.
 *
 * `relative` says this entity has an `of:` parent, which moves the baseline a bare number
 * is measured against from the floor to zero. Without it a child whose y offset happened to
 * be exactly the layer baseline would be written bare and read back as zero — the sprite
 * would jump a stage-height on the next parse.
 */
export function formatValue(
	key: string,
	value: unknown,
	options: {relative?: boolean} = {}
): string {
	if (key === 'at' && isVec2(value)) {
		return formatAt(value, options.relative ? 0 : LAYER_BASELINE);
	}

	if (Array.isArray(value)) {
		return `[${value.map(item => formatScalar(item)).join(', ')}]`;
	}

	return formatScalar(value);
}
