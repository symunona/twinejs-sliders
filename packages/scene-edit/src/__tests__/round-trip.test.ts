/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 *
 * THE GATE (spec 09 phase 0). No drag handle gets written until this file is green.
 *
 * Every case asserts the same thing: after the edit, every byte outside the spliced range
 * is identical. That is stronger than "the comments are still there" — it also catches
 * re-indentation, quote-style rewrites and flow-to-block conversion, which is what a naive
 * `parse -> mutate -> stringify` does to a hand-formatted file.
 */
import {parse} from 'yaml';
import {LAYER_BASELINE} from '@sliders/scene-types';
import {FIXTURE, untouchedOutside} from '../__fixtures__/fixture';
import {
	applyEdit,
	removeEntities,
	setEntityKey,
	setSceneKey,
	type TextEdit
} from '../index';

function expectMinimalSplice(
	before: string,
	edit: TextEdit | undefined
): string {
	expect(edit).toBeDefined();

	const {after, before: masked} = untouchedOutside(before, edit as TextEdit);

	expect(after).toBe(masked);

	return applyEdit(before, edit as TextEdit);
}

/** The fixture still has to mean what it meant, whatever the bytes look like. */
function castOf(text: string): Record<string, Record<string, unknown>> {
	return parse(text).cast;
}

describe('round-trip on a comment-heavy fixture', () => {
	it('splices only the value when at: already exists on a flow entity', () => {
		const edit = setEntityKey(FIXTURE, {id: 'mira', kind: 'cast'}, 'at', {
			x: -0.25,
			y: LAYER_BASELINE
		});

		// The spliced span is the old value and nothing else.
		expect(FIXTURE.slice(edit!.from, edit!.to)).toBe('-0.4');
		expect(edit!.insert).toBe('-0.25');

		const after = expectMinimalSplice(FIXTURE, edit);

		expect(after).toContain(
			"  mira:  {at: -0.25, frame: 'arms-crossed'}   # flow style on purpose"
		);
		// Two spaces after `mira:`, the single quotes, and the trailing comment survive.
		expect(castOf(after).mira.frame).toBe('arms-crossed');
	});

	it('splices only the value when at: already exists on a block entity', () => {
		const edit = setEntityKey(FIXTURE, {id: 'joren', kind: 'cast'}, 'at', {
			x: 0.5,
			y: -0.2
		});

		expect(FIXTURE.slice(edit!.from, edit!.to)).toBe('0.35');

		const after = expectMinimalSplice(FIXTURE, edit);

		expect(after).toContain('    at: [0.5, -0.2]\n    frame: idle');
		expect(after).toContain('    flip: true       # he faces the door');
	});

	it('inserts a missing key inline in a flow map', () => {
		const edit = setEntityKey(
			FIXTURE,
			{id: 'mira', kind: 'cast'},
			'scale',
			1.15
		);

		// Pure insertion — nothing is deleted.
		expect(edit!.from).toBe(edit!.to);

		const after = expectMinimalSplice(FIXTURE, edit);

		expect(after).toContain(
			"  mira:  {at: -0.4, frame: 'arms-crossed', scale: 1.15}   # flow style on purpose"
		);
	});

	it('inserts a missing key as a block entry in a block map', () => {
		const edit = setEntityKey(FIXTURE, {id: 'joren', kind: 'cast'}, 'z', 2);
		const after = expectMinimalSplice(FIXTURE, edit);

		expect(after).toContain('    layer: back\n    z: 2\n');
		// The blank line and `fx:` that follow are untouched.
		expect(after).toContain('    z: 2\n\nfx: [rain@0.6]');
	});

	it('splices a beat patch without touching the rest of the beat', () => {
		const edit = setEntityKey(
			FIXTURE,
			{beat: 2, id: 'mira', kind: 'cast'},
			'at',
			{x: -0.1, y: LAYER_BASELINE}
		);

		expect(FIXTURE.slice(edit!.from, edit!.to)).toBe('-0.25');

		const after = expectMinimalSplice(FIXTURE, edit);

		expect(after).toContain(
			'  - mira: {frame: angry, at: -0.1, say: "Get out."}'
		);
		// The cast entry is NOT the thing that moved.
		expect(castOf(after).mira.at).toBe(-0.4);
	});

	it('splices only the value of an existing top-level key', () => {
		const edit = setSceneKey(FIXTURE, 'bg', 'tavern/dawn');

		expect(FIXTURE.slice(edit.from, edit.to)).toBe('tavern/night');

		const after = expectMinimalSplice(FIXTURE, edit);

		// The column-aligned trailing comment is not the value, so it does not move.
		expect(after).toContain(
			'bg: tavern/dawn               # asset id, never a path'
		);
	});

	it('lands a new top-level key in spec 02 order, not at the end', () => {
		const before = FIXTURE.replace('camera: {at: [0, 0], zoom: 1}\n', '');
		const after = expectMinimalSplice(
			before,
			setSceneKey(before, 'camera', '{zoom: 1.5}')
		);

		// After `bg:`, above the blank line and `cast:` — never after `beats:`.
		expect(after).toContain(
			'bg: tavern/night               # asset id, never a path\ncamera: {zoom: 1.5}\n\ncast:'
		);
	});

	it('deletes a whole map without disturbing the sections around it', () => {
		const edit = removeEntities(FIXTURE, 'cast', ['mira', 'joren'], false);
		const after = expectMinimalSplice(FIXTURE, edit);

		// Everything the deleted span did not cover is byte-identical, and the section's
		// blank line went with it rather than stacking up two.
		expect(after).toContain('camera: {at: [0, 0], zoom: 1}\n\nfx: [rain@0.6]');
		expect(after).toContain('# The tavern, at night.');
		expect(after).toContain(
			'  - mira: {frame: angry, at: -0.25, say: "Get out."}'
		);
		expect(parse(after).beats).toHaveLength(5);
	});

	it('leaves comments, blank lines and quote styles byte-identical', () => {
		const edits = [
			setEntityKey(FIXTURE, {id: 'mira', kind: 'cast'}, 'at', {
				x: -0.25,
				y: LAYER_BASELINE
			}),
			setEntityKey(FIXTURE, {id: 'joren', kind: 'cast'}, 'flip', false),
			setEntityKey(FIXTURE, {id: 'mira', kind: 'cast'}, 'scale', 1.15)
		];

		for (const edit of edits) {
			const after = applyEdit(FIXTURE, edit as TextEdit);

			for (const line of [
				'# The tavern, at night. Hand-formatted; keep it that way.',
				'from: ~                        # no parent yet',
				'bg: tavern/night               # asset id, never a path',
				'  # Mira is already inside when the player arrives.',
				'fx: [rain@0.6]',
				"  - joren: 'And yet.'",
				'  stay: {to: Tavern Fight, if: has_weapon, icon: sword}'
			]) {
				expect(after).toContain(line);
			}

			// Same number of lines: nothing was reflowed, only spliced or line-inserted.
			expect(after.split('\n').length).toBeGreaterThanOrEqual(
				FIXTURE.split('\n').length
			);
		}
	});
});
