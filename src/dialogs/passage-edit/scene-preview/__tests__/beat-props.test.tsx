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

function renderProps(beat: Beat | undefined, editable = true) {
	const onSetBubble = jest.fn();
	const onSetKey = jest.fn();

	const {container} = render(
		<BeatProps
			beat={beat}
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

	it('enables the hold field once the beat is timed', () => {
		renderProps(say(2));
		expect(hold()).not.toBeDisabled();
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

	it('draws nothing at all for a beat with no body to write into', () => {
		renderProps({index: 0, kind: 'wait', seconds: 2});
		expect(screen.queryByTestId('scene-preview-beat-props')).toBeNull();
	});

	it('draws nothing when there is no editor to write through', () => {
		renderProps(say(), false);
		expect(screen.queryByTestId('scene-preview-beat-props')).toBeNull();
	});
});
