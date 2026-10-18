import {extractSceneBlock} from '@sliders/scene-index';
import {applyEdit} from '@sliders/scene-edit';
import {resolveStage} from '@sliders/scene-core';
import {LAYER_BASELINE} from '@sliders/scene-types';
import {parseSceneText} from '../use-scene-parse';
import {buildWriteEdits, mergeEdits} from '../use-scene-writer';
import {parentChoices, parentWrites} from '../transform-writes';

/**
 * The parent select: `of:` and the `at` that keeps the sprite where it stands, checked as
 * the text they splice and as the stage that text parses back to.
 */

function setup(passage: string, beat = 0) {
	const parsed = parseSceneText(passage);
	const authored = parsed.states[beat];

	return {
		authored,
		drawn: resolveStage(authored),
		/** `writes` spliced the way the writer does, then the drawn stage they make. */
		apply(writes: Parameters<typeof buildWriteEdits>[1]) {
			const block = extractSceneBlock(passage)!;
			const edits = buildWriteEdits(
				{
					beat,
					blockOffset: block.offset,
					blockText: block.text,
					scene: parsed.result!.scene
				},
				writes
			);
			const text = applyEdit(block.text, mergeEdits(block.text, edits)!);
			const after = parseSceneText(`[scene]\n${text}`);

			return {drawn: resolveStage(after.states[beat]), text};
		}
	};
}

/** Where it stands on screen. Float noise from the subtraction is not a move. */
function expectSamePlace(
	after: {x: number; y: number},
	before: {x: number; y: number}
) {
	expect(after.x).toBeCloseTo(before.x, 6);
	expect(after.y).toBeCloseTo(before.y, 6);
}

const snapshot = [
	'[scene]',
	'cast:',
	'  mira: {at: -0.4}',
	'props:',
	'  table: {at: [0.2, -0.5]}',
	'  cup: {of: table, at: [0.1, 0.2]}',
	'  plate: {at: 0.5}',
	'  sky: {fit: cover}'
].join('\n');

describe('parentChoices()', () => {
	it('offers every other sprite but its own descendants and planes', () => {
		const {authored} = setup(snapshot);

		expect(parentChoices(authored, 'table')).toEqual(['mira', 'plate']);
		expect(parentChoices(authored, 'cup')).toEqual(['mira', 'table', 'plate']);
	});
});

describe('parentWrites()', () => {
	it('attaches with the offset that keeps it in place', () => {
		const {apply, authored, drawn} = setup(snapshot);
		const result = apply(
			parentWrites(authored.entities!.plate, drawn, 'table', false)
		);

		expect(result.text).toContain('plate: {at: [0.3, -0.35], of: table}');
		expectSamePlace(result.drawn.entities!.plate.at, drawn.entities!.plate.at);
	});

	it('reparents, keeping the place', () => {
		const {apply, authored, drawn} = setup(snapshot);
		const result = apply(
			parentWrites(authored.entities!.cup, drawn, 'mira', false)
		);

		expect(result.text).toContain('cup: {of: mira, at: [');
		expectSamePlace(result.drawn.entities!.cup.at, drawn.entities!.cup.at);
	});

	it('detaches by deleting the key in a snapshot scene', () => {
		const {apply, authored, drawn} = setup(snapshot);
		const result = apply(
			parentWrites(authored.entities!.cup, drawn, undefined, false)
		);

		expect(result.text).toContain('cup: {at: [0.3, -0.3]}');
		expectSamePlace(result.drawn.entities!.cup.at, drawn.entities!.cup.at);
	});

	it('writes an explicit pair when the offset lands on the floor', () => {
		const passage = [
			'[scene]',
			'props:',
			'  table: {at: [0, 0]}',
			`  plate: {at: [0.5, ${LAYER_BASELINE}]}`
		].join('\n');
		const {apply, authored, drawn} = setup(passage);
		const result = apply(
			parentWrites(authored.entities!.plate, drawn, 'table', false)
		);

		expect(result.text).toContain(`at: [0.5, ${LAYER_BASELINE}]`);
		expectSamePlace(result.drawn.entities!.plate.at, drawn.entities!.plate.at);
	});

	it('writes an explicit pair when a detached y lands on zero', () => {
		const passage = [
			'[scene]',
			'props:',
			'  table: {at: [0, 0.3]}',
			'  cup: {of: table, at: [0.1, -0.3]}'
		].join('\n');
		const {apply, authored, drawn} = setup(passage);
		const result = apply(
			parentWrites(authored.entities!.cup, drawn, undefined, false)
		);

		expect(result.text).toContain('cup: {at: [0.1, 0]}');
		expectSamePlace(result.drawn.entities!.cup.at, drawn.entities!.cup.at);
	});

	it('says of: ~ in a patch scene', () => {
		const writes = parentWrites(
			setup(snapshot).authored.entities!.cup,
			setup(snapshot).drawn,
			undefined,
			true
		);

		expect(writes[0]).toMatchObject({key: 'of', value: null});
	});

	it('says of: ~ on a beat', () => {
		const passage = [
			...snapshot.split('\n'),
			'beats:',
			'  - cup: {at: [0.1, 0.3]}'
		].join('\n');
		const {apply, authored, drawn} = setup(passage, 1);
		const result = apply(
			parentWrites(authored.entities!.cup, drawn, undefined, false)
		);

		expect(result.text).toContain('- cup: {at: [0.3, -0.2], of: ~}');
		expectSamePlace(result.drawn.entities!.cup.at, drawn.entities!.cup.at);
	});

	it('writes nothing when the parent does not change', () => {
		const {authored, drawn} = setup(snapshot);

		expect(parentWrites(authored.entities!.cup, drawn, 'table', false)).toEqual(
			[]
		);
		expect(
			parentWrites(authored.entities!.plate, drawn, undefined, false)
		).toEqual([]);
	});
});
