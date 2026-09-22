/**
 * `linkList:` — the block that moves the bottom link list inside the stage box.
 *
 * The block's PRESENCE is the whole feature, so the tests that matter most are the three
 * that decide it: a block with keys, a block with none, and the two ways of not writing
 * one. Everything else here is the usual key-by-key grammar.
 *
 * `links:` itself is deliberately untouched by all of this — `icon:` and `transition:`
 * stay on the list's style and are applied by the renderer, so a scene's entries never
 * carry another scene's defaults.
 */

import {parseScene} from '../parse-scene';

const LINKS = 'links:\n  stay: Tavern Fight\n';

describe('linkList:', () => {
	it('takes the whole block', () => {
		const {scene, errors} = parseScene(
			`${LINKS}linkList:\n` +
				'  at: [0.5, 0.86]\n' +
				'  w: 0.8\n' +
				'  h: 0.2\n' +
				'  as: parchment\n' +
				'  show: always\n' +
				'  icon: door\n' +
				'  transition: fade\n'
		);

		expect(errors).toEqual([]);
		expect(scene.linkList).toEqual({
			as: 'parchment',
			at: {x: 0.5, y: 0.86},
			h: 0.2,
			icon: 'door',
			show: 'always',
			transition: 'fade',
			w: 0.8
		});
	});

	it('takes a block that states only a position', () => {
		const {scene, errors} = parseScene(`${LINKS}linkList:\n  at: [0.5, 0.9]\n`);

		expect(errors).toEqual([]);
		expect(scene.linkList).toEqual({at: {x: 0.5, y: 0.9}});
	});

	// Presence is the switch, so a block that says nothing still says "draw it yourself".
	it('keeps an empty block, which is not the same as no block', () => {
		const {scene, errors} = parseScene(`${LINKS}linkList: {}\n`);

		expect(errors).toEqual([]);
		expect(scene.linkList).toEqual({});
	});

	it('leaves the key unset when the scene does not write it', () => {
		const {scene, errors} = parseScene(LINKS);

		expect(errors).toEqual([]);
		expect(scene.linkList).toBeUndefined();
		expect('linkList' in scene).toBe(false);
	});

	it('reads an explicit null as no block at all', () => {
		const {scene, errors} = parseScene(`${LINKS}linkList: ~\n`);

		expect(errors).toEqual([]);
		expect(scene.linkList).toBeUndefined();
	});

	it('does not touch the links themselves with its defaults', () => {
		const {scene} = parseScene(
			`${LINKS}linkList: {icon: door, transition: fade}\n`
		);

		expect(scene.links.stay).toEqual({name: 'stay', to: 'Tavern Fight'});
	});

	it('refuses a show: it does not know', () => {
		const {scene, errors} = parseScene(`${LINKS}linkList: {show: sometimes}\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
		expect(errors[0].message).toContain('sometimes');
		expect(errors[0].hint).toContain('auto, always, never');
		expect(scene.linkList?.show).toBeUndefined();
	});

	it('takes every show: it does know', () => {
		for (const show of ['auto', 'always', 'never']) {
			const {scene, errors} = parseScene(`${LINKS}linkList: {show: ${show}}\n`);

			expect(errors).toEqual([]);
			expect(scene.linkList?.show).toBe(show);
		}
	});

	it('offers a fix for a near-miss key', () => {
		const {errors} = parseScene(`${LINKS}linkList: {shw: auto}\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].fix?.text).toBe('show');
	});

	it('reports a key it cannot place at all', () => {
		const {scene, errors} = parseScene(`${LINKS}linkList: {place: top}\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].message).toContain('place');
		// The rest of the block still lands: one bad key is not a lost list.
		expect(scene.linkList).toEqual({});
	});

	// A bubble's coordinates, not an entity's: two fractions of the stage box.
	it('refuses an at: that is not two numbers', () => {
		const {errors} = parseScene(`${LINKS}linkList: {at: 0.5}\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-coordinate');
	});

	it('refuses an at: whose parts are not numbers', () => {
		const {errors} = parseScene(`${LINKS}linkList: {at: [left, 0.86]}\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
	});

	it('refuses a w: that is not a number', () => {
		const {errors} = parseScene(`${LINKS}linkList: {w: wide}\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
	});

	// `w: 80` is the slip these two exist for: fractions read as percentages until someone
	// has been told otherwise, and a silent 80 draws a list eighty stages wide.
	it('refuses a w: outside 0 to 1', () => {
		const {scene, errors} = parseScene(`${LINKS}linkList: {w: 80}\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
		expect(scene.linkList?.w).toBeUndefined();
	});

	it('refuses an h: of zero', () => {
		const {errors} = parseScene(`${LINKS}linkList: {h: 0}\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
	});

	it('refuses a block that is not a map', () => {
		const {scene, errors} = parseScene(`${LINKS}linkList: parchment\n`);

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
		expect(scene.linkList).toBeUndefined();
	});

	it('offers a fix for a near-miss of the block itself', () => {
		const {errors} = parseScene('linkLst: {show: auto}\n');

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].fix?.text).toBe('linkList');
	});
});
