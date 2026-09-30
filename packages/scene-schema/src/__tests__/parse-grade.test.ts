/**
 * `grade:` — the asset editor's colour sliders as a live entity key.
 *
 * Pinned: the names and ranges are the asset editor's (`GRADE_RANGES`), out of range clamps
 * with a warning, an unknown sub-key warns and is dropped, and `grade: ~` survives as a
 * null so a beat can clear a grade the scene set.
 */

import {parseScene} from '../parse-scene';

const CAST = (body: string) => `cast:\n  hero: ${body}`;

describe('grade: on an entity', () => {
	it('takes a map of colour sliders', () => {
		const {scene, errors} = parseScene(
			CAST('{at: [0.4, -0.6], grade: {warmth: 30, brightness: -15, saturation: -20}}')
		);

		expect(errors).toEqual([]);
		expect(scene.entities.hero?.grade).toEqual({
			brightness: -15,
			saturation: -20,
			warmth: 30
		});
	});

	it('keeps a key at rest, so a beat can reset that one key', () => {
		const {scene, errors} = parseScene(CAST('{grade: {warmth: 0, gamma: 1}}'));

		expect(errors).toEqual([]);
		expect(scene.entities.hero?.grade).toEqual({gamma: 1, warmth: 0});
	});

	it('clamps out of range to the slider end, with a warning', () => {
		const {scene, errors} = parseScene(
			CAST('{grade: {warmth: 150, gamma: 0, pop: -5, hue: 200, blur: 99}}')
		);

		expect(scene.entities.hero?.grade).toEqual({
			blur: 50,
			gamma: 0.1,
			hue: 180,
			pop: 0,
			warmth: 100
		});
		expect(errors).toHaveLength(5);
		expect(errors.every(error => error.severity === 'warning')).toBe(true);
		expect(errors[0].message).toMatch(/grade warmth of 150 is outside -100 to 100/);
	});

	it('warns about an unknown sub-key, offers the near miss, and drops it', () => {
		const {scene, errors} = parseScene(CAST('{grade: {warmt: 30, hue: 10}}'));

		expect(scene.entities.hero?.grade).toEqual({hue: 10});
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({
			code: 'unknown-key',
			hint: "Did you mean 'warmth'?",
			severity: 'warning'
		});
		expect(errors[0].fix?.text).toBe('warmth');
	});

	it('refuses a value that is not a number', () => {
		const {scene, errors} = parseScene(CAST('{grade: {warmth: lots}}'));

		expect(scene.entities.hero?.grade).toEqual({});
		expect(errors[0].message).toMatch(/grade warmth must be a number/);
	});

	it('refuses a scalar grade', () => {
		const {scene, errors} = parseScene(CAST('{grade: sunset}'));

		expect(scene.entities.hero?.grade).toBeUndefined();
		expect(errors[0].severity).toBe('error');
		expect(errors[0].message).toMatch(/grade: must be a map/);
	});

	it('reads grade: ~ as a clear', () => {
		const {scene, errors} = parseScene(CAST('{grade: ~}'));

		expect(errors).toEqual([]);
		expect(scene.entities.hero?.grade).toBeNull();
	});

	it('warns that an empty grade changes nothing', () => {
		const {errors} = parseScene(CAST('{grade: {}}'));

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({severity: 'warning'});
		expect(errors[0].hint).toMatch(/grade: ~ clears it/);
	});
});

describe('grade: on a beat', () => {
	it('lands in the beat patch', () => {
		const {scene, errors} = parseScene(
			[
				'cast:',
				'  hero: {grade: {warmth: 30}}',
				'beats:',
				'  - hero: {grade: {warmth: 60, hue: -10}}',
				'  - hero: {grade: ~}'
			].join('\n')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({patch: {grade: {hue: -10, warmth: 60}}});
		expect(scene.beats[1]).toMatchObject({patch: {grade: null}});
	});

	it('is not a step key', () => {
		const {errors} = parseScene(
			CAST('{pose: [{name: idle, grade: {warmth: 10}}]}')
		);

		expect(errors.map(error => error.code)).toContain('unknown-key');
	});
});
