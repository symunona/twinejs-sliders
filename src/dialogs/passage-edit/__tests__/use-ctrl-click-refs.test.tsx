/**
 * The other half of `use-ctrl-click-links.test.tsx`: the same gesture landing on the art a
 * scene names rather than on a passage. Separate file, separate document — the link suite's
 * passage holds no scene entities, and the two mark counts would keep colliding.
 *
 * Same stubs and the same reason for them: jsdom has no layout, so `coordsChar` is faked
 * and the click is signalled rather than dispatched.
 */

// The repo stubs `codemirror` for every other suite (src/__mocks__/codemirror.ts).
jest.unmock('codemirror');

import {act, render} from '@testing-library/react';
import CodeMirror from 'codemirror';
import * as React from 'react';
import {PassageRefSpan} from '../../../util/passage-ref-spans';
import {useCtrlClickLinks} from '../use-ctrl-click-links';

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
	'bg: tavern/night',
	'cast:',
	'  mira: {at: -0.4, pose: arms-crossed}',
	'props:',
	'  candle: {at: 0.1, link: Cellar}'
].join('\n');

let editor: CodeMirror.Editor;

function Refs(props: {
	onOpenPassage?: (name: string) => void;
	onOpenRef?: (span: PassageRefSpan) => void;
}) {
	const [ready, setReady] = React.useState(false);
	const ref = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		editor = CodeMirror(ref.current!, {value: passage});
		setReady(true);
	}, []);

	useCtrlClickLinks(
		ready ? editor : undefined,
		props.onOpenPassage,
		props.onOpenRef
	);

	return <div ref={ref} />;
}

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

describe('useCtrlClickLinks, on a scene reference', () => {
	it('opens a backdrop', () => {
		const onOpenRef = jest.fn();

		render(<Refs onOpenPassage={jest.fn()} onOpenRef={onOpenRef} />);

		const event = clickAt('tavern/night', {ctrlKey: true});

		expect(onOpenRef).toHaveBeenCalledWith(
			expect.objectContaining({kind: 'bg', ref: 'tavern/night'})
		);
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it('opens a cast id', () => {
		const onOpenRef = jest.fn();

		render(<Refs onOpenPassage={jest.fn()} onOpenRef={onOpenRef} />);
		clickAt('mira', {metaKey: true});

		expect(onOpenRef).toHaveBeenCalledWith(
			expect.objectContaining({kind: 'entity', ref: 'mira'})
		);
	});

	it('opens a prop id', () => {
		const onOpenRef = jest.fn();

		render(<Refs onOpenPassage={jest.fn()} onOpenRef={onOpenRef} />);
		clickAt('candle', {ctrlKey: true});

		expect(onOpenRef).toHaveBeenCalledWith(
			expect.objectContaining({kind: 'entity', ref: 'candle'})
		);
	});

	it('opens a pose, naming the entity it belongs to', () => {
		const onOpenRef = jest.fn();

		render(<Refs onOpenPassage={jest.fn()} onOpenRef={onOpenRef} />);
		clickAt('arms-crossed', {ctrlKey: true});

		expect(onOpenRef).toHaveBeenCalledWith(
			expect.objectContaining({kind: 'pose', owner: 'mira', ref: 'arms-crossed'})
		);
	});

	it('gives a link priority over a reference', () => {
		const onOpenPassage = jest.fn();
		const onOpenRef = jest.fn();

		render(<Refs onOpenPassage={onOpenPassage} onOpenRef={onOpenRef} />);
		clickAt('Cellar', {ctrlKey: true});

		expect(onOpenPassage).toHaveBeenCalledWith('Cellar');
		expect(onOpenRef).not.toHaveBeenCalled();
	});

	it('does nothing without the modifier', () => {
		const onOpenRef = jest.fn();

		render(<Refs onOpenPassage={jest.fn()} onOpenRef={onOpenRef} />);

		const event = clickAt('tavern/night');

		expect(onOpenRef).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('does nothing when the click misses everything', () => {
		const onOpenRef = jest.fn();

		render(<Refs onOpenPassage={jest.fn()} onOpenRef={onOpenRef} />);

		const event = clickAt('at: -0.4', {ctrlKey: true});

		expect(onOpenRef).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('underlines references alongside links while the modifier is held', () => {
		render(<Refs onOpenPassage={jest.fn()} onOpenRef={jest.fn()} />);
		holdModifier(true);

		// `Cellar` as a link, plus bg, mira, arms-crossed and candle.
		expect(editor.getAllMarks()).toHaveLength(5);

		holdModifier(false);

		expect(editor.getAllMarks()).toHaveLength(0);
	});

	it('leaves references alone when nothing is listening for them', () => {
		render(<Refs onOpenPassage={jest.fn()} />);
		holdModifier(true);

		// Only the entity `link:`.
		expect(editor.getAllMarks()).toHaveLength(1);

		const event = clickAt('tavern/night', {ctrlKey: true});

		expect(event.preventDefault).not.toHaveBeenCalled();
	});
});
