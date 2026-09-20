/**
 * The beat on screen, editable — timing and bubble style, without going to the YAML.
 *
 * The sibling of `StageSelectionControls`, but deliberately NOT built like it. That row is
 * about whatever sprite is selected, so it floats over the stage and comes and goes with the
 * selection. This one is about the MOMENT the scrubber stands on, and the scrubber always
 * stands somewhere — so it is a persistent row in the flow, directly under the timeline that
 * chooses the beat, rather than an overlay at the far end of the stage.
 *
 * Two things that cost the author, both fixed by being here rather than there. Over the
 * stage, the row was painted on `--white-translucent` above black art, with selects whose
 * own fill and border are translucent too: mid-grey label text on a mid-grey band, no
 * visible control edge, sitting next to a Hold field that genuinely IS disabled. The whole
 * strip read as greyed out even though the dropdowns worked. And it vanished on any beat
 * with no body map, so the controls moved out from under the pointer as the author scrubbed.
 *
 * So it now keeps its place for the whole scene and says why it has nothing to offer when it
 * has nothing to offer. Only the keys a beat can actually carry are ever offered: `dur:` on
 * anything with a body map, and the bubble keys only where there is a line to paint. A
 * `- wait:` / `- fx:` / `- mark:` beat gets a note instead, because the parser will not take
 * a `dur:` there (they are scalars with no body map, and `wait` already IS a duration).
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	BUBBLE_ANCHORS,
	BUBBLE_PLACES,
	BUBBLE_SIZINGS,
	EASE_NAMES,
	bubbleFontStack
} from '@sliders/scene-types';
import type {Beat, BubbleStyle} from '@sliders/scene-types';
import {CheckboxButton} from '../../../components/control/checkbox-button';
import {AUTO_ADVANCE_MS} from './beat-hold';
import {TextInput} from '../../../components/control/text-input';
import {TextSelect} from '../../../components/control/text-select';
import {PreviewSelect} from '../../../components/control/preview-select';
import {BubbleColorControl} from '../../bubble-style/bubble-color-control';
import {
	BubbleFontSwatch,
	BubbleStyleSwatch,
	bubbleFontOptions,
	bubbleStyleOptions
} from '../../bubble-style/bubble-previews';
import './beat-props.css';

export interface BeatPropsProps {
	/** The beat that PRODUCED the state on screen, i.e. `beats[scrubber - 1]`. */
	beat?: Beat;
	/**
	 * How many beats the scene has. Zero renders nothing.
	 *
	 * The one condition that may take the row away, and it is a property of the SCENE, not
	 * of where the scrubber happens to be — so scrubbing can never move the controls.
	 */
	beatCount: number;
	/** Where the scrubber is: 0 is the arrival state, before any beat has run. */
	beatNumber: number;
	/** False when there is no CodeMirror to write to. Renders nothing. */
	editable: boolean;
	/** A key on the beat's own body. `null` removes it. */
	onSetKey: (key: string, value: unknown) => void;
	/** One key of the beat's `bubble:` map. `null` removes it. */
	onSetBubble: (key: keyof BubbleStyle, value: unknown) => void;
	/**
	 * What this beat's bubble looks like before it states anything: the story's
	 * `sliders.bubble.*` defaults with the scene's own `bubble:` over them.
	 *
	 * Only so the inherit option can SHOW what inheriting means. An author looking at a
	 * dash in the Style box cannot tell a story that sets `comic` from a story that sets
	 * nothing, and that is the one question a preview dropdown should never leave open.
	 *
	 * Two of the four layers, not four. The speaking character's own `bubble:` sits between
	 * the scene and the beat, and it is not here: the renderer reads it off the stage, and
	 * for a speaker who is not on stage it arrives a tick later from the asset store
	 * (`scene-stage.tsx`). A preview that flickered a beat behind the author's scrubbing
	 * would be worse than one that is honestly about the scene.
	 */
	inherited?: BubbleStyle;
	/**
	 * The pace this beat runs at when it carries no `dur:`, in ms — the scene's own
	 * `autoAdvance:` if it has one, and the standard beat otherwise.
	 *
	 * Only unchecking Auto reads it. The number it writes has to be the timing the beat
	 * ALREADY had, or a checkbox that claims to be turning automatic advance off would
	 * quietly re-time the line as well.
	 */
	autoAdvanceMs?: number;
}

/** The empty option: "whatever the character or the renderer already says". */
const INHERIT = '';

/**
 * Stands in for an `ease:` written as a per-kind map, which one dropdown cannot say.
 *
 * Shown rather than hidden: an author parked on a beat whose movement is eased in two
 * different ways must not be told the beat has no curve. Picking it writes nothing; picking
 * a real name replaces the map, which is a deliberate choice made out loud.
 */
const PER_KIND = '\u0000per-kind';

/** What unchecking Auto puts in the box, in seconds: the pace the beat already ran at. */
function defaultHold(autoAdvanceMs: number | undefined): number {
	return (autoAdvanceMs ?? AUTO_ADVANCE_MS) / 1000;
}

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

/**
 * Why this beat offers nothing, as a locale key — or `undefined` when it offers something.
 *
 * `wait` gets its own sentence rather than the generic one: an author parked there is
 * looking for exactly the field this row is refusing to show them, and "already a duration"
 * is the answer, not "no properties".
 */
function emptyReasonKey(
	beat: Beat | undefined,
	beatNumber: number
): string | undefined {
	if (hasBody(beat)) {
		return undefined;
	}

	if (beatNumber === 0) {
		return 'dialogs.passageEdit.beatProps.noneArrival';
	}

	return beat?.kind === 'wait'
		? 'dialogs.passageEdit.beatProps.noneWait'
		: 'dialogs.passageEdit.beatProps.noneCommand';
}

export const BeatProps: React.FC<BeatPropsProps> = ({
	autoAdvanceMs,
	beat,
	beatCount,
	beatNumber,
	editable,
	inherited,
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

	if (!editable || beatCount === 0) {
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
	const ease =
		typeof beat?.ease === 'string'
			? beat.ease
			: beat?.ease
			? PER_KIND
			: INHERIT;
	/**
	 * What this beat is actually drawn in: the inherited look with the beat's own keys over
	 * it, merged the way `mergeBubbleStyle` merges them — key by key, narrower winning.
	 *
	 * Spread rather than a call to the renderer's own merge, because both sides here are
	 * plain optional objects and importing a renderer helper to spread two of them would be
	 * the more confusing of the two. The RULE it has to match — narrower wins per key, not
	 * whole-object — is the same one.
	 */
	const merged = {...inherited, ...style};
	const emptyKey = emptyReasonKey(beat, beatNumber);
	// The one genuinely disabled control here. Its reason lives on the field itself as well
	// as on the checkbox that causes it: an author who notices the grey box looks at the
	// grey box, not at the control two places to its left.
	const holdDisabled = speaks(beat) && auto;

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
			{/* The row no longer sits on the thing it edits, so it has to name it. */}
			<span className="scene-preview-beat-props-which">
				{beatNumber === 0
					? t('dialogs.passageEdit.beatProps.arrival')
					: t('dialogs.passageEdit.beatProps.beat', {number: beatNumber})}
			</span>
			{emptyKey ? (
				<span
					className="scene-preview-beat-props-none"
					data-testid="scene-preview-beat-props-none"
				>
					{t(emptyKey)}
				</span>
			) : (
				<>
					{speaks(beat) && (
						// Only where there is a line to hold on. A stage-only `set` beat's
						// `dur` is how long its movement TAKES, not how long the reader
						// looks at it, so "advance automatically" is not a question that
						// beat can answer.
						<CheckboxButton
							label={t('dialogs.passageEdit.beatProps.auto')}
							// The short word is all the row has room for -- the sentence
							// pushed Style and Place onto a second line on a docked stage.
							tooltipLabel={t('dialogs.passageEdit.beatProps.autoDetail')}
							onChange={next =>
								// Unchecking has to leave a number behind, or the box the
								// author just enabled would be empty and mean the thing
								// they turned off.
								onSetKey(
									'dur',
									next ? null : Number(dur.trim()) || defaultHold(autoAdvanceMs)
								)
							}
							value={auto}
						/>
					)}
					<TextSelect
						onChange={event => {
							// The map form is a readout, not a value to write back.
							if (event.target.value === PER_KIND) {
								return;
							}

							onSetKey('ease', event.target.value || null);
						}}
						options={[
							{
								label: t('dialogs.passageEdit.beatProps.inherit'),
								value: INHERIT
							},
							...(ease === PER_KIND
								? [
										{
											label: t('dialogs.passageEdit.beatProps.easePerKind'),
											value: PER_KIND
										}
								  ]
								: []),
							...EASE_NAMES.map(name => ({label: name, value: name}))
						]}
						value={ease}
					>
						{t('dialogs.passageEdit.beatProps.ease')}
					</TextSelect>
					<span
						className="scene-preview-beat-props-dur"
						// On the wrapper, not the input: a disabled input is inert to the
						// pointer, so a title on it never opens.
						title={
							holdDisabled
								? t('dialogs.passageEdit.beatProps.durDisabled')
								: undefined
						}
					>
						<TextInput
							disabled={holdDisabled}
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
							type="number"
							value={dur}
						>
							{t('dialogs.passageEdit.beatProps.dur')}
						</TextInput>
					</span>
					{speaks(beat) && (
						<>
							{/*
								A PreviewSelect, not a TextSelect: `as:` names a PICTURE, and
								seven lowercase words is a list an author has to try rather
								than read. Shapes lead the list — see `bubbleStyleOptions`.

								Its colours are the ones this beat will actually be drawn in,
								merged the same way the renderer merges them, so the shapes
								are previewed against the fill and stroke in force here and
								not against the factory white.
							*/}
							<PreviewSelect
								onChange={value => onSetBubble('as', value || null)}
								options={bubbleStyleOptions({
									colors: {
										accent: merged.accent,
										bg: merged.bg,
										color: merged.color,
										font: merged.font
									},
									emptyDetail: inherited?.as,
									emptyLabel: t('dialogs.passageEdit.beatProps.inherit'),
									// What the dash actually means here, drawn.
									emptyPreview: (
										// The colour keys only. `inherited` is a whole
										// BubbleStyle and spreading it would hand the swatch
										// an `at:` and a `w:` it has no box to apply them to.
										<BubbleStyleSwatch
											accent={inherited?.accent}
											bg={inherited?.bg}
											color={inherited?.color}
											font={inherited?.font}
											token={inherited?.as ?? ''}
										/>
									)
								})}
								value={style?.as ?? INHERIT}
							>
								{t('dialogs.passageEdit.beatProps.as')}
							</PreviewSelect>
							<PreviewSelect
								onChange={value => onSetBubble('font', value || null)}
								options={bubbleFontOptions({
									current: style?.font,
									customLabel: t('dialogs.passageEdit.beatProps.fontCustom'),
									emptyLabel: t('dialogs.passageEdit.beatProps.inherit'),
									emptyPreview: (
										<BubbleFontSwatch
											label={t('dialogs.passageEdit.beatProps.fontSample')}
											stack={bubbleFontStack(inherited?.font)}
										/>
									)
								})}
								searchable
								value={style?.font ?? INHERIT}
							>
								{t('dialogs.passageEdit.beatProps.font')}
							</PreviewSelect>
							{/*
								No text field on these two, unlike the Defaults dialog: the
								beat row is already the widest thing in the panel, and a
								hand-written `rgba(…)` is a story-wide decision far more often
								than a one-line one. An author who needs one on a single beat
								writes it in the YAML, where every other exotic value lives.
							*/}
							<BubbleColorControl
								clearLabel={t('dialogs.passageEdit.beatProps.clearColor')}
								onChange={value => onSetBubble('bg', value ?? null)}
								value={style?.bg}
							>
								{t('dialogs.passageEdit.beatProps.bg')}
							</BubbleColorControl>
							<BubbleColorControl
								clearLabel={t('dialogs.passageEdit.beatProps.clearColor')}
								onChange={value => onSetBubble('accent', value ?? null)}
								value={style?.accent}
							>
								{t('dialogs.passageEdit.beatProps.accent')}
							</BubbleColorControl>
							<TextSelect
								onChange={event =>
									onSetBubble('place', event.target.value || null)
								}
								options={[
									{
										label: t('dialogs.passageEdit.beatProps.inherit'),
										value: INHERIT
									},
									...BUBBLE_PLACES.map(place => ({label: place, value: place}))
								]}
								value={style?.place ?? INHERIT}
							>
								{t('dialogs.passageEdit.beatProps.place')}
							</TextSelect>
							<TextSelect
								onChange={event =>
									onSetBubble('sizing', event.target.value || null)
								}
								options={[
									{
										label: t('dialogs.passageEdit.beatProps.inherit'),
										value: INHERIT
									},
									...BUBBLE_SIZINGS.map(sizing => ({
										label: sizing,
										value: sizing
									}))
								]}
								value={style?.sizing ?? INHERIT}
							>
								{t('dialogs.passageEdit.beatProps.sizing')}
							</TextSelect>
							<TextSelect
								onChange={event =>
									onSetBubble('anchor', event.target.value || null)
								}
								options={[
									{
										label: t('dialogs.passageEdit.beatProps.inherit'),
										value: INHERIT
									},
									...BUBBLE_ANCHORS.map(anchor => ({
										label: anchor,
										value: anchor
									}))
								]}
								value={style?.anchor ?? INHERIT}
							>
								{t('dialogs.passageEdit.beatProps.anchor')}
							</TextSelect>
						</>
					)}
				</>
			)}
		</div>
	);
};
