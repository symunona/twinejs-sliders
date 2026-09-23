/**
 * `ease:` — the curve a beat's movement takes, where `dur:` is its length.
 *
 * Three shapes and four places: a scalar or a per-kind map, at the top of the scene, on a
 * beat body, inside a `box:` map, and (scalar only) on one step of a pose cycle.
 */

import {parseScene} from '../parse-scene';

function scene(text: string) {
	return parseScene(text);
}

describe('ease: scalar form', () => {
	it('reads a preset name on a beat', () => {
		const {errors, scene: parsed} = scene(
			'cast:\n  mira: {at: 0}\nbeats:\n  - mira: {at: 0.4, dur: 0.6, ease: back_out}\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.beats[0].ease).toBe('back_out');
	});

	it('reads the scene default, beside autoAdvance', () => {
		const {errors, scene: parsed} = scene(
			'autoAdvance: 1\nease: ease_in_out\nbeats: []\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.ease).toBe('ease_in_out');
	});

	it('takes a CSS timing function written out in full', () => {
		const {errors, scene: parsed} = scene(
			'ease: cubic-bezier(0.34, 1.56, 0.64, 1)\nbeats: []\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.ease).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
	});

	it('takes a linear() curve, which is how bounce_out is written', () => {
		const {errors, scene: parsed} = scene(
			'ease: linear(0, 0.5, 0.9, 1)\nbeats: []\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.ease).toBe('linear(0, 0.5, 0.9, 1)');
	});

	it('is "no opinion" when written as ~', () => {
		const {errors, scene: parsed} = scene('ease: ~\nbeats: []\n');

		expect(errors).toEqual([]);
		expect(parsed.ease).toBeUndefined();
	});

	it('warns on an unknown word, keeps it, and offers a fix', () => {
		const {errors, scene: parsed} = scene('ease: back_ou\nbeats: []\n');

		expect(errors).toHaveLength(1);
		expect(errors[0].severity).toBe('warning');
		expect(errors[0].message).toContain('back_ou');
		// The text and the model must never disagree: a warning does not edit the scene.
		expect(parsed.ease).toBe('back_ou');
		expect(errors[0].fix?.text).toBe('back_out');
	});
});

describe('ease: map form', () => {
	it('reads one curve per transition kind', () => {
		const {errors, scene: parsed} = scene(
			'cast:\n  tav: {at: 0}\nbeats:\n  - tav: {at: -0.3, ease: {move: ease_out, scale: linear}}\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.beats[0].ease).toEqual({move: 'ease_out', scale: 'linear'});
	});

	it('rejects a key that is not a transition kind', () => {
		const {errors} = scene('ease: {sprite: linear}\nbeats: []\n');

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].message).toContain('sprite');
	});

	it('keeps the kinds it understood when one is wrong', () => {
		const {scene: parsed} = scene(
			'ease: {move: back_out, sprite: linear}\nbeats: []\n'
		);

		expect(parsed.ease).toEqual({move: 'back_out'});
	});

	it('warns per value, naming the kind it came from', () => {
		const {errors} = scene('ease: {move: nonsense}\nbeats: []\n');

		expect(errors).toHaveLength(1);
		expect(errors[0].severity).toBe('warning');
		expect(errors[0].message).toContain('nonsense');
	});

	it('refuses a list', () => {
		const {errors, scene: parsed} = scene('ease: [back_out]\nbeats: []\n');

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
		expect(parsed.ease).toBeUndefined();
	});
});

describe('ease: where it is allowed', () => {
	it('rides inside a box: map', () => {
		const {errors, scene: parsed} = scene(
			'beats:\n  - box: {text: "The door opens.", dur: 0.5, ease: ease_in}\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.beats[0].ease).toBe('ease_in');
	});

	it('is NOT an entity key — timing belongs to a moment, not a sprite', () => {
		const {errors} = scene('cast:\n  mira: {at: 0, ease: back_out}\nbeats: []\n');

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].hint).toContain('beat');
	});

	it('cannot be the whole of a beat', () => {
		const {errors, scene: parsed} = scene(
			'cast:\n  mira: {at: 0}\nbeats:\n  - mira: {ease: back_out}\n'
		);

		expect(parsed.beats).toHaveLength(0);
		expect(errors[0].hint).toContain('ease:');
	});
});

describe('ease: on a pose step', () => {
	it('reads a scalar on one step of a cycle', () => {
		const {errors, scene: parsed} = scene(
			'cast:\n  mira: {pose: [{name: step_a, at: 0.1, ease: linear}, step_b]}\nbeats: []\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.entities.mira?.steps?.[0].ease).toBe('linear');
		expect(parsed.entities.mira?.steps?.[1].ease).toBeUndefined();
	});

	it('warns on an unknown word there too', () => {
		const {errors, scene: parsed} = scene(
			'cast:\n  mira: {pose: [{name: step_a, ease: whoosh}]}\nbeats: []\n'
		);

		expect(errors).toHaveLength(1);
		expect(errors[0].severity).toBe('warning');
		expect(parsed.entities.mira?.steps?.[0].ease).toBe('whoosh');
	});

	it('refuses a per-kind map on a step: one change, one curve', () => {
		const {errors} = scene(
			'cast:\n  mira: {pose: [{name: step_a, ease: {move: linear}}]}\nbeats: []\n'
		);

		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0].code).toBe('bad-value');
	});
});
