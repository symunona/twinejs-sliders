/**
 * `frame:` written as a list — a frame cycle, plus `frameLoop:`.
 *
 * One YAML key fills two fields: `frames` holds the whole cycle, `frame` holds its first
 * step so everything that only ever wanted "which pose" keeps reading a string. Both halves
 * are pinned here, because a `frame` left behind by a cycle is exactly how the asset
 * collectors would go on bundling one pose out of six.
 */

import {parseScene} from '../parse-scene';

const CAST = (body: string) => `cast:\n  mira: ${body}`;

describe('frame: as a list', () => {
	it('takes bare names as a cycle', () => {
		const {scene, errors} = parseScene(CAST('{frame: [walk_1, walk_2]}'));

		expect(errors).toEqual([]);
		expect(scene.entities.mira).toMatchObject({
			frame: 'walk_1',
			frames: [{name: 'walk_1'}, {name: 'walk_2'}]
		});
	});

	it('takes a map per step, with its own dur', () => {
		const {scene, errors} = parseScene(
			CAST('{frame: [{name: walk_1, dur: 0.1}, {name: walk_2, dur: 0.3}]}')
		);

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.frames).toEqual([
			{dur: 0.1, name: 'walk_1'},
			{dur: 0.3, name: 'walk_2'}
		]);
	});

	it('takes placement keys on a step', () => {
		const {scene, errors} = parseScene(
			CAST('{frame: [{name: walk_1, at: -0.4, scale: 0.8, flip: true}]}')
		);

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.frames?.[0]).toEqual({
			at: {x: -0.4, y: -0.85},
			flip: true,
			name: 'walk_1',
			scale: 0.8
		});
	});

	it("measures a step's at from the parent when the entity has one", () => {
		const {scene, errors} = parseScene(
			`props:\n  table: {at: 0}\ncast:\n  mira: {of: table, frame: [{name: walk_1, at: 0.2}]}`
		);

		expect(errors).toEqual([]);
		// Relative, so the baseline is 0 rather than the floor — the same rule the entity's
		// own `at` follows.
		expect(scene.entities.mira?.frames?.[0].at).toEqual({x: 0.2, y: 0});
	});

	it('keeps a numeric-looking frame name as written', () => {
		const {scene} = parseScene(CAST('{frame: [04, 05]}'));

		expect(scene.entities.mira?.frames).toEqual([{name: '04'}, {name: '05'}]);
	});

	it('writes no frames at all for a scalar frame:', () => {
		const {scene} = parseScene(CAST('{frame: idle}'));

		// `frame` and `frames` are one YAML key, so the ABSENCE here is what mergePatch
		// reads as "and stop animating". A `frames: null` in every ordinary patch would be
		// the same rule written out six thousand times.
		expect(scene.entities.mira).not.toHaveProperty('frames');
	});

	it('refuses a step with no name', () => {
		const {errors} = parseScene(CAST('{frame: [{dur: 0.1}]}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/needs a name/);
	});

	it('refuses an unknown key inside a step', () => {
		const {errors} = parseScene(CAST('{frame: [{name: walk_1, durr: 0.1}]}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		// The typo distance reaches `dur`, so the fix button has something to offer.
		expect(errors[0].fix?.text).toBe('dur');
	});

	it('refuses a negative step dur', () => {
		const {errors} = parseScene(CAST('{frame: [{name: walk_1, dur: -1}]}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/not a length of time/);
	});
});

describe('frameLoop:', () => {
	it('takes once and all', () => {
		for (const loop of ['once', 'all']) {
			const {scene, errors} = parseScene(
				CAST(`{frame: [a, b], frameLoop: ${loop}}`)
			);

			expect(errors).toEqual([]);
			expect(scene.entities.mira?.frameLoop).toBe(loop);
		}
	});

	it('refuses anything else, and offers the near miss', () => {
		const {errors} = parseScene(CAST('{frame: [a, b], frameLoop: onse}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
		expect(errors[0].fix?.text).toBe('once');
	});

	it('is unknown inside a beat that is not staging an entity', () => {
		// Sanity: it is an ENTITY key, so it rides on a beat's speaker body too.
		const {errors} = parseScene(
			`cast:\n  mira: {}\nbeats:\n  - mira: {frameLoop: once}`
		);

		expect(errors).toEqual([]);
	});
});
