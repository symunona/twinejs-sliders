import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import type {Beat, BubbleStyle, SayBeat} from '@sliders/scene-types';
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

/**
 * A speaking beat that carries a bubble style.
 *
 * Its own helper rather than spreading over `say()`: that returns the `Beat` UNION, and
 * spreading a `style` onto it asks TypeScript to put the key on `WaitBeat` too.
 */
function sayStyled(style: BubbleStyle): SayBeat {
	return {index: 0, kind: 'say', style, text: 'hi', who: 'mira'};
}

function renderProps(
	beat: Beat | undefined,
	editable = true,
	options: {
		beatCount?: number;
		beatNumber?: number;
		inherited?: BubbleStyle;
	} = {}
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
			inherited={options.inherited}
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


/*
 * Style and Font are `PreviewSelect`s, not native selects, so they are BUTTONS rather than
 * comboboxes -- the whole point of them is that an option can hold a drawing. They are
 * found by position within the row for the reason the ease select is: i18n is not
 * initialised under jest, so `t()` returns its own key and no control has a readable name.
 *
 * Order in the row: Auto (checkbox), Ease (combobox), Hold (spinbutton), then Style, Font,
 * Fill, Stroke, Place, Sizing, Anchor.
 */
function previewButtons(): HTMLButtonElement[] {
	// queryAll, not getAll: a stage-only beat offers none, and that is a thing to assert
	// rather than an error to throw.
	return screen
		.queryAllByRole('button')
		.filter(el => el.classList.contains('preview-select-button')) as
		HTMLButtonElement[];
}

const styleButton = () => previewButtons()[0];
const fontButton = () => previewButtons()[1];

/**
 * The options of the dropdown that is currently open.
 *
 * Scoped to the listbox, never `screen`: the row also holds four native selects, and a
 * native `<option>` carries role `option` too — an unscoped query returned all 38 of them
 * and `[0]` was the Ease select's inherit row.
 */
function openOptions(): HTMLElement[] {
	return within(screen.getByRole('listbox')).getAllByRole('option');
}

/** The two colour wells, in row order: fill then stroke. */
function colorWells(): HTMLInputElement[] {
	return screen
		.getAllByDisplayValue(/^#/)
		.filter(el => (el as HTMLInputElement).type === 'color') as
		HTMLInputElement[];
}

describe('<BeatProps> bubble style', () => {
	it('shows the token the beat names', () => {
		renderProps(sayStyled({as: 'shard'}));
		expect(styleButton()).toHaveTextContent('shard');
	});

	it('writes the picked token onto the beat', () => {
		const {onSetBubble} = renderProps(say(0.6));

		fireEvent.click(styleButton());
		fireEvent.pointerDown(
			within(screen.getByRole('listbox')).getByRole('option', {name: /comic/})
		);
		expect(onSetBubble).toHaveBeenCalledWith('as', 'comic');
	});

	// Clearing means "whatever the layer above says", which is a removal, not an empty
	// string -- the same rule Ease and Hold follow.
	it('removes the key when the inherit option is picked', () => {
		const {onSetBubble} = renderProps(sayStyled({as: 'shard'}));

		fireEvent.click(styleButton());
		fireEvent.pointerDown(openOptions()[0]);
		expect(onSetBubble).toHaveBeenCalledWith('as', null);
	});

	/*
	 * A dash cannot tell a story that sets `comic` from a story that sets nothing, and that
	 * is the one question a preview dropdown must not leave open.
	 */
	it('names what the inherit option would inherit', () => {
		renderProps(say(0.6), true, {inherited: {as: 'comic'}});
		fireEvent.click(styleButton());
		expect(openOptions()[0]).toHaveTextContent('comic');
	});

	it('offers no bubble keys on a stage-only beat', () => {
		renderProps({index: 0, kind: 'set', patch: {}, who: 'mira'});
		expect(previewButtons()).toHaveLength(0);
	});
});

describe('<BeatProps> bubble font', () => {
	it('shows the face the beat names', () => {
		renderProps(sayStyled({font: 'bangers'}));
		expect(fontButton()).toHaveTextContent('Bangers');
	});

	it('writes the picked catalogue token, not the family name', () => {
		const {onSetBubble} = renderProps(say(0.6));

		fireEvent.click(fontButton());
		fireEvent.pointerDown(
			within(screen.getByRole('listbox')).getByRole('option', {
				name: /Patrick Hand/
			})
		);
		expect(onSetBubble).toHaveBeenCalledWith('font', 'patrick-hand');
	});

	/*
	 * `font:` took a raw CSS stack long before the catalogue existed. A dropdown that could
	 * not show the value already in the passage would clear it the first time it was opened.
	 */
	it('keeps a hand-written stack as an option of its own', () => {
		renderProps(sayStyled({font: 'Georgia, serif'}));
		expect(fontButton()).toHaveTextContent('Georgia, serif');
	});
});

describe('<BeatProps> bubble colours', () => {
	// Row order: text, then fill, then stroke.
	it('offers a text, fill and stroke well on a beat that speaks', () => {
		renderProps(say(0.6));
		expect(colorWells()).toHaveLength(3);
	});

	it('writes the text colour the author picks', () => {
		const {onSetBubble} = renderProps(say(0.6));

		fireEvent.change(colorWells()[0], {target: {value: '#ffffff'}});
		expect(onSetBubble).toHaveBeenCalledWith('color', '#ffffff');
	});

	it('writes the fill the author picks', () => {
		const {onSetBubble} = renderProps(say(0.6));

		fireEvent.change(colorWells()[1], {target: {value: '#ff0000'}});
		expect(onSetBubble).toHaveBeenCalledWith('bg', '#ff0000');
	});

	it('writes the stroke the author picks', () => {
		const {onSetBubble} = renderProps(say(0.6));

		fireEvent.change(colorWells()[2], {target: {value: '#101010'}});
		expect(onSetBubble).toHaveBeenCalledWith('accent', '#101010');
	});

	/*
	 * A colour input has no "no colour" state, so without a clear button an author who set
	 * a bubble red could never get back to inheriting.
	 */
	it('removes the key when the colour is cleared', () => {
		const {onSetBubble} = renderProps(sayStyled({bg: '#ff0000'}));
		const clear = screen
			.getAllByRole('button')
			.filter(el => el.classList.contains('bubble-color-control-clear'));

		// [1] is Fill: text comes first in the row.
		fireEvent.click(clear[1]);
		expect(onSetBubble).toHaveBeenCalledWith('bg', null);
	});

	it('leaves the clear button dead while nothing is set', () => {
		renderProps(say(0.6));

		const clear = screen
			.getAllByRole('button')
			.filter(el => el.classList.contains('bubble-color-control-clear'));

		expect(clear[0]).toBeDisabled();
	});
});

/**
 * The type multiplier, offered only beside a `manual` box.
 *
 * Found by position for the reason every other control here is: i18n is not initialised
 * under jest. Hold is the first spinbutton in the row and Size, when it is there at all, is
 * the second.
 */
function sizeField(): HTMLInputElement {
	return screen.getAllByRole('spinbutton')[1] as HTMLInputElement;
}

describe('<BeatProps> bubble size', () => {
	/*
	 * `auto` grows the box to fit the words, so there is no rectangle to set type against,
	 * and `absolute` scales the words to fill the box itself -- a multiplier there is a
	 * number that changes nothing.
	 */
	it('is absent while the bubble sizes itself', () => {
		renderProps(sayStyled({}));
		expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
	});

	it('is absent on an absolute box, which sizes its own type', () => {
		renderProps(sayStyled({sizing: 'absolute'}));
		expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
	});

	it('is offered on a manual box', () => {
		renderProps(sayStyled({sizing: 'manual'}));
		expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
	});

	// A scene that says `sizing: manual` once at the top draws every bubble that way.
	it('is offered when the sizing is inherited rather than stated', () => {
		renderProps(say(0.6), true, {inherited: {sizing: 'manual'}});
		expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
	});

	it('shows the multiplier the beat names', () => {
		renderProps(sayStyled({size: 1.4, sizing: 'manual'}));
		expect(sizeField().value).toBe('1.4');
	});

	// Empty means "whatever the layer above says", so the box has to say what that is.
	it('names the size it would inherit when it is empty', () => {
		renderProps(sayStyled({sizing: 'manual'}), true, {
			inherited: {size: 0.8}
		});

		expect(sizeField().value).toBe('');
		expect(sizeField()).toHaveAttribute('placeholder', '0.8');
	});

	it('falls back to the plain stage size when nothing above it says one', () => {
		renderProps(sayStyled({sizing: 'manual'}));
		expect(sizeField()).toHaveAttribute('placeholder', '1');
	});

	/*
	 * The arrows are the point of the field: an author nudges the type up a tenth and
	 * watches the bubble. A value that only landed on blur would leave the stage a press
	 * behind the box.
	 */
	it('writes as the value changes, so the arrows reach the stage', () => {
		const {onSetBubble} = renderProps(sayStyled({size: 1, sizing: 'manual'}));

		fireEvent.change(sizeField(), {target: {value: '1.1'}});
		expect(onSetBubble).toHaveBeenCalledWith('size', 1.1);
	});

	it('steps by a tenth, the whole useful range being about half to double', () => {
		renderProps(sayStyled({sizing: 'manual'}));
		expect(sizeField()).toHaveAttribute('step', '0.1');
		expect(sizeField()).toHaveAttribute('min', '0.1');
	});

	// Passing through "" or "0." on the way to "0.8" is not a value to write down.
	it('writes nothing for a half-typed multiplier', () => {
		const {onSetBubble} = renderProps(sayStyled({sizing: 'manual'}));

		fireEvent.change(sizeField(), {target: {value: ''}});
		fireEvent.change(sizeField(), {target: {value: '0'}});
		expect(onSetBubble).not.toHaveBeenCalled();
	});

	// Clearing means "back to whatever the scene says", which is a removal.
	it('removes the key when the box is emptied and left', () => {
		const {onSetBubble} = renderProps(sayStyled({size: 1.4, sizing: 'manual'}));

		fireEvent.change(sizeField(), {target: {value: ''}});
		fireEvent.blur(sizeField());
		expect(onSetBubble).toHaveBeenCalledWith('size', null);
	});

	it('removes nothing when a box that was already empty is left', () => {
		const {onSetBubble} = renderProps(sayStyled({sizing: 'manual'}));

		fireEvent.blur(sizeField());
		expect(onSetBubble).not.toHaveBeenCalled();
	});
});
