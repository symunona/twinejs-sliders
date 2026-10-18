import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import type {Beat} from '@sliders/scene-types';
import {BeatPanel, BeatPanelProps, TEXT_WRITE_MS} from '../beat-panel';

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
		expect(
			screen.getByText('dialogs.passageEdit.beatProps.beat')
		).toBeInTheDocument();
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

	it('Step 0: says it edits the scene defaults, no text box', () => {
		renderPanel({
			beat: undefined,
			beatNumber: 0,
			globals: {bubble: {align: 'centre'}},
			scope: 'scene'
		});

		expect(screen.getByTestId('beat-panel')).toHaveAttribute(
			'data-scope',
			'scene'
		);
		expect(screen.getByTestId('beat-panel-scope')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.sceneScope'
		);
		expect(screen.queryByTestId('beat-panel-text')).toBeNull();
		expect(screen.getByTestId('beat-prop-align')).toHaveClass('overridden');
	});

	describe('typing', () => {
		beforeEach(() => jest.useFakeTimers());
		afterEach(() => jest.useRealTimers());

		it('writes live as the author types, throttled, marked live', () => {
			const {onSetText} = renderPanel();
			const text = screen.getByTestId('beat-panel-text');

			fireEvent.change(text, {target: {value: 'H'}});
			fireEvent.change(text, {target: {value: 'Hi'}});
			fireEvent.change(text, {target: {value: 'Hi!'}});
			expect(onSetText).not.toHaveBeenCalled();

			jest.advanceTimersByTime(TEXT_WRITE_MS);
			expect(onSetText).toHaveBeenCalledTimes(1);
			expect(onSetText).toHaveBeenCalledWith('Hi!', true);

			fireEvent.change(text, {target: {value: 'Hi!!'}});
			jest.advanceTimersByTime(TEXT_WRITE_MS);
			expect(onSetText).toHaveBeenCalledTimes(2);
			expect(onSetText).toHaveBeenLastCalledWith('Hi!!', true);
		});

		it('keeps the typed text while its own write is on the way back', () => {
			const {view} = renderPanel();
			const text = screen.getByTestId('beat-panel-text') as HTMLTextAreaElement;

			text.focus();
			fireEvent.change(text, {target: {value: 'Hello there'}});
			// The write lands with fewer characters than are now in the box.
			view.rerender(
				<BeatPanel
					beat={{...SAY, text: 'Hello th'}}
					beatCount={2}
					beatNumber={1}
					editable
					onClose={jest.fn()}
					onSetBubble={jest.fn()}
					onSetKey={jest.fn()}
					onSetText={jest.fn()}
				/>
			);
			expect(text.value).toBe('Hello there');
		});

		it('writes nothing on blur when nothing changed, at once when it did', () => {
			const {onSetText} = renderPanel();
			const text = screen.getByTestId('beat-panel-text');

			fireEvent.blur(text);
			expect(onSetText).not.toHaveBeenCalled();

			fireEvent.change(text, {target: {value: 'Goodbye.'}});
			fireEvent.blur(text);
			expect(onSetText).toHaveBeenCalledWith('Goodbye.', true);
		});

		it('writes on Enter, keeps Shift+Enter, reverts on Escape', () => {
			const {onSetText} = renderPanel();
			const text = screen.getByTestId('beat-panel-text') as HTMLTextAreaElement;

			fireEvent.focus(text);
			fireEvent.change(text, {target: {value: 'Two'}});
			fireEvent.keyDown(text, {key: 'Enter', shiftKey: true});
			expect(onSetText).not.toHaveBeenCalled();

			fireEvent.keyDown(text, {key: 'Enter'});
			expect(onSetText).toHaveBeenLastCalledWith('Two', true);

			fireEvent.keyDown(text, {key: 'Escape'});
			expect(text.value).toBe('Hello.');
			expect(onSetText).toHaveBeenLastCalledWith('Hello.', true);
		});

		it('toggles bold on Ctrl+B and italic on Ctrl+I around the selection', () => {
			const {onSetText} = renderPanel();
			const text = screen.getByTestId('beat-panel-text') as HTMLTextAreaElement;

			text.setSelectionRange(0, 5);
			fireEvent.keyDown(text, {ctrlKey: true, key: 'b'});
			expect(text.value).toBe('**Hello**.');
			expect([text.selectionStart, text.selectionEnd]).toEqual([2, 7]);

			fireEvent.keyDown(text, {ctrlKey: true, key: 'i'});
			expect(text.value).toBe('**_Hello_**.');

			jest.advanceTimersByTime(TEXT_WRITE_MS);
			expect(onSetText).toHaveBeenLastCalledWith('**_Hello_**.', true);
		});
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

	describe('assign to', () => {
		const speakers = [
			{id: 'mira', kind: 'cast' as const},
			{id: 'lamp', kind: 'prop' as const}
		];

		it('sits above the words, offers narrator + scene entities, writes the pick', () => {
			const onSetSpeaker = jest.fn();

			renderPanel({onSetSpeaker, speakers});

			const row = screen.getByTestId('beat-panel-speaker');

			expect(
				row.compareDocumentPosition(screen.getByTestId('beat-panel-text')) &
					Node.DOCUMENT_POSITION_FOLLOWING
			).toBeTruthy();
			expect(row).toHaveTextContent('mira');
			fireEvent.click(row.querySelector('button')!);

			const options = within(screen.getByRole('listbox')).getAllByRole(
				'option'
			);

			expect(options.map(option => option.textContent)).toEqual([
				expect.stringContaining('assignNarrator'),
				expect.stringContaining('mira'),
				expect.stringContaining('lamp')
			]);
			fireEvent.pointerDown(screen.getByRole('option', {name: /lamp/}));
			expect(onSetSpeaker).toHaveBeenCalledWith('lamp');
		});

		it('narration shows the narrator; a speaker off stage is still listed', () => {
			renderPanel({
				beat: {index: 0, kind: 'box', text: 'Night.'},
				onSetSpeaker: jest.fn(),
				speakers
			});
			expect(screen.getByTestId('beat-panel-speaker')).toHaveTextContent(
				'assignNarrator'
			);

			renderPanel({
				beat: {...SAY, who: 'ghost'},
				onSetSpeaker: jest.fn(),
				speakers
			});
			expect(screen.getAllByTestId('beat-panel-speaker')[1]).toHaveTextContent(
				'ghost'
			);
		});

		it('is not there for a beat with no line', () => {
			renderPanel({
				beat: {index: 0, kind: 'set', patch: {flip: true}, who: 'mira'},
				onSetSpeaker: jest.fn(),
				speakers
			});
			expect(screen.queryByTestId('beat-panel-speaker')).toBeNull();
		});
	});

	it('closes', () => {
		const {onClose} = renderPanel();

		fireEvent.click(screen.getByRole('button', {name: 'common.close'}));
		expect(onClose).toHaveBeenCalled();
	});
});
