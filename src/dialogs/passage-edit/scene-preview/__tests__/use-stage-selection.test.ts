import {act, renderHook} from '@testing-library/react-hooks';
import {extractSceneBlock} from '@sliders/scene-index';
import type {Scene} from '@sliders/scene-types';
import {parseSceneText} from '../use-scene-parse';
import {
	blockLineToEditorLine,
	editorLineToBlockLine,
	entityAtEditorLine,
	entityHighlights,
	useStageSelection
} from '../use-stage-selection';

// Line numbers are load-bearing here, so they are spelled out. The passage is 0-indexed
// (CodeMirror), the block is 1-indexed and starts three lines in.
const passage = [
	'mood: tense', // 0
	'--', // 1
	'[scene]', // 2   block line 0 — the modifier is NOT part of the block
	'id: tavern', // 3   block line 1
	'cast:', // 4   block line 2
	'  mira: {at: -0.4}', // 5   block line 3
	'  bram: {at: 0.4}', // 6   block line 4
	'props:', // 7   block line 5
	'  candle: {at: 0.1}', // 8   block line 6
	'beats:', // 9   block line 7
	'  - mira: "Hello."', // 10  block line 8
	'  - bram: {at: 0.2}', // 11  block line 9
	'  - mira: "Again."' // 12  block line 10
].join('\n');

const block = extractSceneBlock(passage)!;
const scene = parseSceneText(passage).result!.scene as Scene;

/** Just enough CodeMirror for the selection to talk to. */
function fakeEditor(lines: string[]) {
	const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
	const marks: {
		from: unknown;
		to: unknown;
		options: unknown;
		cleared: boolean;
	}[] = [];
	let cursor = {ch: 0, line: 0};

	const doc = {
		getLine: (line: number) => lines[line],
		lastLine: () => lines.length - 1,
		markText(from: unknown, to: unknown, options: unknown) {
			const mark = {cleared: false, from, options, to};

			marks.push(mark);

			return {
				clear() {
					mark.cleared = true;
				}
			};
		}
	};

	return {
		marks,
		editor: {
			getCursor: () => cursor,
			getDoc: () => doc,
			off(event: string, fn: (...args: unknown[]) => void) {
				handlers[event] = (handlers[event] ?? []).filter(one => one !== fn);
			},
			on(event: string, fn: (...args: unknown[]) => void) {
				handlers[event] = [...(handlers[event] ?? []), fn];
			},
			setCursor(position: {ch: number; line: number}) {
				cursor = position;
				// CodeMirror signals this synchronously at the end of the operation the
				// call opens, which is exactly the echo the hook has to survive.
				(handlers['cursorActivity'] ?? []).forEach(fn => fn());
			}
		} as unknown as CodeMirror.Editor,
		moveCaretTo(line: number) {
			cursor = {ch: 0, line};
			(handlers['cursorActivity'] ?? []).forEach(fn => fn());
		},
		cursor: () => cursor
	};
}

describe('line conversion', () => {
	it('maps a block line onto the CodeMirror line', () => {
		// Block line 3 is `  mira: …`, passage line 5.
		expect(blockLineToEditorLine(block, 3)).toBe(5);
	});

	it('maps back', () => {
		expect(editorLineToBlockLine(block, 5)).toBe(3);
	});

	it('round trips every line of the block', () => {
		for (let line = 1; line <= 10; line++) {
			expect(
				editorLineToBlockLine(block, blockLineToEditorLine(block, line))
			).toBe(line);
		}
	});
});

describe('entityAtEditorLine()', () => {
	it('finds the entity whose entry the caret is on', () => {
		expect(entityAtEditorLine(block, 5)).toEqual({id: 'mira', kind: 'cast'});
		expect(entityAtEditorLine(block, 6)).toEqual({id: 'bram', kind: 'cast'});
		expect(entityAtEditorLine(block, 8)).toEqual({id: 'candle', kind: 'prop'});
	});

	it('finds the speaker of the beat the caret is on', () => {
		expect(entityAtEditorLine(block, 11)).toEqual({
			beat: 1,
			id: 'bram',
			kind: 'cast'
		});
	});

	it('finds nothing above the block', () => {
		expect(entityAtEditorLine(block, 0)).toBeUndefined();
		expect(entityAtEditorLine(block, 2)).toBeUndefined();
	});

	it('finds nothing without a block', () => {
		expect(entityAtEditorLine(undefined, 5)).toBeUndefined();
	});
});

describe('entityHighlights()', () => {
	it('reports the entry and every beat that names the entity, in editor lines', () => {
		const {beats, entry} = entityHighlights(block, scene, 'mira', 'cast');

		expect(entry).toEqual({end: 5, start: 5});
		expect(beats).toEqual([
			{end: 10, start: 10},
			{end: 12, start: 12}
		]);
	});

	it('leaves out beats belonging to other entities', () => {
		expect(entityHighlights(block, scene, 'bram', 'cast').beats).toEqual([
			{end: 11, start: 11}
		]);
	});
});

describe('useStageSelection()', () => {
	function setup(fake: ReturnType<typeof fakeEditor>) {
		return renderHook(() =>
			useStageSelection({
				block,
				editor: fake.editor,
				enabled: true,
				kindOf: () => 'cast',
				scene,
				stageIds: ['mira', 'bram', 'candle']
			})
		);
	}

	it('moves the caret to the entity a stage click selected', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {result} = setup(fake);

		act(() => result.current.select(['bram']));

		expect(result.current.selection).toEqual(['bram']);
		expect(fake.cursor()).toEqual({ch: 0, line: 6});
	});

	it('does not let the caret echo collapse a multi-select', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {result} = setup(fake);

		act(() => result.current.select(['mira', 'bram']));

		// The caret landed on mira's line and fired cursorActivity. Without the echo
		// guard that would have set the selection back to mira alone, and the render it
		// caused would have moved the caret again — the oscillation this test pins.
		expect(result.current.selection).toEqual(['mira', 'bram']);
		expect(fake.cursor()).toEqual({ch: 0, line: 5});
	});

	it('selects the entity the caret is moved onto', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {result} = setup(fake);

		act(() => fake.moveCaretTo(8));
		expect(result.current.selection).toEqual(['candle']);

		act(() => fake.moveCaretTo(11));
		expect(result.current.selection).toEqual(['bram']);
	});

	it('keeps the selection when the caret moves off every entity', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {result} = setup(fake);

		act(() => fake.moveCaretTo(8));
		act(() => fake.moveCaretTo(0));
		expect(result.current.selection).toEqual(['candle']);
	});

	it('marks the entry and the beat lines of the selection', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {result} = setup(fake);

		act(() => result.current.select(['mira']));

		expect(fake.marks).toHaveLength(3);
		expect(fake.marks[0].from).toEqual({ch: 0, line: 5});
		expect(fake.marks[1].from).toEqual({ch: 0, line: 10});
		expect(fake.marks[2].from).toEqual({ch: 0, line: 12});
	});

	it('clears its marks when the selection goes away', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {result} = setup(fake);

		act(() => result.current.select(['mira']));
		act(() => result.current.clear());

		expect(result.current.selection).toEqual([]);
		expect(fake.marks.every(mark => mark.cleared)).toBe(true);
	});

	it('drops a selection the author deleted out of the text', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {rerender, result} = renderHook(
			({stageIds}: {stageIds: string[]}) =>
				useStageSelection({
					block,
					editor: fake.editor,
					enabled: true,
					kindOf: () => 'cast',
					scene,
					stageIds
				}),
			{initialProps: {stageIds: ['mira', 'bram']}}
		);

		act(() => result.current.select(['bram']));
		rerender({stageIds: ['mira']});

		expect(result.current.selection).toEqual([]);
	});
});
