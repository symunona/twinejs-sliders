/**
 * Drives a real CodeMirror: the marks and the mousedown hook are the editor's own state,
 * and none of it shows up in React's tree.
 *
 * The click is signalled rather than dispatched, and `coordsChar` is stubbed, because
 * jsdom has no layout — CodeMirror draws no lines, so there is no span at a coordinate to
 * hit. What the hook does with a position is the part worth asserting.
 */

// The repo stubs `codemirror` for every other suite (src/__mocks__/codemirror.ts).
jest.unmock('codemirror');

import {act, render} from '@testing-library/react';
import CodeMirror from 'codemirror';
import * as React from 'react';
import {useCtrlClickLinks} from '../use-ctrl-click-links';

/** CodeMirror measures text by range, and jsdom has none of that. */
beforeAll(() => {
	const empty = () => ({
		bottom: 0,
		height: 0,
		left: 0,
		right: 0,
		top: 0,
		width: 0
	});

	Range.prototype.getBoundingClientRect = empty as never;
	Range.prototype.getClientRects = (() => ({
		item: () => null,
		length: 0
	})) as never;
});

const passage = [
	'[scene]',
	'links:',
	'  stay: Tavern Fight',
	'',
	'- say: [[stay]] or [[Street]]?'
].join('\n');

let editor: CodeMirror.Editor;

function Links({onOpenPassage}: {onOpenPassage?: (name: string) => void}) {
	const [ready, setReady] = React.useState(false);
	const ref = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		editor = CodeMirror(ref.current!, {value: passage});
		setReady(true);
	}, []);

	useCtrlClickLinks(ready ? editor : undefined, onOpenPassage);

	return <div ref={ref} />;
}

/** Click where `needle` is written, with whatever modifiers the test names. */
function clickAt(needle: string, init: Partial<MouseEvent> = {}) {
	const index = passage.indexOf(needle);

	expect(index).toBeGreaterThanOrEqual(0);

	const event = {
		button: 0,
		clientX: 0,
		clientY: 0,
		ctrlKey: false,
		metaKey: false,
		preventDefault: jest.fn(),
		...init
	};

	editor.coordsChar = jest.fn(() => editor.posFromIndex(index)) as never;
	act(() => {
		CodeMirror.signal(editor, 'mousedown', editor, event);
	});

	return event;
}

function holdModifier(down: boolean) {
	act(() => {
		document.dispatchEvent(
			new KeyboardEvent(down ? 'keydown' : 'keyup', {
				ctrlKey: down,
				key: 'Control'
			})
		);
	});
}

describe('useCtrlClickLinks', () => {
	it('opens the passage a wiki link points at', () => {
		const onOpenPassage = jest.fn();

		render(<Links onOpenPassage={onOpenPassage} />);

		const event = clickAt('[[Street]]', {ctrlKey: true});

		expect(onOpenPassage).toHaveBeenCalledWith('Street');
		// Otherwise CodeMirror drops a second cursor where the author just navigated from.
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it('resolves a bare [[name]] through the links: block', () => {
		const onOpenPassage = jest.fn();

		render(<Links onOpenPassage={onOpenPassage} />);
		clickAt('[[stay]]', {metaKey: true});

		expect(onOpenPassage).toHaveBeenCalledWith('Tavern Fight');
	});

	it('opens a target written in the links: block itself', () => {
		const onOpenPassage = jest.fn();

		render(<Links onOpenPassage={onOpenPassage} />);
		clickAt('Tavern Fight', {ctrlKey: true});

		expect(onOpenPassage).toHaveBeenCalledWith('Tavern Fight');
	});

	it('does nothing without the modifier', () => {
		const onOpenPassage = jest.fn();

		render(<Links onOpenPassage={onOpenPassage} />);

		const event = clickAt('[[Street]]');

		expect(onOpenPassage).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('does nothing when the click misses every link', () => {
		const onOpenPassage = jest.fn();

		render(<Links onOpenPassage={onOpenPassage} />);

		const event = clickAt('- say:', {ctrlKey: true});

		expect(onOpenPassage).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('marks what is clickable only while the modifier is held', () => {
		render(<Links onOpenPassage={jest.fn()} />);

		expect(editor.getAllMarks()).toHaveLength(0);

		holdModifier(true);

		// Both wiki links plus the links: target itself.
		expect(editor.getAllMarks()).toHaveLength(3);
		expect(
			editor.getWrapperElement().classList.contains('sliders-ctrl-link-armed')
		).toBe(true);

		holdModifier(false);

		expect(editor.getAllMarks()).toHaveLength(0);
		expect(
			editor.getWrapperElement().classList.contains('sliders-ctrl-link-armed')
		).toBe(false);
	});
});
