import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {Beat} from '@sliders/scene-types';
import {BeatPanel, BeatPanelProps} from '../beat-panel';

const SAY: Beat = {
	index: 0,
	kind: 'say',
	style: {as: 'comic', w: 0.4},
	text: 'Hello.',
	who: 'mira'
};

function renderPanel(props: Partial<BeatPanelProps> = {}) {
	const handlers = {
		onClose: jest.fn(),
		onMakeDefault: jest.fn(),
		onSetBubble: jest.fn(),
		onSetKey: jest.fn(),
		onSetText: jest.fn()
	};
	const view = render(
		<BeatPanel
			beat={SAY}
			beatCount={2}
			beatNumber={1}
			editable
			{...handlers}
			{...props}
		/>
	);

	return {...handlers, view};
}

describe('BeatPanel', () => {
	it('shows the words, then the beat props in panel layout under them', () => {
		renderPanel();

		const text = screen.getByTestId('beat-panel-text') as HTMLTextAreaElement;
		const props = screen.getByTestId('scene-preview-beat-props');

		expect(text.value).toBe('Hello.');
		expect(props).toHaveClass('panel');
		// Text box first, props below it.
		expect(
			text.compareDocumentPosition(props) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			screen.getByText('dialogs.passageEdit.beatProps.timing')
		).toBeInTheDocument();
		expect(
			screen.getByText('dialogs.passageEdit.beatProps.bubble')
		).toBeInTheDocument();
	});

	it('writes the words on blur, only when they changed', () => {
		const {onSetText} = renderPanel();
		const text = screen.getByTestId('beat-panel-text');

		fireEvent.blur(text);
		expect(onSetText).not.toHaveBeenCalled();

		fireEvent.change(text, {target: {value: 'Goodbye.'}});
		fireEvent.blur(text);
		expect(onSetText).toHaveBeenCalledWith('Goodbye.');
	});

	it('writes on Enter, keeps Shift+Enter, reverts on Escape', () => {
		const {onSetText} = renderPanel();
		const text = screen.getByTestId('beat-panel-text') as HTMLTextAreaElement;

		fireEvent.change(text, {target: {value: 'Nope.'}});
		fireEvent.keyDown(text, {key: 'Escape'});
		expect(text.value).toBe('Hello.');

		fireEvent.change(text, {target: {value: 'Two'}});
		fireEvent.keyDown(text, {key: 'Enter', shiftKey: true});
		expect(onSetText).not.toHaveBeenCalled();

		fireEvent.keyDown(text, {key: 'Enter'});
		expect(onSetText).toHaveBeenCalledWith('Two');
	});

	it('focuses the text box when asked', () => {
		const {view} = renderPanel();

		view.rerender(
			<BeatPanel
				beat={SAY}
				beatCount={2}
				beatNumber={1}
				editable
				focusText={1}
				onClose={jest.fn()}
				onSetBubble={jest.fn()}
				onSetKey={jest.fn()}
				onSetText={jest.fn()}
			/>
		);
		expect(document.activeElement).toBe(screen.getByTestId('beat-panel-text'));
	});

	it('makes the style the default only after the confirm', () => {
		const {onMakeDefault} = renderPanel();

		fireEvent.click(
			screen.getByRole('button', {
				name: 'dialogs.passageEdit.beatProps.makeDefault'
			})
		);
		expect(onMakeDefault).not.toHaveBeenCalled();
		expect(
			screen.getByText('dialogs.passageEdit.beatProps.makeDefaultPrompt')
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'common.ok'}));
		expect(onMakeDefault).toHaveBeenCalledTimes(1);
	});

	it('greys the defaults button with nothing to hand up', () => {
		renderPanel({onMakeDefault: undefined});

		expect(
			screen.getByRole('button', {
				name: 'dialogs.passageEdit.beatProps.makeDefault'
			})
		).toBeDisabled();
	});

	it('has no text box and no defaults button on a beat without words', () => {
		renderPanel({beat: {index: 0, kind: 'wait', seconds: 1}});

		expect(screen.queryByTestId('beat-panel-text')).toBeNull();
		expect(
			screen.queryByRole('button', {
				name: 'dialogs.passageEdit.beatProps.makeDefault'
			})
		).toBeNull();
	});

	it('closes', () => {
		const {onClose} = renderPanel();

		fireEvent.click(screen.getByRole('button', {name: 'common.close'}));
		expect(onClose).toHaveBeenCalled();
	});
});
