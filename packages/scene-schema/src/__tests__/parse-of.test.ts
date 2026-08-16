import {parseScene} from '../parse-scene';

const codes = (text: string) => parseScene(text).errors.map(e => e.code);

describe('of: parsing', () => {
	it('reads a parent id', () => {
		const {scene, errors} = parseScene(
			['props:', '  table: {at: -0.3}', '  candle: {of: table, at: [0.1, 0.2]}'].join(
				'\n'
			)
		);

		expect(errors).toEqual([]);
		expect(scene.entities.candle).toMatchObject({of: 'table'});
	});

	it('reads of: ~ as a detach', () => {
		const {scene} = parseScene(
			['from: base', 'props:', '  candle: {of: ~}'].join('\n')
		);

		expect(scene.entities.candle).toMatchObject({of: null});
	});

	it('accepts of: in a beat patch', () => {
		const {errors, scene} = parseScene(
			[
				'props:',
				'  table: {at: -0.3}',
				'  candle: {at: 0}',
				'beats:',
				'  - candle: {of: table, at: 0.1}'
			].join('\n')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			kind: 'set',
			patch: {of: 'table'},
			who: 'candle'
		});
	});

	it('rejects a non-string parent', () => {
		expect(codes('props:\n  candle: {of: [a, b]}')).toContain('bad-value');
	});

	it('still rejects a misspelled key', () => {
		expect(codes('props:\n  candle: {off: table}')).toContain('unknown-key');
	});

	it('suggests of: for a near miss', () => {
		const {errors} = parseScene('props:\n  candle: {off: table}');

		expect(errors[0].hint).toContain('of');
	});
});

/**
 * The bug the first end-to-end run found. A bare `at:` means "x only, y at the layer
 * baseline" — but the baseline is the FLOOR (-0.85), and as an offset that reads "0.85
 * below my parent". A candle on a table rendered a stage-height under it, off-screen.
 */
describe('of: moves the baseline a bare at: is measured from', () => {
	it('reads a bare at: on a child as a level offset', () => {
		const {scene} = parseScene(
			'props:\n  table: {at: -0.3}\n  candle: {of: table, at: 0.4}'
		);

		expect(scene.entities.candle).toMatchObject({at: {x: 0.4, y: 0}});
	});

	it('still floors a bare at: on an ordinary entity', () => {
		const {scene} = parseScene('props:\n  table: {at: -0.3}');

		expect(scene.entities.table).toMatchObject({at: {x: -0.3, y: -0.85}});
	});

	// YAML map order is the author's, and `at` is parsed before the `of` that redefines it.
	it('does not depend on which key was written first', () => {
		const {scene} = parseScene(
			'props:\n  table: {at: 0}\n  candle: {at: 0.4, of: table}'
		);

		expect(scene.entities.candle).toMatchObject({at: {x: 0.4, y: 0}});
	});

	it('leaves an explicit pair alone', () => {
		const {scene} = parseScene(
			'props:\n  table: {at: 0}\n  candle: {of: table, at: [0.4, -0.85]}'
		);

		expect(scene.entities.candle).toMatchObject({at: {x: 0.4, y: -0.85}});
	});

	// `of: ~` detaches, so the entity is back on the floor like any other.
	it('floors a bare at: when of: is a detach', () => {
		const {scene} = parseScene('from: base\nprops:\n  candle: {of: ~, at: 0.4}');

		expect(scene.entities.candle).toMatchObject({at: {x: 0.4, y: -0.85}});
	});
});

describe('of: self-reference', () => {
	it('is an error on an entity entry', () => {
		expect(codes('props:\n  candle: {of: candle}')).toContain('of-cycle');
	});

	it('is an error in a beat patch', () => {
		expect(
			codes('props:\n  candle: {at: 0}\nbeats:\n  - candle: {of: candle}')
		).toContain('of-cycle');
	});
});

describe('of: cycles inside one block', () => {
	it('flags a two-entity loop', () => {
		expect(
			codes('props:\n  a: {of: b, at: 0}\n  b: {of: a, at: 0}')
		).toContain('of-cycle');
	});

	it('flags a three-entity loop', () => {
		expect(
			codes('props:\n  a: {of: c, at: 0}\n  b: {of: a, at: 0}\n  c: {of: b, at: 0}')
		).toContain('of-cycle');
	});

	it('leaves a plain chain alone', () => {
		expect(
			codes('props:\n  a: {at: 0}\n  b: {of: a, at: 0}\n  c: {of: b, at: 0}')
		).toEqual([]);
	});

	// A diamond is not a cycle. Two children of one parent is the common case, and an
	// over-eager "have I seen this id" check would reject it.
	it('leaves a diamond alone', () => {
		expect(
			codes(
				[
					'props:',
					'  root: {at: 0}',
					'  left: {of: root, at: 0}',
					'  right: {of: root, at: 0}',
					'  leaf: {of: left, at: 0}'
				].join('\n')
			)
		).toEqual([]);
	});
});

describe('of: unknown parent', () => {
	/**
	 * A snapshot scene IS its whole cast, so a parent that is not in it cannot be anything
	 * but a typo.
	 */
	it('is an error in a snapshot scene', () => {
		const {errors} = parseScene('props:\n  candle: {of: tabel, at: 0}');

		expect(errors.map(e => e.code)).toContain('unknown-parent');
	});

	it('suggests the id that was probably meant', () => {
		const {errors} = parseScene(
			'props:\n  table: {at: 0}\n  candle: {of: tabel, at: 0}'
		);

		expect(errors.find(e => e.code === 'unknown-parent')?.hint).toContain('table');
	});

	it('finds a parent declared after the child', () => {
		expect(
			codes('props:\n  candle: {of: table, at: 0}\n  table: {at: 0}')
		).toEqual([]);
	});

	/** cast: and props: are one id space — a prop may hang off a character. */
	it('finds a parent in the other map', () => {
		expect(
			codes('cast:\n  mira: {at: -0.4}\nprops:\n  mug: {of: mira, at: 0}')
		).toEqual([]);
	});

	/**
	 * With `from:` the parent may be inherited from another passage entirely, and the parser
	 * has no index. Staying quiet is the only sound answer; `resolveStage` is the net.
	 */
	it('stays quiet in a patch scene', () => {
		expect(
			codes('from: tavern-night\nprops:\n  candle: {of: table, at: 0}')
		).toEqual([]);
	});

	it('points at the of: value, not the whole entry', () => {
		const {errors} = parseScene('props:\n  candle: {of: ghost, at: 0}');
		const error = errors.find(e => e.code === 'unknown-parent');

		expect(error?.line).toBe(2);
		// `ghost` starts at column 17 of `  candle: {of: ghost, at: 0}`.
		expect(error?.col).toBe(16);
	});
});
