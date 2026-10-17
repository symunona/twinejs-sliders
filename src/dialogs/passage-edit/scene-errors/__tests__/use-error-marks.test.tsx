/**
 * Drives a real headless CodeMirror Doc, the one the passage registry holds: marks live on
 * the Doc, so they need no view. What they say is exactly what an attached view renders.
 */

// The repo stubs `codemirror` for every other suite (src/__mocks__/codemirror.ts).
jest.unmock('codemirror');

import {render} from '@testing-library/react';
import CodeMirror from 'codemirror';
import * as React from 'react';
import {SceneError} from '@sliders/scene-types';
import type {LiveDoc} from '../../../../store/passage-docs';
import {useSceneErrorMarks} from '../use-error-marks';

const passage = '[scene]\nbg: tavern\nchast:\n  mira: {at: 0}\n';

function error(overrides: Partial<SceneError> = {}): SceneError {
	return {
		code: 'unknown-key',
		col: 1,
		endCol: 6,
		endLine: 3,
		hint: "Did you mean 'cast'?",
		line: 3,
		message: "Unknown key 'chast'.",
		severity: 'error',
		...overrides
	};
}

let editor: LiveDoc;

beforeEach(() => {
	editor = new CodeMirror.Doc(passage) as LiveDoc;
});

function Marks({errors}: {errors: SceneError[]}) {
	useSceneErrorMarks(editor, undefined, errors);

	return null;
}

/** Every mark, with the text it covers. */
function marks() {
	return editor.getAllMarks().map(mark => {
		const range = mark.find() as {
			from: CodeMirror.Position;
			to: CodeMirror.Position;
		};

		return {
			className: (mark as {className?: string}).className,
			hint: (mark as {attributes?: Record<string, string>}).attributes?.[
				'data-sliders-hint'
			],
			message: (mark as {attributes?: Record<string, string>}).attributes?.[
				'data-sliders-error'
			],
			text: editor.getRange(range.from, range.to)
		};
	});
}

describe('useSceneErrorMarks()', () => {
	it('marks the span an error names and carries its message', () => {
		render(<Marks errors={[error()]} />);

		expect(marks()).toEqual([
			{
				className: 'sliders-scene-error',
				hint: "Did you mean 'cast'?",
				message: "Unknown key 'chast'.",
				text: 'chast'
			}
		]);
		expect(editor.lineInfo(2).bgClass).toBe('sliders-error-line');
	});

	it('tells a warning from an error', () => {
		render(<Marks errors={[error({severity: 'warning'})]} />);

		expect(marks()[0].className).toBe('sliders-scene-warning');
		expect(editor.lineInfo(2).bgClass).toBe('sliders-warning-line');
	});

	it('marks the first line only when the error spans several', () => {
		render(<Marks errors={[error({col: 1, endCol: 3, endLine: 4})]} />);

		expect(marks()[0].text).toBe('chast:');
	});

	it('marks the whole line when the span is empty', () => {
		render(<Marks errors={[error({col: 1, endCol: 1})]} />);

		expect(marks()[0].text).toBe('chast:');
	});

	it('ignores a line the document does not have', () => {
		render(<Marks errors={[error({line: 99})]} />);
		expect(marks()).toEqual([]);
	});

	it('clears its marks when the errors go away', () => {
		const {rerender} = render(<Marks errors={[error()]} />);

		expect(marks()).toHaveLength(1);
		rerender(<Marks errors={[]} />);
		expect(marks()).toEqual([]);
		expect(editor.lineInfo(2).bgClass).toBeFalsy();
	});
});
