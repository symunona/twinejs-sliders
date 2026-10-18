import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import type {Beat, BubbleStyle, SayBeat} from '@sliders/scene-types';
import {AUTO_ADVANCE_MS} from '../beat-hold';
import {
	BeatProps,
	anchorDisabledKey,
	sizeNoteKey,
	valignNoteKey
} from '../beat-props';
import type {SceneGlobals} from '../beat-props';

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
		stageIds?: string[];
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
			stageIds={options.stageIds}
		/>
	);

	return {container, onSetBubble, onSetKey};
}

function hold() {
	return screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
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
 * The type multiplier. Always offered: every sizing draws the words at it.
 *
 * Found by position for the reason every other control here is: i18n is not initialised
 * under jest. Hold is the first spinbutton in the row and Size is the second (Enter length the third).
 */
function sizeField(): HTMLInputElement {
	return screen.getAllByRole('spinbutton')[1] as HTMLInputElement;
}

describe('<BeatProps> bubble size', () => {
	/*
	 * Never taken away and never greyed: `auto` and `manual` draw the words at the
	 * multiplier, and `absolute` scales its fit window by it. A field that vanished when the
	 * sizing changed read as a bug.
	 */
	it('is offered while the bubble sizes itself', () => {
		renderProps(sayStyled({}));
		expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
		expect(sizeField()).toBeEnabled();
	});

	it('is offered on an absolute box, with a note on what it does there', () => {
		renderProps(sayStyled({sizing: 'absolute'}));
		expect(sizeField()).toBeEnabled();
		expect(screen.getByTestId('beat-prop-size')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.sizeAbsolute'
		);
	});

	it('is offered on a manual box', () => {
		renderProps(sayStyled({sizing: 'manual'}));
		expect(screen.getAllByRole('spinbutton')).toHaveLength(3);
		expect(screen.getByTestId('beat-prop-size')).not.toHaveTextContent(
			'dialogs.passageEdit.beatProps.sizeAbsolute'
		);
	});

	// A scene that says `sizing: absolute` once at the top draws every bubble that way.
	it('notes an absolute sizing inherited rather than stated', () => {
		renderProps(say(0.6), true, {inherited: {sizing: 'absolute'}});
		expect(screen.getByTestId('beat-prop-size')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.sizeAbsolute'
		);
	});

	it('is offered on a narration box', () => {
		renderProps({index: 0, kind: 'box', text: 'The candle gutters.'});
		expect(screen.getByTestId('beat-prop-size')).toBeInTheDocument();
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

describe('<BeatProps> rows', () => {
	it('says what each key falls back to', () => {
		renderProps(say(), true, {inherited: {as: 'comic', bg: '#112233'}});

		expect(screen.getByTestId('beat-prop-as')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.defaultIs comic'
		);
		expect(screen.getByTestId('beat-prop-bg')).toHaveTextContent('#112233');
		expect(screen.getByTestId('beat-prop-place')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.builtIn'
		);
	});

	it('highlights a key the beat sets to something other than its default', () => {
		renderProps(sayStyled({as: 'shout', place: 'top'}), true, {
			inherited: {as: 'comic', place: 'top'}
		});

		expect(screen.getByTestId('beat-prop-as')).toHaveClass('overridden');
		// Stated, but the same as the default: nothing to point out.
		expect(screen.getByTestId('beat-prop-place')).not.toHaveClass('overridden');
		expect(screen.getByTestId('beat-prop-font')).not.toHaveClass('overridden');
	});

	it('highlights a timed beat', () => {
		renderProps(say(2));
		expect(screen.getByTestId('beat-prop-dur')).toHaveClass('overridden');
	});

	it('resets a key to its default with the X', () => {
		const {onSetBubble, onSetKey} = renderProps(
			{...sayStyled({color: '#ff0000'}), dur: 2, ease: 'linear'} as Beat
		);

		fireEvent.click(
			within(screen.getByTestId('beat-prop-color')).getByRole('button', {
				name: 'dialogs.passageEdit.beatProps.reset'
			})
		);
		expect(onSetBubble).toHaveBeenCalledWith('color', null);

		fireEvent.click(
			within(screen.getByTestId('beat-prop-dur')).getByRole('button', {
				name: 'dialogs.passageEdit.beatProps.reset'
			})
		);
		expect(onSetKey).toHaveBeenCalledWith('dur', null);

		fireEvent.click(
			within(screen.getByTestId('beat-prop-ease')).getByRole('button', {
				name: 'dialogs.passageEdit.beatProps.reset'
			})
		);
		expect(onSetKey).toHaveBeenCalledWith('ease', null);
	});

	it('leaves the X dead on a key the beat does not state', () => {
		renderProps(say());

		expect(
			within(screen.getByTestId('beat-prop-as')).getByRole('button', {
				name: 'dialogs.passageEdit.beatProps.reset'
			})
		).toBeDisabled();
	});

	it('explains timing on the help mark', () => {
		renderProps(say());

		expect(screen.getByTestId('beat-props-timing-help')).toHaveAttribute(
			'title',
			'dialogs.passageEdit.beatProps.timingHelp'
		);
	});
});

/**
 * `anchor:` only chooses between hanging off the speaker and hanging off nothing. Where
 * there is no speaker point to hang off, the row stays but greys out, and says why.
 */
describe('<BeatProps> anchor', () => {
	function anchorSelect() {
		return within(screen.getByTestId('beat-prop-anchor')).getByRole(
			'combobox'
		) as HTMLSelectElement;
	}

	it('is live for a speaker on stage', () => {
		renderProps(say(), true, {stageIds: ['mira']});
		expect(anchorSelect()).toBeEnabled();
		expect(screen.getByTestId('beat-prop-anchor')).not.toHaveAttribute(
			'data-disabled'
		);
	});

	it('greys out for a speaker who is not on stage, and says why', () => {
		renderProps(say(), true, {stageIds: ['someone-else']});
		expect(anchorSelect()).toBeDisabled();
		expect(screen.getByTestId('beat-prop-anchor')).toHaveAttribute(
			'data-disabled',
			'true'
		);
		expect(screen.getByTestId('beat-prop-anchor')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.anchorOffStage'
		);
	});

	it('greys out on a narration box', () => {
		renderProps({index: 0, kind: 'box', text: 'The candle gutters.'}, true, {
			stageIds: ['mira']
		});
		expect(anchorSelect()).toBeDisabled();
		expect(screen.getByTestId('beat-prop-anchor')).toHaveTextContent(
			'dialogs.passageEdit.beatProps.anchorNarration'
		);
	});

	// A dead key the beat still states can be cleared out of the YAML.
	it('keeps the reset live while a dead anchor is stated', () => {
		const {onSetBubble} = renderProps(sayStyled({anchor: 'scene'}), true, {
			stageIds: []
		});
		const reset = within(screen.getByTestId('beat-prop-anchor')).getByRole(
			'button'
		);

		expect(reset).toBeEnabled();
		fireEvent.click(reset);
		expect(onSetBubble).toHaveBeenCalledWith('anchor', null);
	});
});

describe('anchorDisabledKey', () => {
	const mira: Beat = {index: 0, kind: 'say', text: 'hi', who: 'mira'};

	it('is undefined for a speaker on stage', () => {
		expect(anchorDisabledKey(mira, undefined, ['mira'])).toBeUndefined();
	});

	it('names an absent speaker', () => {
		expect(anchorDisabledKey(mira, undefined, [])).toBe(
			'dialogs.passageEdit.beatProps.anchorOffStage'
		);
	});

	// `tail:` stands in for the speaker's point, so `anchor: scene` still drops it.
	it('is undefined for an absent speaker whose tail aims somewhere', () => {
		expect(anchorDisabledKey(mira, {x: 0.2, y: 0.5}, [])).toBeUndefined();
	});

	it('names a narration box', () => {
		expect(
			anchorDisabledKey({index: 0, kind: 'box', text: 'x'}, undefined, ['mira'])
		).toBe('dialogs.passageEdit.beatProps.anchorNarration');
	});

	// No stage known: do not guess.
	it('is undefined when the stage is unknown', () => {
		expect(anchorDisabledKey(mira, undefined, undefined)).toBeUndefined();
	});
});

describe('sizeNoteKey', () => {
	it('notes absolute only', () => {
		expect(sizeNoteKey('absolute')).toBe(
			'dialogs.passageEdit.beatProps.sizeAbsolute'
		);
		expect(sizeNoteKey('manual')).toBeUndefined();
		expect(sizeNoteKey('auto')).toBeUndefined();
		expect(sizeNoteKey(undefined)).toBeUndefined();
	});
});

describe('<BeatProps> alignment', () => {
	const key = (name: string) => `dialogs.passageEdit.beatProps.${name}`;
	const button = (row: string, name: string) =>
		within(screen.getByTestId(row)).getByRole('button', {name: key(name)});

	it('offers three icon buttons per axis, none pressed by default', () => {
		renderProps(sayStyled({}));

		for (const name of ['alignLeft', 'alignCentre', 'alignRight']) {
			expect(button('beat-prop-align', name)).toHaveAttribute(
				'aria-pressed',
				'false'
			);
		}

		for (const name of ['valignTop', 'valignMiddle', 'valignBottom']) {
			expect(button('beat-prop-valign', name)).toHaveAttribute(
				'aria-pressed',
				'false'
			);
		}
	});

	it('presses the value the beat states', () => {
		renderProps(
			sayStyled({align: 'right', valign: 'middle', sizing: 'manual'})
		);

		expect(button('beat-prop-align', 'alignRight')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(button('beat-prop-valign', 'valignMiddle')).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(screen.getByTestId('beat-prop-align')).toHaveClass('overridden');
	});

	it('writes the pressed value', () => {
		const {onSetBubble} = renderProps(sayStyled({}));

		fireEvent.click(button('beat-prop-align', 'alignCentre'));
		expect(onSetBubble).toHaveBeenCalledWith('align', 'centre');

		fireEvent.click(button('beat-prop-valign', 'valignBottom'));
		expect(onSetBubble).toHaveBeenCalledWith('valign', 'bottom');
	});

	it('clears the key when the pressed button is pressed again', () => {
		const {onSetBubble} = renderProps(
			sayStyled({align: 'left', valign: 'top'})
		);

		fireEvent.click(button('beat-prop-align', 'alignLeft'));
		expect(onSetBubble).toHaveBeenCalledWith('align', null);

		fireEvent.click(button('beat-prop-valign', 'valignTop'));
		expect(onSetBubble).toHaveBeenCalledWith('valign', null);
	});

	it('notes valign has no room while the box follows the words', () => {
		renderProps(sayStyled({}));
		expect(screen.getByTestId('beat-prop-valign')).toHaveTextContent(
			key('valignAuto')
		);
	});

	it('drops the note once an inherited sizing fixes the box', () => {
		renderProps(say(), true, {inherited: {sizing: 'absolute'}});
		expect(screen.getByTestId('beat-prop-valign')).not.toHaveTextContent(
			key('valignAuto')
		);
	});

	it('is offered on a narration box', () => {
		renderProps({index: 0, kind: 'box', text: 'Later.'});
		expect(screen.getByTestId('beat-prop-align')).toBeInTheDocument();
		expect(screen.getByTestId('beat-prop-valign')).toBeInTheDocument();
	});
});

describe('valignNoteKey', () => {
	it('notes every sizing that follows the words', () => {
		expect(valignNoteKey(undefined)).toBe(
			'dialogs.passageEdit.beatProps.valignAuto'
		);
		expect(valignNoteKey('auto')).toBe(
			'dialogs.passageEdit.beatProps.valignAuto'
		);
		expect(valignNoteKey('absolute')).toBeUndefined();
		expect(valignNoteKey('manual')).toBeUndefined();
	});
});

describe('<BeatProps> enter animation', () => {
	const key = (name: string) => `dialogs.passageEdit.beatProps.${name}`;
	const enterSelect = () =>
		within(screen.getByTestId('beat-prop-enter')).getByRole(
			'combobox'
		) as HTMLSelectElement;
	const enterDurField = () =>
		within(screen.getByTestId('beat-prop-enterDur')).getByRole(
			'spinbutton'
		) as HTMLInputElement;

	it('defaults to fade', () => {
		renderProps(sayStyled({}));
		expect(enterSelect().value).toBe('');
		expect(screen.getByTestId('beat-prop-enter')).toHaveTextContent('fade');
		expect(enterDurField().placeholder).toBe('0.2');
	});

	it('writes the picked animation', () => {
		const {onSetBubble} = renderProps(sayStyled({}));

		fireEvent.change(enterSelect(), {target: {value: 'pop'}});
		expect(onSetBubble).toHaveBeenCalledWith('enter', 'pop');
	});

	it('writes the length on blur', () => {
		const {onSetBubble} = renderProps(sayStyled({enter: 'rise'}));

		fireEvent.change(enterDurField(), {target: {value: '0.4'}});
		fireEvent.blur(enterDurField());
		expect(onSetBubble).toHaveBeenCalledWith('enterDur', 0.4);
	});

	it('greys the length out when enter is none', () => {
		renderProps(sayStyled({enter: 'none'}));
		expect(enterDurField()).toBeDisabled();
		expect(screen.getByTestId('beat-prop-enterDur')).toHaveTextContent(
			key('enterNone')
		);
	});
});

describe('<BeatProps> scene scope (Step 0)', () => {
	function renderScene(globals: SceneGlobals, beatCount = 1) {
		const onSetBubble = jest.fn();
		const onSetKey = jest.fn();

		render(
			<BeatProps
				beatCount={beatCount}
				beatNumber={0}
				editable
				globals={globals}
				onSetBubble={onSetBubble}
				onSetKey={onSetKey}
				scope="scene"
			/>
		);

		return {onSetBubble, onSetKey};
	}

	it('offers the full bubble rows, alignment included, not the arrival note', () => {
		renderScene({});
		expect(screen.queryByTestId('scene-preview-beat-props-none')).toBeNull();

		for (const row of ['as', 'size', 'align', 'valign', 'anchor', 'enter']) {
			expect(screen.getByTestId(`beat-prop-${row}`)).toBeInTheDocument();
		}
	});

	it('is there even with no beats yet', () => {
		renderScene({}, 0);
		expect(screen.getByTestId('beat-prop-align')).toBeInTheDocument();
	});

	it('reads the scene bubble and highlights what it states', () => {
		renderScene({bubble: {align: 'right'}});
		expect(screen.getByTestId('beat-prop-align')).toHaveClass('overridden');
		expect(screen.getByTestId('beat-prop-valign')).not.toHaveClass(
			'overridden'
		);
	});

	it('has no Auto checkbox; the hold box is autoAdvance', () => {
		const {onSetKey} = renderScene({autoAdvance: 2});

		expect(screen.queryByTestId('beat-prop-auto')).toBeNull();

		const box = within(screen.getByTestId('beat-prop-dur')).getByRole(
			'spinbutton'
		) as HTMLInputElement;

		expect(box.value).toBe('2');
		expect(box).not.toBeDisabled();
		fireEvent.change(box, {target: {value: '3'}});
		fireEvent.blur(box);
		expect(onSetKey).toHaveBeenCalledWith('dur', 3);
	});

	it('never greys anchor out: no speaker to be off stage', () => {
		renderScene({});
		expect(screen.getByTestId('beat-prop-anchor')).not.toHaveAttribute(
			'data-disabled'
		);
	});
});
