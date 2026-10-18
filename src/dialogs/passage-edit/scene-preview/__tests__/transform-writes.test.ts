import {extractSceneBlock} from '@sliders/scene-index';
import {applyEdit} from '@sliders/scene-edit';
import {resolveStage} from '@sliders/scene-core';
import {LAYER_BASELINE} from '@sliders/scene-types';
import type {Stage} from '@sliders/scene-types';
import {parseSceneText} from '../use-scene-parse';
import {buildWriteEdits, type EntityKeyWrite} from '../use-scene-writer';
import {
	atAxisWrite,
	derivedZ,
	rotKeyWrite,
	scaleKeyWrite,
	zKeyWrite
} from '../transform-writes';

/**
 * The rules, then the TEXT they produce: a builder that returns the right object but
 * splices `at: [0.3, -0.85]` onto a bare `at: 0.3` would pass the first half and fail the
 * author.
 */

const passage = [
	'[scene]',
	'cast:',
	'  mira: {at: -0.4}',
	'  joren: {at: 0.3, scale: 1.5, rot: 10, z: 2}',
	'props:',
	'  cup: {of: mira, at: [0.1, 0]}',
	'beats:',
	'  - mira: {at: 0.2}'
].join('\n');

const parsed = parseSceneText(passage);
const authored: Stage = parsed.states[0];
const drawn: Stage = resolveStage(authored);
const mira = authored.entities!.mira;
const joren = authored.entities!.joren;
const cup = authored.entities!.cup;

/** Splice `writes` into the scene block the way the writer does, scrubber at `beat`. */
function written(writes: (EntityKeyWrite | undefined)[], beat = 0): string {
	const block = extractSceneBlock(passage)!;
	const edits = buildWriteEdits(
		{
			beat,
			blockOffset: block.offset,
			blockText: block.text,
			scene: parsed.result!.scene
		},
		writes.filter((write): write is EntityKeyWrite => !!write)
	);

	return edits.reduce((text, edit) => applyEdit(text, edit), block.text);
}

describe('atAxisWrite()', () => {
	it('writes x and keeps a bare at bare', () => {
		const write = atAxisWrite(mira, 'x', 0.25);

		expect(write).toEqual({
			id: 'mira',
			key: 'at',
			kind: 'cast',
			ref: 'mira',
			value: {x: 0.25, y: LAYER_BASELINE}
		});
		expect(written([write])).toContain('mira: {at: 0.25}');
	});

	it('writes y as a pair', () => {
		expect(written([atAxisWrite(mira, 'y', -0.5)])).toContain(
			'mira: {at: [-0.4, -0.5]}'
		);
	});

	it('writes the OFFSET of an of: child, bare when y is on its parent', () => {
		// The authored stage: 0.1 is the offset from mira, not where the cup is drawn.
		expect(cup.at.x).toBe(0.1);
		expect(written([atAxisWrite(cup, 'x', 0.2)])).toContain(
			'cup: {of: mira, at: 0.2}'
		);
	});

	it('writes nothing for an emptied box or the same value', () => {
		expect(atAxisWrite(mira, 'x', undefined)).toBeUndefined();
		expect(atAxisWrite(mira, 'x', -0.4)).toBeUndefined();
		expect(atAxisWrite(mira, 'x', -0.40001)).toBeUndefined();
	});
});

describe('scaleKeyWrite()', () => {
	it('writes a new scale', () => {
		expect(written([scaleKeyWrite(mira, 0.8)])).toContain(
			'mira: {at: -0.4, scale: 0.8}'
		);
	});

	it('deletes the key at 1 or empty, and says scale: 1 on a beat', () => {
		expect(scaleKeyWrite(joren, 1)).toEqual(
			expect.objectContaining({key: 'scale', reset: 1, value: undefined})
		);
		expect(scaleKeyWrite(joren, undefined)).toEqual(scaleKeyWrite(joren, 1));
		expect(written([scaleKeyWrite(joren, undefined)])).toContain(
			'joren: {at: 0.3, rot: 10, z: 2}'
		);
	});

	it('writes nothing when already at that scale, or out of bounds', () => {
		expect(scaleKeyWrite(mira, undefined)).toBeUndefined();
		expect(scaleKeyWrite(mira, 1)).toBeUndefined();
		expect(scaleKeyWrite(mira, 0)).toBeUndefined();
		expect(scaleKeyWrite(mira, 11)).toBeUndefined();
	});
});

describe('rotKeyWrite()', () => {
	it('writes degrees', () => {
		expect(written([rotKeyWrite(mira, 90)])).toContain(
			'mira: {at: -0.4, rot: 90}'
		);
	});

	it('deletes at 0 or empty, with rot: 0 for a beat', () => {
		expect(rotKeyWrite(joren, undefined)).toEqual(
			expect.objectContaining({key: 'rot', reset: 0, value: undefined})
		);
		expect(rotKeyWrite(joren, 0)).toEqual(rotKeyWrite(joren, undefined));
	});

	it('writes nothing past a full turn or for no change', () => {
		expect(rotKeyWrite(mira, 400)).toBeUndefined();
		expect(rotKeyWrite(mira, 0)).toBeUndefined();
		expect(rotKeyWrite(joren, 10)).toBeUndefined();
	});
});

describe('zKeyWrite()', () => {
	it('writes an explicit z', () => {
		expect(written([zKeyWrite(drawn.entities!.mira, 1.5)])).toContain(
			'mira: {at: -0.4, z: 1.5}'
		);
	});

	it('removes z when emptied, resetting a beat to the y-derived number', () => {
		const write = zKeyWrite(drawn.entities!.joren, undefined);

		expect(write).toEqual(
			expect.objectContaining({
				key: 'z',
				reset: derivedZ(drawn.entities!.joren),
				value: undefined
			})
		);
		expect(written([write])).toContain('joren: {at: 0.3, scale: 1.5, rot: 10}');
	});

	it('writes nothing when emptying a z that was never written', () => {
		expect(zKeyWrite(drawn.entities!.mira, undefined)).toBeUndefined();
		expect(zKeyWrite(drawn.entities!.joren, 2)).toBeUndefined();
	});

	it('derives z from the DRAWN y of an of: child', () => {
		// cup sits at its parent's y, so it orders with mira, not at offset 0.
		expect(derivedZ(drawn.entities!.cup)).toBe(derivedZ(drawn.entities!.mira));
	});
});

describe('on a beat', () => {
	it('lands in the beat that owns the entity', () => {
		const text = written([atAxisWrite(mira, 'x', 0.5)], 1);

		expect(text).toContain('cast:\n  mira: {at: -0.4}');
		expect(text).toContain('- mira: {at: 0.5}');
	});
});
