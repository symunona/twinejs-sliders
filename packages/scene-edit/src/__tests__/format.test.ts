/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {LAYER_BASELINE} from '@sliders/scene-types';
import {formatAt, formatNumber, formatValue} from '../format';

describe('formatNumber', () => {
	it('rounds to 3 decimals and strips trailing zeros', () => {
		expect(formatNumber(-0.40000000000000002)).toBe('-0.4');
		expect(formatNumber(-0.4)).toBe('-0.4');
		expect(formatNumber(0.1234567)).toBe('0.123');
		expect(formatNumber(1)).toBe('1');
		expect(formatNumber(1.1)).toBe('1.1');
		expect(formatNumber(0.4005)).toBe('0.401');
	});

	it('never emits -0, which reads as a bug in a diff', () => {
		expect(formatNumber(-0.0001)).toBe('0');
		expect(formatNumber(-0)).toBe('0');
	});

	it('falls back to 0 rather than writing NaN into the file', () => {
		expect(formatNumber(Number.NaN)).toBe('0');
		expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('0');
	});
});

describe('formatAt', () => {
	it('stays a bare number at the layer baseline', () => {
		expect(formatAt({x: -0.4, y: LAYER_BASELINE})).toBe('-0.4');
		expect(formatAt({x: 0, y: LAYER_BASELINE})).toBe('0');
	});

	it('writes a pair once y leaves the baseline', () => {
		expect(formatAt({x: 0.1, y: -0.2})).toBe('[0.1, -0.2]');
		expect(formatAt({x: 0, y: 0})).toBe('[0, 0]');
	});

	it('compares y after rounding, so float noise does not promote a bare number', () => {
		expect(formatAt({x: -0.4, y: LAYER_BASELINE + 1e-9})).toBe('-0.4');
	});
});

describe('formatValue', () => {
	it('writes booleans bare', () => {
		expect(formatValue('flip', true)).toBe('true');
		expect(formatValue('flip', false)).toBe('false');
	});

	it('leaves plain strings unquoted', () => {
		expect(formatValue('frame', 'arms-crossed')).toBe('arms-crossed');
		expect(formatValue('layer', 'back')).toBe('back');
	});

	it('quotes strings that would re-parse as something else', () => {
		expect(formatValue('frame', '1.5')).toBe('"1.5"');
		expect(formatValue('frame', 'true')).toBe('"true"');
		expect(formatValue('frame', '~')).toBe('"~"');
		expect(formatValue('frame', '')).toBe('""');
		// YAML 1.2 core — which is what the parser is pinned to — reads `yes` as a plain
		// string, so quoting it would be noise the author did not ask for.
		expect(formatValue('frame', 'yes')).toBe('yes');
	});

	it('keeps multi-line strings inline as double quotes, never a block scalar', () => {
		const written = formatValue('say', 'one\ntwo');

		expect(written).toBe('"one\\ntwo"');
		expect(written).not.toContain('\n');
	});

	it('rounds numbers inside a pair', () => {
		expect(formatValue('at', [0.1234567, -0.2])).toBe('[0.123, -0.2]');
	});

	it('writes null as the tilde spec 02 uses for removal', () => {
		expect(formatValue('at', null)).toBe('~');
	});
});
