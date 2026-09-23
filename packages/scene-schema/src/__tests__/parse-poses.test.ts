/**
 * `pose:` written as a list — a step list, plus `poseLoop:`. And the old spellings,
 * `frame:` / `frameLoop:`, which parse to the same thing forever.
 *
 * One YAML key fills two fields: `steps` holds the whole list, `pose` holds its first
 * step so everything that only ever wanted "which pose" keeps reading a string. Both halves
 * are pinned here, because a `pose` left behind by a step list is exactly how the asset
 * collectors would go on bundling one pose out of six.
 */

import {parseScene} from '../parse-scene';

const CAST = (body: string) => `cast:\n  mira: ${body}`;

describe('pose: as a list', () => {
	it('takes bare names as steps', () => {
		const {scene, errors} = parseScene(CAST('{pose: [walk_1, walk_2]}'));

		expect(errors).toEqual([]);
		expect(scene.entities.mira).toMatchObject({
			pose: 'walk_1',
			steps: [{name: 'walk_1'}, {name: 'walk_2'}]
		});
	});

	it('takes a map per step, with its own dur', () => {
		const {scene, errors} = parseScene(
			CAST('{pose: [{name: walk_1, dur: 0.1}, {name: walk_2, dur: 0.3}]}')
		);

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.steps).toEqual([
			{dur: 0.1, name: 'walk_1'},
			{dur: 0.3, name: 'walk_2'}
		]);
	});

	it('takes placement keys on a step', () => {
		const {scene, errors} = parseScene(
			CAST('{pose: [{name: walk_1, at: -0.4, scale: 0.8, flip: true}]}')
		);

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.steps?.[0]).toEqual({
			at: {x: -0.4, y: -0.85},
			flip: true,
			name: 'walk_1',
			scale: 0.8
		});
	});

	it("measures a step's at from the parent when the entity has one", () => {
		const {scene, errors} = parseScene(
			`props:\n  table: {at: 0}\ncast:\n  mira: {of: table, pose: [{name: walk_1, at: 0.2}]}`
		);

		expect(errors).toEqual([]);
		// Relative, so the baseline is 0 rather than the floor — the same rule the entity's
		// own `at` follows.
		expect(scene.entities.mira?.steps?.[0].at).toEqual({x: 0.2, y: 0});
	});

	it('keeps a numeric-looking pose name as written', () => {
		const {scene} = parseScene(CAST('{pose: [04, 05]}'));

		expect(scene.entities.mira?.steps).toEqual([{name: '04'}, {name: '05'}]);
	});

	it('writes no steps at all for a scalar pose:', () => {
		const {scene} = parseScene(CAST('{pose: idle}'));

		// `pose` and `steps` are one YAML key, so the ABSENCE here is what mergePatch
		// reads as "and stop animating". A `steps: null` in every ordinary patch would be
		// the same rule written out six thousand times.
		expect(scene.entities.mira).not.toHaveProperty('steps');
	});

	it('refuses a step with no name', () => {
		const {errors} = parseScene(CAST('{pose: [{dur: 0.1}]}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/needs a name/);
	});

	it('refuses an unknown key inside a step', () => {
		const {errors} = parseScene(CAST('{pose: [{name: walk_1, durr: 0.1}]}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		// The typo distance reaches `dur`, so the fix button has something to offer.
		expect(errors[0].fix?.text).toBe('dur');
	});

	it('refuses a negative step dur', () => {
		const {errors} = parseScene(CAST('{pose: [{name: walk_1, dur: -1}]}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/not a length of time/);
	});
});

describe('poseLoop:', () => {
	it('takes once and all', () => {
		for (const loop of ['once', 'all']) {
			const {scene, errors} = parseScene(
				CAST(`{pose: [a, b], poseLoop: ${loop}}`)
			);

			expect(errors).toEqual([]);
			expect(scene.entities.mira?.poseLoop).toBe(loop);
		}
	});

	it('refuses anything else, and offers the near miss', () => {
		const {errors} = parseScene(CAST('{pose: [a, b], poseLoop: onse}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
		expect(errors[0].fix?.text).toBe('once');
	});

	it('is unknown inside a beat that is not staging an entity', () => {
		// Sanity: it is an ENTITY key, so it rides on a beat's speaker body too.
		const {errors} = parseScene(
			`cast:\n  mira: {}\nbeats:\n  - mira: {poseLoop: once}`
		);

		expect(errors).toEqual([]);
	});
});

describe('old spellings: frame: and frameLoop:', () => {
	/** The scene without its errors, for comparing two spellings of one scene. */
	function sceneOf(text: string) {
		return parseScene(text).scene;
	}

	it('frame: is pose:, same scene', () => {
		expect(sceneOf(CAST('{at: 0, frame: idle}'))).toEqual(
			sceneOf(CAST('{at: 0, pose: idle}'))
		);
	});

	it('a frame: list and frameLoop: are a pose: list and poseLoop:', () => {
		expect(
			sceneOf(CAST('{frame: [{name: a, dur: 0.2}, b], frameLoop: once}'))
		).toEqual(sceneOf(CAST('{pose: [{name: a, dur: 0.2}, b], poseLoop: once}')));
	});

	it('works in a beat patch too', () => {
		const old = `cast:\n  mira: {}\nbeats:\n  - mira: {frame: angry, say: "Out."}`;

		expect(sceneOf(old)).toEqual(sceneOf(old.replace('frame:', 'pose:')));
	});

	it('says so at info, with the rename as a one-click fix', () => {
		const {errors} = parseScene(CAST('{frame: [a, b], frameLoop: once}'));

		expect(errors).toHaveLength(2);
		expect(errors.map(error => error.severity)).toEqual(['info', 'info']);
		expect(errors.map(error => error.code)).toEqual(['retired-key', 'retired-key']);
		expect(errors[0].message).toBe('`frame:` is now `pose:`.');
		expect(errors[0].fix).toMatchObject({replaces: 'frame', text: 'pose'});
		expect(errors[1].fix).toMatchObject({replaces: 'frameLoop', text: 'poseLoop'});
	});

	it('points the fix at the key token itself', () => {
		const {errors} = parseScene('cast:\n  mira: {frame: idle}');

		// `  mira: {` is 9 columns; the key starts at 10.
		expect(errors[0]).toMatchObject({col: 10, endCol: 15, line: 2});
	});

	it('reads frame in an ease map as pose', () => {
		const old = parseScene('ease: {frame: linear}');

		expect(old.scene.ease).toEqual({pose: 'linear'});
		expect(old.errors).toHaveLength(1);
		expect(old.errors[0]).toMatchObject({code: 'retired-key', severity: 'info'});
	});

	it('offers pose for a typo of the old spelling', () => {
		const {errors} = parseScene(CAST('{fram: angry}'));

		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].fix?.text).toBe('pose');
	});
});
