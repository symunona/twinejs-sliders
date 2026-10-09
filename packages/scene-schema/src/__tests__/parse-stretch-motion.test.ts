/**
 * `stretch:`, `motion:` and `locked:` — the squeeze, a sprite's own motion and the editor's
 * lock. The parser is the spec, so the shapes an author can type are pinned here.
 */

import {parseScene} from '../parse-scene';

const CAST = (body: string) => `cast:\n  mira: ${body}`;

describe('stretch:', () => {
	it('takes [x, y]', () => {
		const {scene, errors} = parseScene(CAST('{stretch: [1.5, 0.8]}'));

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.stretch).toEqual({x: 1.5, y: 0.8});
	});

	it('refuses a bare number, which is what scale: means', () => {
		const {scene, errors} = parseScene(CAST('{stretch: 2}'));

		expect(errors.map(e => e.code)).toEqual(['bad-value']);
		expect(scene.entities.mira).not.toHaveProperty('stretch');
	});

	it('refuses zero and negatives', () => {
		const {errors} = parseScene(CAST('{stretch: [0, 1]}'));

		expect(errors.map(e => e.code)).toEqual(['bad-value']);
	});

	it('is a key a fit: plane has no use for', () => {
		const {errors} = parseScene(CAST('{fit: cover, stretch: [2, 1]}'));

		expect(errors.some(e => e.severity === 'warning')).toBe(true);
	});
});

describe('motion:', () => {
	it('takes a preset token', () => {
		const {scene, errors} = parseScene(CAST('{motion: scroll_infinite_left}'));

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.motion).toEqual({id: 'scroll_infinite_left'});
	});

	it('takes the long form with a speed', () => {
		const {scene, errors} = parseScene(
			CAST('{motion: {id: parallax_left, speed: 12}}')
		);

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.motion).toEqual({id: 'parallax_left', speed: 12});
	});

	it('warns about a speed that is not a length of time', () => {
		const {errors} = parseScene(CAST('{motion: {id: parallax_left, speed: 0}}'));

		expect(errors.map(e => e.code)).toEqual(['bad-value']);
	});

	it('suggests the key a typo meant', () => {
		const {errors} = parseScene(CAST('{motion: {id: earthquake, sped: 2}}'));

		expect(errors.map(e => e.code)).toEqual(['unknown-key']);
	});
});

describe('locked:', () => {
	it('takes a boolean', () => {
		const {scene, errors} = parseScene(CAST('{locked: true}'));

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.locked).toBe(true);
	});
});
