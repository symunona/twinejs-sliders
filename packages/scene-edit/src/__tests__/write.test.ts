/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {parse} from 'yaml';
import {LAYER_BASELINE, type EntityPatch} from '@sliders/scene-types';
import {ENTITY_KEYS} from '@sliders/scene-schema';
import {FIXTURE, PATCH_FIXTURE} from '../__fixtures__/fixture';
import {ENTITY_KEY_ORDER} from '../locate';
import {
	addEntity,
	applyEdit,
	removeEntities,
	removeEntity,
	removeEntityKey,
	setEntityKey,
	type TextEdit
} from '../index';

function write(text: string, edit: TextEdit | undefined): string {
	expect(edit).toBeDefined();

	return applyEdit(text, edit as TextEdit);
}

describe('setEntityKey', () => {
	it('returns undefined when the entity has no entry', () => {
		expect(
			setEntityKey(FIXTURE, {id: 'nobody', kind: 'cast'}, 'at', {
				x: 0,
				y: LAYER_BASELINE
			})
		).toBeUndefined();
	});

	it('returns undefined when the map itself is absent', () => {
		expect(
			setEntityKey(FIXTURE, {id: 'candle', kind: 'prop'}, 'at', {
				x: 0,
				y: LAYER_BASELINE
			})
		).toBeUndefined();
	});

	it('writes into props: when the kind is prop', () => {
		const after = write(
			PATCH_FIXTURE,
			setEntityKey(PATCH_FIXTURE, {id: 'candle', kind: 'prop'}, 'at', {
				x: 0.2,
				y: -0.1
			})
		);

		expect(after).toContain('  candle: {at: [0.2, -0.1], layer: front}');
	});

	it('rounds on write instead of accumulating drift', () => {
		const after = write(
			FIXTURE,
			setEntityKey(FIXTURE, {id: 'mira', kind: 'cast'}, 'at', {
				x: -0.40000000000000002 - 0.15,
				y: LAYER_BASELINE
			})
		);

		expect(after).toContain('{at: -0.55,');
	});

	it('keeps a bare at: bare on a horizontal-only move', () => {
		const after = write(
			FIXTURE,
			setEntityKey(FIXTURE, {id: 'mira', kind: 'cast'}, 'at', {
				x: 0.3,
				y: LAYER_BASELINE
			})
		);

		expect(after).toContain('{at: 0.3,');
		expect(after).not.toContain('[0.3,');
	});

	it('replaces a pair with a bare number when the entity returns to the baseline', () => {
		const before = 'cast:\n  mira: {at: [0.1, -0.2]}\n';
		const after = write(
			before,
			setEntityKey(before, {id: 'mira', kind: 'cast'}, 'at', {
				x: 0.1,
				y: LAYER_BASELINE
			})
		);

		expect(after).toBe('cast:\n  mira: {at: 0.1}\n');
	});

	it('adds the first key to an empty flow map', () => {
		const before = 'cast:\n  mira: {}\n';
		const after = write(
			before,
			setEntityKey(before, {id: 'mira', kind: 'cast'}, 'frame', 'idle')
		);

		expect(after).toBe('cast:\n  mira: {frame: idle}\n');
	});

	it('turns an explicit removal back into an entry', () => {
		const before = 'from: base\ncast:\n  mira: ~\n';
		const after = write(
			before,
			setEntityKey(before, {id: 'mira', kind: 'cast'}, 'at', {
				x: 0.2,
				y: LAYER_BASELINE
			})
		);

		expect(after).toBe('from: base\ncast:\n  mira: {at: 0.2}\n');
	});

	it('fills in an entry whose value was never typed', () => {
		const before = 'cast:\n  mira:\n';
		const after = write(
			before,
			setEntityKey(before, {id: 'mira', kind: 'cast'}, 'at', {
				x: 0.2,
				y: LAYER_BASELINE
			})
		);

		expect(parse(after).cast.mira).toEqual({at: 0.2});
	});
});

describe('setEntityKey on a beat', () => {
	it('returns undefined when the beat patches a different entity', () => {
		// Beat 1 is joren's. The caller falls back to the cast: entry.
		expect(
			setEntityKey(FIXTURE, {beat: 1, id: 'mira', kind: 'cast'}, 'at', {
				x: 0,
				y: LAYER_BASELINE
			})
		).toBeUndefined();
	});

	it('returns undefined for a beat index that does not exist', () => {
		expect(
			setEntityKey(FIXTURE, {beat: 99, id: 'mira', kind: 'cast'}, 'flip', true)
		).toBeUndefined();
	});

	it('inserts into a beat that is already a map', () => {
		const after = write(
			FIXTURE,
			setEntityKey(FIXTURE, {beat: 2, id: 'mira', kind: 'cast'}, 'flip', true)
		);

		expect(after).toContain(
			'  - mira: {frame: angry, at: -0.25, say: "Get out.", flip: true}'
		);
	});

	it('promotes a double-quoted dialogue beat to a map, quotes intact', () => {
		const after = write(
			FIXTURE,
			setEntityKey(FIXTURE, {beat: 0, id: 'mira', kind: 'cast'}, 'at', {
				x: -0.6,
				y: LAYER_BASELINE
			})
		);

		expect(after).toContain(
			'  - mira: {say: "You shouldn\'t have come back.", at: -0.6}'
		);
		expect(parse(after).beats[0].mira.say).toBe(
			"You shouldn't have come back."
		);
	});

	it('preserves a single-quoted dialogue beat as single-quoted', () => {
		const after = write(
			FIXTURE,
			setEntityKey(FIXTURE, {beat: 1, id: 'joren', kind: 'cast'}, 'flip', false)
		);

		expect(after).toContain("  - joren: {say: 'And yet.', flip: false}");
	});

	it('refuses a command beat, which has no entity to patch', () => {
		expect(
			setEntityKey(FIXTURE, {beat: 3, id: 'wait', kind: 'cast'}, 'at', {
				x: 0,
				y: LAYER_BASELINE
			})
		).toBeUndefined();
	});
});

describe('removeEntityKey', () => {
	it('drops a key from a flow map and takes the separator with it', () => {
		const after = write(
			FIXTURE,
			removeEntityKey(FIXTURE, {id: 'mira', kind: 'cast'}, 'frame')
		);

		expect(after).toContain('  mira:  {at: -0.4}   # flow style on purpose');
	});

	it('drops the first key of a flow map without leaving a leading comma', () => {
		const after = write(
			FIXTURE,
			removeEntityKey(FIXTURE, {id: 'mira', kind: 'cast'}, 'at')
		);

		expect(after).toContain("  mira:  {frame: 'arms-crossed'}");
	});

	it('drops a block key with its own trailing comment and nothing else', () => {
		const after = write(
			FIXTURE,
			removeEntityKey(FIXTURE, {id: 'joren', kind: 'cast'}, 'flip')
		);

		expect(after).toContain('    frame: idle\n    layer: back\n');
		expect(after).not.toContain('he faces the door');
		expect(after).toContain('# Mira is already inside');
	});

	it('returns undefined for a key that is not there', () => {
		expect(
			removeEntityKey(FIXTURE, {id: 'mira', kind: 'cast'}, 'scale')
		).toBeUndefined();
	});
});

describe('addEntity', () => {
	const patch: EntityPatch = {
		at: {x: 0.35, y: LAYER_BASELINE},
		frame: 'idle',
		kind: 'cast',
		ref: 'joren'
	};

	it('appends into an existing block map at its own indentation', () => {
		const after = write(FIXTURE, addEntity(FIXTURE, 'cast', 'brann', patch));

		expect(after).toContain(
			'    layer: back\n  brann: {ref: joren, at: 0.35, frame: idle}\n'
		);
	});

	it('omits ref when it is just the id again', () => {
		const after = write(
			FIXTURE,
			addEntity(FIXTURE, 'cast', 'brann', {...patch, ref: 'brann'})
		);

		expect(after).toContain('  brann: {at: 0.35, frame: idle}');
	});

	it('creates an absent props: map in its conventional key slot', () => {
		const edit = addEntity(FIXTURE, 'prop', 'candle', {
			at: {x: 0.1, y: -0.2},
			kind: 'prop',
			ref: 'candle',
			z: 2
		});
		const after = applyEdit(FIXTURE, edit);

		// props: sorts after cast: and before fx: (spec 02 key table).
		expect(after).toContain(
			'    layer: back\nprops:\n  candle: {at: [0.1, -0.2], z: 2}\n\nfx: [rain@0.6]'
		);
		expect(parse(after).props.candle.z).toBe(2);
		// The rest of the file is untouched.
		expect(after).toContain('# The tavern, at night.');
		expect(after).toContain('  - mark: tense');
	});

	it('stays inline when the map is written in flow style', () => {
		const before = 'cast: {mira: {at: -0.4}}\n';
		const after = applyEdit(
			before,
			addEntity(before, 'cast', 'joren', {
				at: {x: 0.2, y: LAYER_BASELINE},
				kind: 'cast',
				ref: 'joren'
			})
		);

		expect(after).toBe('cast: {mira: {at: -0.4}, joren: {at: 0.2}}\n');
	});

	it('hangs the first entry off a map key that has no entries yet', () => {
		const before = 'id: a\ncast:\nbeats:\n  - box: "x"\n';
		const after = applyEdit(
			before,
			addEntity(before, 'cast', 'mira', {
				at: {x: 0, y: LAYER_BASELINE},
				kind: 'cast',
				ref: 'mira'
			})
		);

		expect(after).toBe('id: a\ncast:\n  mira: {at: 0}\nbeats:\n  - box: "x"\n');
	});

	it('writes a whole block into an empty passage', () => {
		const after = applyEdit(
			'',
			addEntity('', 'cast', 'mira', {kind: 'cast', ref: 'mira'})
		);

		expect(after).toBe('cast:\n  mira: {}\n');
	});

	it('matches the file indentation instead of assuming two spaces', () => {
		const before = 'cast:\n    mira: {at: 0}\n';
		const after = applyEdit(
			before,
			addEntity(before, 'prop', 'candle', {kind: 'prop', ref: 'candle'})
		);

		expect(after).toBe('cast:\n    mira: {at: 0}\nprops:\n    candle: {}\n');
	});
});

describe('removeEntity', () => {
	it('deletes just the entry line in a snapshot scene', () => {
		const after = write(FIXTURE, removeEntity(FIXTURE, 'cast', 'mira', false));

		expect(after).not.toContain('arms-crossed');
		expect(after).toContain('cast:\n  # Mira is already inside');
		expect(parse(after).cast).toEqual({
			joren: {at: 0.35, flip: true, frame: 'idle', layer: 'back'}
		});
	});

	it('takes the now-empty map with it', () => {
		const after = write(
			PATCH_FIXTURE,
			removeEntity(PATCH_FIXTURE, 'prop', 'candle', false)
		);

		expect(after).not.toContain('props:');
		expect(after).toContain('  joren: {at: 0.5}\n\nbeats:');
	});

	it('writes id: ~ in a patch scene, because absent means inherited', () => {
		const after = write(
			PATCH_FIXTURE,
			removeEntity(PATCH_FIXTURE, 'cast', 'mira', true)
		);

		expect(after).toContain('  mira: ~     # delta only');
		expect(parse(after).cast.mira).toBeNull();
	});

	it('keeps the map when a patch scene removes its only entity', () => {
		const after = write(
			PATCH_FIXTURE,
			removeEntity(PATCH_FIXTURE, 'prop', 'candle', true)
		);

		expect(after).toContain('props:\n  candle: ~\n');
	});

	it('returns undefined for an entity that is not there', () => {
		expect(removeEntity(FIXTURE, 'cast', 'nobody', false)).toBeUndefined();
		expect(removeEntity(FIXTURE, 'prop', 'candle', false)).toBeUndefined();
	});
});

/**
 * The bug this exists for: two removals decided one at a time both see a map that still has
 * two members, so both leave it behind and the merge produces a dangling `cast:`.
 */
describe('removeEntities', () => {
	it('takes the map with them when the ids cover every entry', () => {
		const after = write(
			FIXTURE,
			removeEntities(FIXTURE, 'cast', ['mira', 'joren'], false)
		);

		expect(after).not.toContain('cast:');
		expect(parse(after).cast).toBeUndefined();
		// The section's own blank line goes too, and exactly one of them.
		expect(after).toContain('camera: {at: [0, 0], zoom: 1}\n\nfx: [rain@0.6]');
	});

	it('keeps the map when one entry survives', () => {
		const after = write(
			FIXTURE,
			removeEntities(FIXTURE, 'cast', ['mira'], false)
		);

		expect(after).toContain('cast:');
		expect(after).not.toContain('arms-crossed');
		expect(parse(after).cast).toEqual({
			joren: {at: 0.35, flip: true, frame: 'idle', layer: 'back'}
		});
	});

	it('is ONE edit spanning both entries, not one per id', () => {
		const edit = removeEntities(FIXTURE, 'cast', ['mira', 'joren'], false);

		expect(edit).toBeDefined();
		expect(FIXTURE.slice(edit!.from, edit!.to)).toContain('arms-crossed');
		expect(FIXTURE.slice(edit!.from, edit!.to)).toContain('layer: back');
	});

	it('deletes several entries out of a bigger map in one splice', () => {
		const before = 'cast:\n  a: {at: 0}\n  b: {at: 0.1}\n  c: {at: 0.2}\n';
		const after = write(
			before,
			removeEntities(before, 'cast', ['a', 'c'], false)
		);

		expect(after).toBe('cast:\n  b: {at: 0.1}\n');
	});

	it('keeps the map in a patch scene, where every entry becomes a tombstone', () => {
		const after = write(
			PATCH_FIXTURE,
			removeEntities(PATCH_FIXTURE, 'cast', ['mira', 'joren'], true)
		);

		expect(after).toContain('  mira: ~     # delta only\n  joren: ~\n');
		expect(parse(after).cast).toEqual({joren: null, mira: null});
	});

	it('ignores ids the map does not have, rather than refusing the lot', () => {
		const after = write(
			FIXTURE,
			removeEntities(FIXTURE, 'cast', ['mira', 'nobody'], false)
		);

		expect(after).toContain('  joren:');
		expect(after).not.toContain('arms-crossed');
	});

	it('splices a duplicated id once', () => {
		const after = write(
			FIXTURE,
			removeEntities(FIXTURE, 'cast', ['mira', 'mira'], false)
		);

		expect(after).toContain('cast:\n  # Mira is already inside');
	});

	it('returns undefined when none of the ids are there', () => {
		expect(removeEntities(FIXTURE, 'cast', [], false)).toBeUndefined();
		expect(
			removeEntities(FIXTURE, 'cast', ['nobody', 'nothing'], false)
		).toBeUndefined();
		expect(removeEntities(FIXTURE, 'prop', ['candle'], false)).toBeUndefined();
	});
});

describe('half-typed and malformed input', () => {
	const broken = [
		'cast:\n  mira: {at: ',
		'cast:\n  mira: {at: -0.4, frame:',
		'cast:\n\tmira: {at: 0}\n',
		'cast: [1, 2]\n',
		'just a string',
		'',
		'   ',
		'- not\n- a\n- map\n',
		'cast:\n  mira: {at: -0.4}\n  mira: {at: 0.2}\n'
	];

	it('never throws, whatever the author is halfway through typing', () => {
		for (const text of broken) {
			expect(() =>
				setEntityKey(text, {id: 'mira', kind: 'cast'}, 'at', {
					x: 0,
					y: LAYER_BASELINE
				})
			).not.toThrow();
			expect(() =>
				removeEntityKey(text, {id: 'mira', kind: 'cast'}, 'at')
			).not.toThrow();
			expect(() => removeEntity(text, 'cast', 'mira', false)).not.toThrow();
			expect(() =>
				addEntity(text, 'cast', 'mira', {kind: 'cast', ref: 'mira'})
			).not.toThrow();
		}
	});

	it('returns undefined rather than a guess when the block is not a map', () => {
		expect(
			setEntityKey('just a string', {id: 'mira', kind: 'cast'}, 'flip', true)
		).toBeUndefined();
		expect(
			setEntityKey('', {id: 'mira', kind: 'cast'}, 'flip', true)
		).toBeUndefined();
	});

	// A key the schema accepts but ENTITY_KEY_ORDER omits is not an error anywhere — it is
	// just silently absent from the written entry. `scale:` was lost exactly this way.
	it('writes every key the schema accepts, so none can be dropped silently', () => {
		// A SUPERSET, not equality. `layer:` is still a key the parser accepts, but it is
		// legacy sugar that desugars to `z` — there is no `layer` on an EntityPatch to write
		// from, so it can only ever be read.
		const writable = [...ENTITY_KEYS].filter(key => key !== 'layer');

		expect([...ENTITY_KEY_ORDER].sort()).toEqual(
			expect.arrayContaining([...ENTITY_KEYS].sort())
		);

		const patch: EntityPatch = {
			at: {x: -0.6, y: -0.2},
			flip: true,
			frame: 'idle',
			kind: 'prop',
			of: 'table',
			opacity: 0.5,
			ref: 'tankard',
			scale: 0.8,
			z: 2
		};
		const written = write(
			PATCH_FIXTURE,
			addEntity(PATCH_FIXTURE, 'prop', 'tankard', patch)
		);
		const entry = parse(written).props.tankard;

		for (const key of writable) {
			// `ref` is implied by the entity id when they match, so it is legitimately absent.
			if (key !== 'ref') {
				expect(entry).toHaveProperty(key);
			}
		}

		expect(entry.scale).toBe(0.8);
	});
});
