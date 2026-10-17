// The repo stubs `codemirror` for every other suite (src/__mocks__/codemirror.ts).
jest.unmock('codemirror');

import {act, renderHook} from '@testing-library/react-hooks';
import CodeMirror from 'codemirror';
import type {LiveDoc} from '../../../../store/passage-docs';
import {extractSceneBlock} from '@sliders/scene-index';
import type {Scene} from '@sliders/scene-types';
import {parseSceneText} from '../use-scene-parse';
import {beatAtLine} from '../use-active-beat-mark';
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
	'bg: tavern', // 3   block line 1
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

/** Headless Doc events land on a zero timeout. */
function settle() {
	jest.advanceTimersByTime(0);
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
	// CodeMirror queues headless Doc events behind ONE module-level timeout; clearing it
	// unfired would starve every later test.
	jest.runOnlyPendingTimers();
	jest.useRealTimers();
});

/**
 * A real headless Doc, the registry's, for the caret and the marks. The view is a fake:
 * only the double click needs one, and jsdom has no layout for `coordsChar` to read.
 */
function fakeEditor(lines: string[]) {
	const doc = new CodeMirror.Doc(lines.join('\n')) as LiveDoc;
	const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
	const view = {
		// Lines are 20px tall in this fake, so a click's y names its line.
		coordsChar: (at: {top: number}) => ({ch: 0, line: Math.floor(at.top / 20)}),
		off(event: string, fn: (...args: unknown[]) => void) {
			handlers[event] = (handlers[event] ?? []).filter(one => one !== fn);
		},
		on(event: string, fn: (...args: unknown[]) => void) {
			handlers[event] = [...(handlers[event] ?? []), fn];
		}
	} as unknown as CodeMirror.Editor;

	return {
		get marks() {
			return doc.getAllMarks().map(mark => {
				const {ch, line} = (mark.find() as {from: CodeMirror.Position}).from;

				return {from: {ch, line}};
			});
		},
		editor: doc,
		view,
		moveCaretTo(line: number) {
			doc.setCursor({ch: 0, line});
			settle();
		},
		cursor: () => {
			const {ch, line} = doc.getCursor();

			return {ch, line};
		},
		doubleClickLine(line: number) {
			const event = {clientX: 4, clientY: line * 20 + 5};

			(handlers['dblclick'] ?? []).forEach(fn => fn(view, event));
		}
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

describe('useStageSelection() double click', () => {
	function setup(fake: ReturnType<typeof fakeEditor>) {
		const onFocusEntity = jest.fn();
		const hook = renderHook(() =>
			useStageSelection({
				block,
				editor: fake.editor,
				enabled: true,
				kindOf: () => 'cast',
				onFocusEntity,
				view: fake.view,
				scene,
				stageIds: ['mira', 'bram', 'candle']
			})
		);

		return {...hook, onFocusEntity};
	}

	it('asks the stage to show the entity on an entry line', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {onFocusEntity, result} = setup(fake);

		act(() => fake.doubleClickLine(8));

		expect(result.current.selection).toEqual(['candle']);
		expect(onFocusEntity).toHaveBeenCalledWith('candle');
	});

	it('asks for the speaker on a beat line', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {onFocusEntity} = setup(fake);

		act(() => fake.doubleClickLine(11));

		expect(onFocusEntity).toHaveBeenCalledWith('bram');
	});

	it('asks for nothing on a line that names no entity', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {onFocusEntity} = setup(fake);

		act(() => fake.doubleClickLine(3));

		expect(onFocusEntity).not.toHaveBeenCalled();
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

		act(() => {
			result.current.select(['bram']);
			settle();
		});

		expect(result.current.selection).toEqual(['bram']);
		expect(fake.cursor()).toEqual({ch: 0, line: 6});
	});

	it('does not let the caret echo collapse a multi-select', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {result} = setup(fake);

		act(() => {
			result.current.select(['mira', 'bram']);
			settle();
		});

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

		act(() => {
			result.current.select(['mira']);
			settle();
		});

		expect(fake.marks).toHaveLength(3);
		expect(fake.marks[0].from).toEqual({ch: 0, line: 5});
		expect(fake.marks[1].from).toEqual({ch: 0, line: 10});
		expect(fake.marks[2].from).toEqual({ch: 0, line: 12});
	});

	it('clears its marks when the selection goes away', () => {
		const fake = fakeEditor(passage.split('\n'));
		const {result} = setup(fake);

		act(() => {
			result.current.select(['mira']);
			settle();
		});
		act(() => result.current.clear());

		expect(result.current.selection).toEqual([]);
		expect(fake.marks).toHaveLength(0);
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

		act(() => {
			result.current.select(['bram']);
			settle();
		});
		rerender({stageIds: ['mira']});

		expect(result.current.selection).toEqual([]);
	});
});

describe('beatAtLine()', () => {
	const spans = parseSceneText(passage).result!.beatSpans;

	it('finds the beat the caret is standing in', () => {
		// Passage line 10 is `  - mira: "Hello."`, the first beat.
		expect(beatAtLine(spans, 10, block.lineOffset, 13)).toBe(0);
		expect(beatAtLine(spans, 11, block.lineOffset, 13)).toBe(1);
		expect(beatAtLine(spans, 12, block.lineOffset, 13)).toBe(2);
	});

	it('finds nothing outside the beats', () => {
		// `cast:` and its entries, and the `beats:` key itself.
		expect(beatAtLine(spans, 4, block.lineOffset, 13)).toBeUndefined();
		expect(beatAtLine(spans, 5, block.lineOffset, 13)).toBeUndefined();
		expect(beatAtLine(spans, 9, block.lineOffset, 13)).toBeUndefined();
	});

	it('finds nothing above the block', () => {
		expect(beatAtLine(spans, 0, block.lineOffset, 13)).toBeUndefined();
	});

	it('finds nothing without spans', () => {
		expect(beatAtLine(undefined, 10, block.lineOffset, 13)).toBeUndefined();
	});
});

describe('the caret driving the scrubber', () => {
	const spans = parseSceneText(passage).result!.beatSpans;

	function render(onCaretBeat: (beat: number) => void) {
		const fake = fakeEditor(passage.split('\n'));
		const hook = renderHook(() =>
			useStageSelection({
				beatSpans: spans,
				block,
				editor: fake.editor,
				enabled: true,
				kindOf: () => 'cast',
				onCaretBeat,
				scene,
				stageIds: ['mira', 'bram', 'candle']
			})
		);

		return {fake, hook};
	}

	it('reports the scrubber position for a caret inside a beat', () => {
		const onCaretBeat = jest.fn();
		const {fake} = render(onCaretBeat);

		act(() => fake.moveCaretTo(11));
		// Beat index 1, so scrubber position 2 — state N is produced by beat N - 1.
		expect(onCaretBeat).toHaveBeenLastCalledWith(2);
	});

	it('reports the opening state for a caret outside every beat', () => {
		const onCaretBeat = jest.fn();
		const {fake} = render(onCaretBeat);

		act(() => fake.moveCaretTo(5));
		expect(onCaretBeat).toHaveBeenLastCalledWith(0);
	});

	// The echo guard earns its keep here: `select()` moves the caret itself, and without it
	// clicking a sprite would throw the scrubber back to the opening state.
	it('says nothing when the caret move was its own', () => {
		const onCaretBeat = jest.fn();
		const {hook} = render(onCaretBeat);

		act(() => {
			hook.result.current.select(['bram']);
			settle();
		});
		expect(onCaretBeat).not.toHaveBeenCalled();
	});
});
