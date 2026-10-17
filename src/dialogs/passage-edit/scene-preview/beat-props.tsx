/**
 * The beat on screen, editable — timing and bubble style, without going to the YAML.
 *
 * Lives in the beat panel beside the stage (`beat-panel.tsx`). One grid, three columns:
 * label, control, reset. Every row says what it falls back to underneath ("Default: …") and
 * is highlighted when the beat states something else, so an author can tell at a glance
 * which keys this one line overrides. The X removes the beat's own key, i.e. back to default.
 *
 * Only the keys a beat can actually carry are offered: `dur:` on anything with a body map,
 * and the bubble keys only where there is a line to paint. A `- wait:` / `- fx:` /
 * `- mark:` beat gets a note instead, because the parser will not take a `dur:` there
 * (they are scalars with no body map, and `wait` already IS a duration).
 */

import {
	IconAlignCenter,
	IconAlignLeft,
	IconAlignRight,
	IconHelp,
	IconLayoutAlignBottom,
	IconLayoutAlignMiddle,
	IconLayoutAlignTop,
	IconX
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	BUBBLE_ANCHORS,
	BUBBLE_PLACES,
	EASE_NAMES,
	bubbleFontStack
} from '@sliders/scene-types';
import type {Beat, BubbleStyle} from '@sliders/scene-types';
import {CheckboxButton} from '../../../components/control/checkbox-button';
import {IconButton} from '../../../components/control/icon-button';
import {AUTO_ADVANCE_MS} from './beat-hold';
import {TextInput} from '../../../components/control/text-input';
import {TextSelect} from '../../../components/control/text-select';
import {PreviewSelect} from '../../../components/control/preview-select';
import {BubbleColorControl} from '../../bubble-style/bubble-color-control';
import {bubbleSizingOptions} from '../../bubble-style/bubble-sizing';
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
	/** Colours the story already uses, offered beside each colour well. */
	storyColors?: string[];
	/**
	 * Ids on stage in the state this beat is drawn in. Only the Anchor row reads it: a
	 * speaker who is not here has nothing for the bubble to hang off. Absent = unknown,
	 * which leaves the row enabled rather than guessing.
	 */
	stageIds?: readonly string[];
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

/** The `align:` buttons, in the order they sit: icon, value, locale key. */
const ALIGN_BUTTONS = [
	{icon: <IconAlignLeft />, value: 'left', key: 'alignLeft'},
	{icon: <IconAlignCenter />, value: 'centre', key: 'alignCentre'},
	{icon: <IconAlignRight />, value: 'right', key: 'alignRight'}
] as const;

/** The `valign:` buttons. */
const VALIGN_BUTTONS = [
	{icon: <IconLayoutAlignTop />, value: 'top', key: 'valignTop'},
	{icon: <IconLayoutAlignMiddle />, value: 'middle', key: 'valignMiddle'},
	{icon: <IconLayoutAlignBottom />, value: 'bottom', key: 'valignBottom'}
] as const;

/**
 * Why `valign:` has nothing to move on this beat, as a locale key — or `undefined` when it
 * does. A note, never a disable: setting it first and sizing second is a fine order.
 */
export function valignNoteKey(
	sizing: BubbleStyle['sizing']
): string | undefined {
	return sizing === 'absolute' || sizing === 'manual'
		? undefined
		: 'dialogs.passageEdit.beatProps.valignAuto';
}

interface IconChoiceProps {
	buttons: ReadonlyArray<{icon: React.ReactNode; value: string; key: string}>;
	label: string;
	/** Button label by locale suffix. */
	labelOf: (key: string) => string;
	/** `null` = pressed the one already on: back to default. */
	onChange: (value: string | null) => void;
	/** The beat's own value. */
	value?: string;
	/** What the layers above say, drawn as a faint press so default is not a blank. */
	inherited?: string;
}

/** A segmented row of icon-only toggles. Pressing the lit one clears it. */
const IconChoice: React.FC<IconChoiceProps> = ({
	buttons,
	inherited,
	label,
	labelOf,
	onChange,
	value
}) => (
	<span aria-label={label} className="beat-prop-icon-choice" role="group">
		{buttons.map(button => (
			<span
				className={classNames('beat-prop-icon-choice-item', {
					inherited: value === undefined && inherited === button.value
				})}
				key={button.value}
			>
				<IconButton
					icon={button.icon}
					iconOnly
					label={labelOf(button.key)}
					onClick={() => onChange(value === button.value ? null : button.value)}
					selectable
					selected={value === button.value}
				/>
			</span>
		))}
	</span>
);

/**
 * What one press of the Size field's arrows is worth.
 *
 * A tenth: `size` is a multiplier of the stage's own type size, so the whole useful range
 * is roughly half to double and a step of 1 would cross it in one press.
 */
const SIZE_STEP = 0.1;

/** The smallest multiplier the field offers. The parser refuses zero and below outright. */
const SIZE_MIN = 0.1;

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

/**
 * Why `anchor:` cannot change anything on this beat, as a locale key — or `undefined` when
 * it can.
 *
 * Matches `positionBubble`/`positionBox` in render-dom's `dialogue.ts`. A narration box
 * never reads `anchor:`. A bubble's anchor is the speaker's `bubble` point or the beat's
 * own `tail:`; with neither (speaker not on stage, or no such id) it is already a
 * free-standing bubble, so `speaker` and `scene` have nothing between them to choose.
 */
export function anchorDisabledKey(
	beat: Beat | undefined,
	tail: BubbleStyle['tail'],
	stageIds: readonly string[] | undefined
): string | undefined {
	if (beat?.kind === 'box') {
		return 'dialogs.passageEdit.beatProps.anchorNarration';
	}

	if (beat?.kind !== 'say' || tail || !stageIds) {
		return undefined;
	}

	return stageIds.includes(beat.who)
		? undefined
		: 'dialogs.passageEdit.beatProps.anchorOffStage';
}

/**
 * What `size:` does on this beat that the row has to say out loud, as a locale key — or
 * `undefined` when it is just a multiplier.
 *
 * Never a reason to grey the field out: `auto` and `manual` draw the words at
 * `--sliders-bubble-size`, and `absolute`'s `fitText` scales its whole search window by it,
 * so it sets how big a short line may grow (and how small a long one may shrink). That last
 * one is not what an author expects of "fits the text", so it gets a note.
 */
export function sizeNoteKey(sizing: BubbleStyle['sizing']): string | undefined {
	return sizing === 'absolute'
		? 'dialogs.passageEdit.beatProps.sizeAbsolute'
		: undefined;
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

interface PropRowProps {
	children: React.ReactNode;
	label: React.ReactNode;
	/** What the row falls back to with nothing stated. Absent hides the line. */
	fallback?: React.ReactNode;
	/** The beat states a value that is not the fallback: highlight the row. */
	overridden?: boolean;
	/** Removes the beat's own key. Absent: no reset. Disabled while nothing is stated. */
	onReset?: () => void;
	stated?: boolean;
	resetLabel: string;
	testId?: string;
	/**
	 * Set when the control cannot change anything on this beat: the row greys out and says
	 * why in place of its fallback. The reset stays live while a key is stated, so a dead
	 * key can still be cleared out of the YAML.
	 */
	disabledReason?: string;
	/** A line under the fallback, for a control whose effect needs explaining here. */
	note?: string;
}

/** One line of the grid: label, control, reset; the fallback under the control. */
const PropRow: React.FC<PropRowProps> = ({
	children,
	disabledReason,
	fallback,
	label,
	note,
	onReset,
	overridden,
	resetLabel,
	stated,
	testId
}) => (
	<div
		className={classNames('beat-prop-row', {
			disabled: !!disabledReason,
			overridden
		})}
		data-disabled={disabledReason ? 'true' : undefined}
		data-overridden={overridden ? 'true' : undefined}
		data-testid={testId}
	>
		<span aria-hidden className="beat-prop-label">
			{label}
		</span>
		<div className="beat-prop-control">{children}</div>
		{onReset ? (
			<button
				aria-label={resetLabel}
				className="beat-prop-reset"
				disabled={!stated}
				onClick={onReset}
				title={resetLabel}
				type="button"
			>
				<IconX />
			</button>
		) : (
			<span />
		)}
		{disabledReason ? (
			<span className="beat-prop-default beat-prop-why">{disabledReason}</span>
		) : (
			fallback !== undefined && (
				<span className="beat-prop-default">{fallback}</span>
			)
		)}
		{note && !disabledReason && (
			<span className="beat-prop-default beat-prop-why">{note}</span>
		)}
	</div>
);

/** A colour as a little chip and its spelling, for a fallback line. */
const ColorChip: React.FC<{value: string}> = ({value}) => (
	<>
		<span
			aria-hidden
			className="beat-prop-chip"
			style={{['--swatch' as string]: value}}
		/>
		{value}
	</>
);

export const BeatProps: React.FC<BeatPropsProps> = ({
	autoAdvanceMs,
	beat,
	beatCount,
	beatNumber,
	editable,
	inherited,
	onSetKey,
	onSetBubble,
	stageIds,
	storyColors
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
	/**
	 * The Size box while it is being typed in, kept apart from `draft` so a half-typed
	 * multiplier and a half-typed hold cannot overwrite each other.
	 *
	 * Unlike `dur`, this one commits as it changes rather than on blur: the arrows are the
	 * point of the field — an author nudges the type up a tenth and watches the bubble on
	 * the stage — and a value that only landed on blur would leave the preview a press
	 * behind the box. The draft is only here so a box being emptied, or holding something
	 * that is not yet a number, shows what was typed instead of snapping back.
	 */
	const [sizeDraft, setSizeDraft] = React.useState<string>();

	// Whatever the author was typing is stale the moment the scrubber moves on.
	React.useEffect(() => {
		setDraft(undefined);
		setSizeDraft(undefined);
	}, [beat]);

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
	/**
	 * Anchor greys out where it cannot change anything; Size never does, it only explains
	 * itself under `absolute`. Neither row is ever taken away: a control that vanishes when
	 * another one changes reads as a bug. Both read the MERGED style — a scene that says
	 * `sizing: absolute` or `tail:` once at the top draws every bubble that way.
	 */
	const sizeNote = sizeNoteKey(merged.sizing);
	const valignNote = valignNoteKey(merged.sizing);
	const anchorOff = anchorDisabledKey(beat, merged.tail, stageIds);
	const size =
		sizeDraft ?? (style?.size === undefined ? '' : String(style.size));
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

	/**
	 * Take what is in the Size box, if it is a size.
	 *
	 * Silent about anything else: the box is typed in a character at a time, and "" or "0."
	 * on the way to "0.8" is a state the author is passing through, not one to write down
	 * or complain about. Emptying it on purpose is caught by `clearSize` on blur instead,
	 * where it can be told apart from an empty box halfway to a number.
	 */
	function commitSize(text: string) {
		setSizeDraft(text);

		const next = Number(text.trim());

		if (
			text.trim() === '' ||
			!Number.isFinite(next) ||
			next <= 0 ||
			next === style?.size
		) {
			return;
		}

		onSetBubble('size', next);
	}

	/** An emptied box means "back to whatever the scene says", which is a removal. */
	function clearSize() {
		if (sizeDraft?.trim() === '' && style?.size !== undefined) {
			onSetBubble('size', null);
		}

		setSizeDraft(undefined);
	}

	const label = (key: string) => t(`dialogs.passageEdit.beatProps.${key}`);
	const resetLabel = (key: string) =>
		t('dialogs.passageEdit.beatProps.reset', {name: label(key)});
	/** "Default: …", the built-in word when no layer above the beat says anything. */
	const fallback = (value: React.ReactNode) => (
		<>
			{t('dialogs.passageEdit.beatProps.defaultIs')}{' '}
			{value === undefined || value === null || value === ''
				? t('dialogs.passageEdit.beatProps.builtIn')
				: value}
		</>
	);
	/** The props every bubble row shares: stated, overridden, reset, fallback. */
	const bubbleRow = (key: keyof BubbleStyle, shown?: React.ReactNode) => {
		const own = style?.[key];
		const above = inherited?.[key];

		return {
			fallback: fallback(
				shown ?? (above === undefined ? undefined : String(above))
			),
			label: label(key),
			onReset: () => onSetBubble(key, null),
			overridden: own !== undefined && own !== above,
			resetLabel: resetLabel(key),
			stated: own !== undefined
		};
	};
	const colorRow = (key: 'color' | 'bg' | 'accent') =>
		bubbleRow(
			key,
			inherited?.[key] ? <ColorChip value={inherited[key] as string} /> : undefined
		);

	return (
		<div className="scene-preview-beat-props" data-testid="scene-preview-beat-props">
			{emptyKey ? (
				<span
					className="scene-preview-beat-props-none"
					data-testid="scene-preview-beat-props-none"
				>
					{t(emptyKey)}
				</span>
			) : (
				<>
					<div className="scene-preview-beat-props-group">
						<h4 className="scene-preview-beat-props-heading">
							{label('timing')}
							<span
								aria-label={t('dialogs.passageEdit.beatProps.timingHelp')}
								className="beat-prop-help"
								data-testid="beat-props-timing-help"
								role="img"
								tabIndex={0}
								title={t('dialogs.passageEdit.beatProps.timingHelp')}
							>
								<IconHelp />
							</span>
						</h4>
						{speaks(beat) && (
							// Only where there is a line to hold on. A stage-only `set` beat's
							// `dur` is how long its movement TAKES, not how long the reader
							// looks at it, so "advance automatically" is not a question that
							// beat can answer.
							<PropRow
								label={label('auto')}
								overridden={!auto}
								resetLabel={resetLabel('dur')}
								testId="beat-prop-auto"
							>
								<CheckboxButton
									// The row's label already says Auto; the box says the rest.
									iconOnly
									label={label('auto')}
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
							</PropRow>
						)}
						<PropRow
							fallback={fallback(
								speaks(beat)
									? t('dialogs.passageEdit.beatProps.autoFallback', {
											seconds: defaultHold(autoAdvanceMs)
									  })
									: undefined
							)}
							label={label('dur')}
							onReset={() => onSetKey('dur', null)}
							overridden={!auto}
							resetLabel={resetLabel('dur')}
							stated={!auto}
							testId="beat-prop-dur"
						>
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
									placeholder={
										speaks(beat) ? String(defaultHold(autoAdvanceMs)) : undefined
									}
									type="number"
									value={dur}
								>
									{label('dur')}
								</TextInput>
							</span>
							<span className="beat-prop-unit">s</span>
						</PropRow>
						<PropRow
							fallback={fallback(undefined)}
							label={label('ease')}
							onReset={() => onSetKey('ease', null)}
							overridden={beat?.ease !== undefined}
							resetLabel={resetLabel('ease')}
							stated={beat?.ease !== undefined}
							testId="beat-prop-ease"
						>
							<TextSelect
								onChange={event => {
									// The map form is a readout, not a value to write back.
									if (event.target.value === PER_KIND) {
										return;
									}

									onSetKey('ease', event.target.value || null);
								}}
								options={[
									{label: label('inherit'), value: INHERIT},
									...(ease === PER_KIND
										? [{label: label('easePerKind'), value: PER_KIND}]
										: []),
									...EASE_NAMES.map(name => ({label: name, value: name}))
								]}
								value={ease}
							>
								{label('ease')}
							</TextSelect>
						</PropRow>
					</div>
					{speaks(beat) && (
						<div className="scene-preview-beat-props-group">
							<h4 className="scene-preview-beat-props-heading">
								{label('bubble')}
							</h4>
							<PropRow {...bubbleRow('as')} testId="beat-prop-as">
								{/*
									A PreviewSelect, not a TextSelect: `as:` names a PICTURE, and
									seven lowercase words is a list an author has to try rather
									than read. Its colours are the ones this beat will actually be
									drawn in, so the shapes preview against the fill and stroke in
									force here and not against the factory white.
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
										emptyLabel: label('inherit'),
										// What the default actually means here, drawn. The colour
										// keys only: `inherited` is a whole BubbleStyle and
										// spreading it would hand the swatch an `at:` and a `w:`.
										emptyPreview: (
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
									{label('as')}
								</PreviewSelect>
							</PropRow>
							<PropRow {...bubbleRow('font')} testId="beat-prop-font">
								<PreviewSelect
									onChange={value => onSetBubble('font', value || null)}
									options={bubbleFontOptions({
										current: style?.font,
										customLabel: label('fontCustom'),
										emptyLabel: label('inherit'),
										emptyPreview: (
											<BubbleFontSwatch
												label={label('fontSample')}
												stack={bubbleFontStack(inherited?.font)}
											/>
										)
									})}
									searchable
									value={style?.font ?? INHERIT}
								>
									{label('font')}
								</PreviewSelect>
							</PropRow>
							{/*
								Text, fill, stroke — in that order, because a fill and a stroke
								are only right or wrong relative to the words on them. No
								free-text field: a hand-written `rgba(…)` is a story-wide
								decision far more often than a one-line one, and lives in the
								YAML or the Defaults dialog.
							*/}
							{(['color', 'bg', 'accent'] as const).map(key => (
								<PropRow {...colorRow(key)} key={key} testId={`beat-prop-${key}`}>
									<BubbleColorControl
										clearLabel={label('clearColor')}
										swatches={storyColors}
										swatchesLabel={label('storyColors')}
										onChange={value => onSetBubble(key, value ?? null)}
										value={style?.[key]}
									>
										{label(key)}
									</BubbleColorControl>
								</PropRow>
							))}
							<PropRow {...bubbleRow('place')} testId="beat-prop-place">
								<TextSelect
									onChange={event =>
										onSetBubble('place', event.target.value || null)
									}
									options={[
										{label: label('inherit'), value: INHERIT},
										...BUBBLE_PLACES.map(place => ({label: place, value: place}))
									]}
									value={style?.place ?? INHERIT}
								>
									{label('place')}
								</TextSelect>
							</PropRow>
							<PropRow {...bubbleRow('sizing')} testId="beat-prop-sizing">
								{/*
									Explained, not just named: what a sizing changes is how the
									bubble answers a phone versus a desktop, and the pane beside
									the list draws exactly that for the highlighted option.
								*/}
								<PreviewSelect
									onChange={value => onSetBubble('sizing', value || null)}
									options={bubbleSizingOptions({
										emptyLabel: label('inherit'),
										emptyValue: INHERIT,
										inherited: inherited?.sizing,
										t
									})}
									value={style?.sizing ?? INHERIT}
								>
									{label('sizing')}
								</PreviewSelect>
							</PropRow>
							{/*
								Directly after the select that decides whether it means anything.
								The arrows are the whole control -- `size` is a multiplier, so the
								move is "a bit bigger", a tenth a press.
							*/}
							<PropRow
								{...bubbleRow('size', String(inherited?.size ?? 1))}
								note={sizeNote && t(sizeNote)}
								testId="beat-prop-size"
							>
								<span className="scene-preview-beat-props-size">
									<TextInput
										min={SIZE_MIN}
										onChange={event => commitSize(event.target.value)}
										onBlur={clearSize}
										onKeyDown={event => {
											if (event.key === 'Enter') {
												clearSize();
											}

											if (event.key === 'Escape') {
												setSizeDraft(undefined);
											}
										}}
										// What the box would be drawn at if it said nothing:
										// the scene's own multiplier, or the plain stage size.
										placeholder={String(inherited?.size ?? 1)}
										step={SIZE_STEP}
										type="number"
										value={size}
									>
										{label('size')}
									</TextInput>
								</span>
							</PropRow>
							{/*
								Alignment after the size rows: valign only means something once
								sizing has fixed the box.
							*/}
							<PropRow {...bubbleRow('align')} testId="beat-prop-align">
								<IconChoice
									buttons={ALIGN_BUTTONS}
									inherited={inherited?.align}
									label={label('align')}
									labelOf={label}
									onChange={value => onSetBubble('align', value)}
									value={style?.align}
								/>
							</PropRow>
							<PropRow
								{...bubbleRow('valign')}
								note={valignNote && t(valignNote)}
								testId="beat-prop-valign"
							>
								<IconChoice
									buttons={VALIGN_BUTTONS}
									inherited={inherited?.valign}
									label={label('valign')}
									labelOf={label}
									onChange={value => onSetBubble('valign', value)}
									value={style?.valign}
								/>
							</PropRow>
							<PropRow
								{...bubbleRow('anchor')}
								disabledReason={anchorOff && t(anchorOff)}
								testId="beat-prop-anchor"
							>
								<span
									className="beat-prop-disabled-wrap"
									title={anchorOff && t(anchorOff)}
								>
									<TextSelect
										disabled={!!anchorOff}
										onChange={event =>
											onSetBubble('anchor', event.target.value || null)
										}
										options={[
											{label: label('inherit'), value: INHERIT},
											...BUBBLE_ANCHORS.map(anchor => ({
												label: anchor,
												value: anchor
											}))
										]}
										value={style?.anchor ?? INHERIT}
									>
										{label('anchor')}
									</TextSelect>
								</span>
							</PropRow>
						</div>
					)}
				</>
			)}
		</div>
	);
};
