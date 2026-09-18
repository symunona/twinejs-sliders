import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {Beat} from '@sliders/scene-types';
import {AUTO_ADVANCE_MS} from '../beat-hold';
import {BeatProps} from '../beat-props';

function say(dur?: number): Beat {
	return {
		index: 0,
		kind: 'say',
		text: 'hi',
		who: 'mira',
		...(dur === undefined ? {} : {dur})
	};
}

function renderProps(
	beat: Beat | undefined,
	editable = true,
	options: {beatCount?: number; beatNumber?: number} = {}
) {
	const onSetBubble = jest.fn();
	const onSetKey = jest.fn();

	const {container} = render(
		<BeatProps
			beat={beat}
			// The scrubber is on this beat, and it is the only one, unless a test says
			// otherwise — enough for the row to be offered at all.
			beatCount={options.beatCount ?? 1}
			beatNumber={options.beatNumber ?? 1}
			editable={editable}
			onSetBubble={onSetBubble}
			onSetKey={onSetKey}
		/>
	);

	return {container, onSetBubble, onSetKey};
}

function hold() {
	return screen.getByRole('spinbutton') as HTMLInputElement;
}

describe('<BeatProps> auto-advance', () => {
	// The checkbox is a reading of `dur`, not a fourth state stored beside it.
	it('is checked exactly when the beat names no duration', () => {
		renderProps(say());
		expect(screen.getByRole('checkbox')).toHaveAttribute(
			'aria-checked',
			'true'
		);
	});

	it('is unchecked once the beat is timed', () => {
		renderProps(say(0.8));
		expect(screen.getByRole('checkbox')).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	// Auto-advance IS the absence of `dur`, so turning it on is a removal.
	it('removes the duration when it is checked', () => {
		const {onSetKey} = renderProps(say(0.8));

		fireEvent.click(screen.getByRole('checkbox'));
		expect(onSetKey).toHaveBeenCalledWith('dur', null);
	});

	// Unchecking has to leave a number behind, or the box it just enabled would be empty --
	// which is the state the author was turning off.
	it('writes the reader default when it is unchecked with an empty box', () => {
		const {onSetKey} = renderProps(say());

		fireEvent.click(screen.getByRole('checkbox'));
		expect(onSetKey).toHaveBeenCalledWith('dur', AUTO_ADVANCE_MS / 1000);
	});

	it('keeps a number the author already typed when it is unchecked', () => {
		const {onSetKey} = renderProps(say());

		fireEvent.change(hold(), {target: {value: '1.5'}});
		fireEvent.click(screen.getByRole('checkbox'));
		expect(onSetKey).toHaveBeenCalledWith('dur', 1.5);
	});

	// The reader is setting the pace; a number in the box would contradict the checkbox.
	it('disables the hold field while it is on', () => {
		renderProps(say());
		expect(hold()).toBeDisabled();
	});

	/**
	 * The one genuinely disabled control in the row, and the reason it is disabled has to be
	 * readable from the field itself — a disabled input is inert to the pointer, so the
	 * explanation hangs on the wrapper around it.
	 */
	it('says on the field itself why the hold is disabled', () => {
		const {container} = renderProps(say());
		const wrapper = container.querySelector('.scene-preview-beat-props-dur');

		expect(wrapper).toHaveAttribute(
			'title',
			'dialogs.passageEdit.beatProps.durDisabled'
		);
	});

	it('enables the hold field once the beat is timed', () => {
		renderProps(say(2));
		expect(hold()).not.toBeDisabled();
		expect(
			document.querySelector('.scene-preview-beat-props-dur')
		).not.toHaveAttribute('title');
	});

	/**
	 * A stage-only beat's `dur` is how long its movement TAKES, not how long the reader
	 * looks at it, so "advance automatically" is not a question it can answer.
	 */
	it('is absent on a stage-only beat, which still keeps its duration', () => {
		renderProps({index: 0, kind: 'set', patch: {flip: true}, who: 'mira'});

		expect(screen.queryByRole('checkbox')).toBeNull();
		expect(hold()).not.toBeDisabled();
	});
});

/**
 * The row is a persistent menu above the stage, not a strip that comes and goes over it: it
 * may only disappear for a reason that belongs to the whole SCENE, never for where the
 * scrubber happens to be. Otherwise the controls move out from under the pointer as the
 * author scrubs, and the stage under them resizes on every step.
 */
describe('<BeatProps> persistence', () => {
	it('keeps its place on a beat with no body, and says why it is empty', () => {
		renderProps({index: 0, kind: 'wait', seconds: 2});

		expect(screen.getByTestId('scene-preview-beat-props')).toBeInTheDocument();
		expect(screen.queryByRole('spinbutton')).toBeNull();
		expect(screen.getByTestId('scene-preview-beat-props-none')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.noneWait'
		);
	});

	it('names a command beat with no timing of its own', () => {
		renderProps({index: 0, kind: 'fx', fx: {amount: 1, id: 'shake'}});

		expect(screen.getByTestId('scene-preview-beat-props-none')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.noneCommand'
		);
	});

	it('keeps its place at the arrival state, where there is no beat at all', () => {
		renderProps(undefined, true, {beatNumber: 0});

		expect(screen.getByTestId('scene-preview-beat-props')).toBeInTheDocument();
		expect(screen.getByTestId('scene-preview-beat-props-none')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.noneArrival'
		);
	});

	// The row is no longer drawn on the stage it edits, so it has to name the moment itself.
	it('names the beat it is editing', () => {
		const {container} = renderProps(say(), true, {beatCount: 5, beatNumber: 3});

		expect(
			container.querySelector('.scene-preview-beat-props-which')
		).toHaveTextContent('dialogs.passageEdit.beatProps.beat');
	});

	it('draws nothing in a passage whose scene has no beats', () => {
		renderProps(undefined, true, {beatCount: 0, beatNumber: 0});
		expect(screen.queryByTestId('scene-preview-beat-props')).toBeNull();
	});

	it('draws nothing when there is no editor to write through', () => {
		renderProps(say(), false);
		expect(screen.queryByTestId('scene-preview-beat-props')).toBeNull();
	});
});

/**
 * The curve, beside the Hold field.
 *
 * i18n is not initialised under jest, so `t()` is its own key and the selects cannot be
 * found by their visible label. They are found by position instead: Ease is the first,
 * Style and Place follow it and only on a beat that speaks.
 */
function easeSelect(): HTMLSelectElement {
	return screen.getAllByRole('combobox')[0] as HTMLSelectElement;
}

/** The row that stands in for an `ease:` written as a per-kind map. */
const PER_KIND = '\u0000per-kind';

describe('<BeatProps> ease', () => {
	it('shows the preset the beat names', () => {
		renderProps({...say(0.6), ease: 'back_out'});
		expect(easeSelect().value).toBe('back_out');
	});

	it('is the inherit row when the beat names none', () => {
		renderProps(say(0.6));
		expect(easeSelect().value).toBe('');
	});

	it('writes the picked name onto the beat', () => {
		const {onSetKey} = renderProps(say(0.6));

		fireEvent.change(easeSelect(), {target: {value: 'back_out'}});
		expect(onSetKey).toHaveBeenCalledWith('ease', 'back_out');
	});

	// Clearing means "no opinion", which is a removal -- the same rule Hold follows.
	it('removes the key when the inherit row is picked', () => {
		const {onSetKey} = renderProps({...say(0.6), ease: 'back_out'});

		fireEvent.change(easeSelect(), {target: {value: ''}});
		expect(onSetKey).toHaveBeenCalledWith('ease', null);
	});

	// A per-kind map is more than one dropdown can say, and saying nothing would tell the
	// author this beat has no curve when it has two.
	it('shows a per-kind map as its own row rather than as empty', () => {
		renderProps({...say(0.6), ease: {move: 'back_out', scale: 'linear'}});
		expect(easeSelect().value).toBe(PER_KIND);
	});

	it('writes nothing when the per-kind row is re-picked', () => {
		const {onSetKey} = renderProps({...say(0.6), ease: {move: 'back_out'}});

		fireEvent.change(easeSelect(), {target: {value: PER_KIND}});
		expect(onSetKey).not.toHaveBeenCalled();
	});

	// A `set` beat moves something, so it has a curve even though it has no bubble.
	it('is offered on a stage-only beat, which has no bubble keys', () => {
		renderProps({index: 0, kind: 'set', patch: {}, who: 'mira'});

		expect(screen.getAllByRole('combobox')).toHaveLength(1);
		expect(easeSelect().value).toBe('');
	});
});
