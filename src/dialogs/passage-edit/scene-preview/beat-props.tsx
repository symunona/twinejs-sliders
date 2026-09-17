/**
 * The beat on screen, editable — timing and bubble style, without going to the YAML.
 *
 * The sibling of `StageSelectionControls`: that row is about whatever sprite is selected,
 * this one is about the MOMENT the scrubber is standing on, which has properties of its own
 * that belong to no entity. It sits at the bottom of the stage for the same reasons that row
 * sits at the top — an overlay comes and goes without moving the scene, and the two never
 * fight for the same strip of pixels.
 *
 * Only the keys a beat can actually carry are offered: `dur:` on anything with a body map,
 * and the bubble keys only where there is a line to paint. A `- wait:` / `- fx:` / `- mark:`
 * beat gets nothing, because the parser will not take a `dur:` there (they are scalars with
 * no body map, and `wait` already IS a duration) and there is no bubble to style.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {BUBBLE_PLACES, BUBBLE_PRESETS} from '@sliders/scene-types';
import type {Beat, BubbleStyle} from '@sliders/scene-types';
import {CheckboxButton} from '../../../components/control/checkbox-button';
import {AUTO_ADVANCE_MS} from './beat-hold';
import {TextInput} from '../../../components/control/text-input';
import {TextSelect} from '../../../components/control/text-select';
import './beat-props.css';

export interface BeatPropsProps {
	/** The beat that PRODUCED the state on screen, i.e. `beats[scrubber - 1]`. */
	beat?: Beat;
	/** False when there is no CodeMirror to write to. Renders nothing. */
	editable: boolean;
	/** A key on the beat's own body. `null` removes it. */
	onSetKey: (key: string, value: unknown) => void;
	/** One key of the beat's `bubble:` map. `null` removes it. */
	onSetBubble: (key: keyof BubbleStyle, value: unknown) => void;
}

/** The empty option: "whatever the character or the renderer already says". */
const INHERIT = '';

/** What unchecking Auto puts in the box, in seconds: the pace the reader would have had. */
const DEFAULT_HOLD = AUTO_ADVANCE_MS / 1000;

/** Beats with a body map, so somewhere to write a key. `box:` has a long form too. */
function hasBody(beat: Beat | undefined): boolean {
	return beat?.kind === 'say' || beat?.kind === 'set' || beat?.kind === 'box';
}

/** Beats with a line to paint, so bubble keys mean something. */
function speaks(beat: Beat | undefined): boolean {
	return beat?.kind === 'say' || beat?.kind === 'box';
}

function styleOf(beat: Beat | undefined): BubbleStyle | undefined {
	return beat?.kind === 'say' || beat?.kind === 'box' ? beat.style : undefined;
}

export const BeatProps: React.FC<BeatPropsProps> = ({
	beat,
	editable,
	onSetKey,
	onSetBubble
}) => {
	const {t} = useTranslation();
	/**
	 * What is in the box while it is being typed in.
	 *
	 * `dur` is committed on blur and on Enter rather than per keystroke: every write is a
	 * CodeMirror edit, and writing one per character would put "0", "0.", "0.8" in the undo
	 * stack and reparse the scene three times. `undefined` means "show what the text says".
	 */
	const [draft, setDraft] = React.useState<string>();

	// Whatever the author was typing is stale the moment the scrubber moves on.
	React.useEffect(() => setDraft(undefined), [beat]);

	if (!editable || !hasBody(beat)) {
		return null;
	}

	const style = styleOf(beat);
	const dur = draft ?? (beat?.dur === undefined ? '' : String(beat.dur));
	/**
	 * Auto-advance is exactly "this beat names no `dur`".
	 *
	 * No new YAML behind it: an absent `dur` is what already sends the player to the
	 * reader's own `sliders.autoAdvance`, and any `dur` at all overrides that. The checkbox
	 * only makes that state legible -- before it, "rides the reader's pace" and "I have not
	 * filled this in yet" were the same empty box.
	 *
	 * NOT a third state, and in particular NOT "wait for a click": `dur: 0` schedules a 0ms
	 * timer in the player (`waitForReader` in stage-element.ts), so it advances at once. The
	 * only wait-for-a-click there is the READER's setting, which an author does not own.
	 */
	const auto = beat?.dur === undefined;

	function commitDur() {
		setDraft(undefined);

		const trimmed = dur.trim();

		if (trimmed === '') {
			// Clearing the box means "untime this beat", which is a removal, not a zero.
			if (beat?.dur !== undefined) {
				onSetKey('dur', null);
			}

			return;
		}

		const next = Number(trimmed);

		// Refuse rather than write nonsense the parser would only reject back at them.
		if (!Number.isFinite(next) || next < 0 || next === beat?.dur) {
			return;
		}

		onSetKey('dur', next);
	}

	return (
		<div className="scene-preview-beat-props" data-testid="scene-preview-beat-props">
			{speaks(beat) && (
				// Only where there is a line to hold on. A stage-only `set` beat's `dur` is
				// how long its movement TAKES, not how long the reader looks at it, so
				// "advance automatically" is not a question that beat can answer.
				<CheckboxButton
					label={t('dialogs.passageEdit.beatProps.auto')}
					onChange={next =>
						// Unchecking has to leave a number behind, or the box the author just
						// enabled would be empty and mean the thing they turned off.
						onSetKey('dur', next ? null : Number(dur.trim()) || DEFAULT_HOLD)
					}
					value={auto}
				/>
			)}
			<span className="scene-preview-beat-props-dur">
				<TextInput
					disabled={speaks(beat) && auto}
					onChange={event => setDraft(event.target.value)}
					onBlur={commitDur}
					onKeyDown={event => {
						if (event.key === 'Enter') {
							commitDur();
						}

						if (event.key === 'Escape') {
							setDraft(undefined);
						}
					}}
					placeholder={t('dialogs.passageEdit.beatProps.durAuto')}
					type="number"
					value={dur}
				>
					{t('dialogs.passageEdit.beatProps.dur')}
				</TextInput>
			</span>
			{speaks(beat) && (
				<>
					<TextSelect
						onChange={event =>
							onSetBubble('as', event.target.value || null)
						}
						options={[
							{label: t('dialogs.passageEdit.beatProps.inherit'), value: INHERIT},
							...BUBBLE_PRESETS.map(preset => ({
								label: preset,
								value: preset
							}))
						]}
						value={style?.as ?? INHERIT}
					>
						{t('dialogs.passageEdit.beatProps.as')}
					</TextSelect>
					<TextSelect
						onChange={event =>
							onSetBubble('place', event.target.value || null)
						}
						options={[
							{label: t('dialogs.passageEdit.beatProps.inherit'), value: INHERIT},
							...BUBBLE_PLACES.map(place => ({label: place, value: place}))
						]}
						value={style?.place ?? INHERIT}
					>
						{t('dialogs.passageEdit.beatProps.place')}
					</TextSelect>
				</>
			)}
		</div>
	);
};
