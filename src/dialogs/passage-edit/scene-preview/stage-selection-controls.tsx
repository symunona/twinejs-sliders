/**
 * The controls that only make sense with something selected: flip, depth, pose, delete.
 *
 * These live in the sidebar's selection tab rather than floating over the sprite. A widget
 * drawn on the stage would have to be excluded from hit testing, would move with the
 * camera, and would cover the very thing the author is looking at. The keyboard is the fast
 * path — this panel exists so that the gestures are discoverable at all, which a keymap
 * alone never is.
 *
 * Order, top down: the two one-click grade fixes (match bg, reset), the gesture buttons,
 * pose and its step loop, highlight, motion, fit and opacity, then the grade sliders — the long part goes last so the buttons never move. Hovering one
 * slider shows the sprite at that slider's two ends (`GradeExtremesOverlay`). The entity's
 * `if:` sits below everything: whether it is there at all, read once its look is known.
 *
 * `fit:`, `poseLoop:` and `if:` each show "not written" as its own choice (Sprite, Default,
 * an empty box) — never folded into the value it happens to behave like.
 *
 * `pose:` is cast-only and single-selection-only: props are one image and have no poses
 * (spec 03), and two characters share no pose vocabulary. An `entities:` entry is kind
 * `auto` — the resolver decides. Asking it for poses and showing the menu only when it
 * answers with some IS the refinement: a name that turns out to be an asset comes back
 * empty and the menu stays hidden.
 *
 * The pose control is a `MenuButton` and not the `TextSelect` it used to be, for one
 * reason: hovering an item previews that pose on the stage. A native `<select>` cannot do
 * that — its popup is drawn by the browser, its `<option>`s are not elements the page gets
 * pointer events from, and there is no way to ask which one the pointer is over. Pose
 * names are the case that needs it most; `shock` and `surprise` are the same word until
 * you have seen both.
 *
 * Highlight wants the same preview but sits among the dropdowns, so it is a `PreviewSelect`:
 * a dropdown whose list is our own elements, which reports the option under the pointer.
 */

import {
	IconArrowBackUp,
	IconArrowDown,
	IconArrowUp,
	IconAspectRatio,
	IconLock,
	IconLockOpen,
	IconFlipHorizontal,
	IconExternalLink,
	IconMoodSmile,
	IconTrash
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	BG_MOTIONS,
	DEFAULT_HIGHLIGHT,
	ENTITY_FITS,
	HIGHLIGHT_PRESETS,
	POSE_LOOPS,
	normalizeGrade
} from '@sliders/scene-types';
import type {
	AssetResolver,
	EntityFit,
	EntityGrade,
	GradeKey,
	PoseLoop,
	StageEntity
} from '@sliders/scene-types';
import {IconButton} from '../../../components/control/icon-button';
import {MenuButton} from '../../../components/control/menu-button';
import {PreviewSelect} from '../../../components/control/preview-select';
import {AdjustSlider} from '../../asset-editor/adjust-slider';
import {NumberField} from './number-field';
import {TextField} from './text-field';
import {TextSelect} from '../../../components/control/text-select';
import {GradeExtremesOverlay} from './grade-extremes-overlay';
import {GradeSliders} from './grade-sliders';
import {sprite} from './match-bg-dom';

export interface StageSelectionControlsProps {
	assets: AssetResolver;
	/** The selected entities, in selection order. Empty renders nothing. */
	entities: StageEntity[];
	/** False when there is no CodeMirror to write to. */
	editable: boolean;
	/**
	 * Why a gesture on this selection would go nowhere, if it would.
	 *
	 * Shown beside the controls rather than raised after the fact: a drag that is refused on
	 * commit only snaps the sprite back, which reads as a broken editor rather than as a
	 * rule. Saying it here means the author knows before they reach for the sprite.
	 */
	note?: string;
	onDelete: () => void;
	onFlip: () => void;
	/** Drop the squeeze. Shown only while something selected is stretched. */
	onResetStretch?: () => void;
	/** Lock or unlock the selection against the stage's pointer. */
	onToggleLock?: () => void;
	onPose: (pose: string | undefined) => void;
	/**
	 * Set `motion:` on the whole selection, `undefined` to stop it. Absent hides the menu.
	 * Same presets as the backdrop's `fx:` — a prop row of hills is a parallax layer.
	 */
	onMotion?: (motion: string | undefined) => void;
	/** Seconds per cycle on the selection's motions, `undefined` for the preset's own. */
	onMotionSpeed?: (speed: number | undefined) => void;
	/** Set `fit:` on the whole selection, `undefined` for a sprite. Absent hides the menu. */
	onFit?: (fit: EntityFit | undefined) => void;
	/**
	 * Set `poseLoop:` on the selected characters playing a step list, `undefined` to drop the
	 * key. Absent hides the menu; so does a selection with no step list.
	 */
	onPoseLoop?: (poseLoop: PoseLoop | undefined) => void;
	/** The scene's entity conditions (`Scene.entityIfs`): not stage state, so not on the entity. */
	entityIfs?: Record<string, string>;
	/** Set the selection's `if:`, `undefined` to remove it. Absent hides the box. */
	onCondition?: (condition: string | undefined) => void;
	/**
	 * The opacity slider moved: PAINTS the whole selection at that opacity, writes nothing.
	 * Absent hides the slider.
	 */
	onOpacity?: (opacity: number) => void;
	/** The opacity slider was let go of, a number typed, or reset: write what is on screen. */
	onOpacityCommit?: () => void;
	/**
	 * Draw a pose on the stage without writing it: `AUTO_POSE` for the fallback, a name
	 * for that pose, `null` to stop previewing and go back to what the scene says.
	 *
	 * The stage answers a hover, not a click, because choosing a pose is a question about
	 * what it LOOKS like and the names alone do not answer it — `shock` and `surprise` are
	 * the same word until you see them. See `onPreviewPose` in `scene-preview`.
	 */
	onPreviewPose: (pose: string | null) => void;
	/**
	 * Set `highlight:` on the whole selection, `undefined` for the default glow. Absent
	 * hides the menu.
	 */
	onHighlight?: (highlight: string | undefined) => void;
	/**
	 * Glow the selection with a token without writing it, `null` to stop. Same bargain as
	 * `onPreviewPose`: the names `cold` and `warm` say little until the sprite is lit.
	 */
	onPreviewHighlight?: (highlight: string | null) => void;
	/** One z step. -1 sends backward, +1 brings forward — same as `[` and `]`. */
	onStepZ: (delta: number) => void;
	/**
	 * Open the passage a selected entity's `link:` leads to.
	 *
	 * Here and not on the stage itself, because every modifier a click could carry is
	 * already spoken for: plain selects, ctrl/cmd extends the selection, shift is the
	 * drag's axis lock and double click opens the asset. A button in the row is also the
	 * only one of those an author discovers without being told.
	 */
	onOpenLink?: (to: string) => void;
	/**
	 * A grade slider moved: the WHOLE grade now on screen for the single selection. The
	 * parent paints it live and writes it (`grade-write.ts`). Absent hides the sliders.
	 */
	onGrade?: (grade: EntityGrade | undefined) => void;
	/** Write the grade on screen: a slider was let go of, or a reset clicked. */
	onGradeCommit?: () => void;
	/**
	 * The sliders appeared or went away (selection changed, panel closed). Going away is
	 * the parent's cue to flush its write.
	 */
	onGradeOpenChange?: (open: boolean) => void;
	/** The pointer is over one grade slider, or none. */
	onGradeHover?: (key: GradeKey | null) => void;
	/** Where a grade write lands with the scrubber where it is, in words. */
	gradeNote?: string;
	/** The Match bg button, at the top beside Reset. */
	matchBg?: React.ReactNode;
}

/** The slider row for one key, found by its data attribute. */
function gradeRow(panel: HTMLElement, key: GradeKey): HTMLElement | null {
	return (
		Array.from(
			panel.querySelectorAll<HTMLElement>('.scene-grade-sliders-row[data-grade-key]')
		).find(row => row.dataset.gradeKey === key) ?? null
	);
}

/** No pose chosen: the renderer falls back to `idle`, or to the manifest's first pose. */
const AUTO_POSE = '';

/** No `motion:`. */
const STILL = '';

/** The selection disagrees: shown, never chosen. */
const MIXED = '\u0000mixed';

/**
 * The menu's value: the one motion every selected sprite shares, `STILL` when none has one,
 * `MIXED` otherwise.
 */
function sharedMotion(entities: StageEntity[]): string {
	const ids = new Set(entities.map(entity => entity.motion?.id ?? STILL));

	return ids.size === 1 ? [...ids][0] : MIXED;
}

/** No key written. Its own choice in each menu — not the value it behaves like. */
const UNSET = '';

/** The one token every value agrees on, `UNSET` when none is written, `MIXED` otherwise. */
function sharedToken(tokens: (string | undefined)[]): string {
	const set = new Set(tokens.map(token => token ?? UNSET));

	return set.size === 1 ? [...set][0] : MIXED;
}

/** `TextSelect` options: Mixed (shown, never chosen) when it applies, unset, then tokens. */
function tokenOptions(
	value: string,
	unsetLabel: string,
	mixedLabel: string,
	tokens: readonly string[]
) {
	return [
		...(value === MIXED ? [{disabled: true, label: mixedLabel, value: MIXED}] : []),
		{label: unsetLabel, value: UNSET},
		...tokens.map(token => ({label: token, value: token}))
	];
}

/**
 * A dot lit the way the token glows. Unset is the default glow; a preset is its colour; any
 * other token is tried as a CSS colour — a story stylesheet's own word is not one, and its
 * dot stays unlit rather than guessing.
 */
const HighlightSwatch: React.FC<{token: string}> = ({token}) => {
	const colour =
		token === UNSET
			? DEFAULT_HIGHLIGHT
			: (HIGHLIGHT_PRESETS as Record<string, string>)[token] ?? token;

	return (
		<span
			aria-hidden
			className="scene-preview-highlight-swatch"
			style={{background: colour, boxShadow: `0 0 6px 2px ${colour}`}}
		/>
	);
};

/** The speed every moving sprite in the selection shares, else undefined (box empty). */
function sharedSpeed(entities: StageEntity[]): number | undefined {
	const speeds = new Set(
		entities.filter(entity => entity.motion).map(entity => entity.motion?.speed)
	);

	return speeds.size === 1 ? [...speeds][0] : undefined;
}

/**
 * `opacity:` as a slider. Paints on every move and commits on release, typed Enter or
 * reset, the way the grade sliders do and for the same reason: a drag is one edit.
 */
const OpacitySlider: React.FC<{
	onChange: (opacity: number) => void;
	onCommit: () => void;
	value: number;
}> = ({onChange, onCommit, value}) => {
	const {t} = useTranslation();
	const [el, setEl] = React.useState<HTMLDivElement | null>(null);
	const onCommitRef = React.useRef(onCommit);

	onCommitRef.current = onCommit;

	// Native `change`, which a range fires once on release — React's `onChange` is `input`.
	// Deferred a tick so the last paint has landed first. See `GradeSliders`.
	React.useEffect(() => {
		if (!el) {
			return;
		}

		const later = () => window.setTimeout(() => onCommitRef.current(), 0);
		const onClick = (event: MouseEvent) => {
			if ((event.target as Element | null)?.closest?.('button')) {
				later();
			}
		};

		el.addEventListener('change', later);
		el.addEventListener('click', onClick);

		return () => {
			el.removeEventListener('change', later);
			el.removeEventListener('click', onClick);
		};
	}, [el]);

	return (
		<div
			className="scene-preview-selection-opacity"
			data-testid="scene-preview-selection-opacity"
			ref={setEl}
		>
			<AdjustSlider
				editable
				label={t('dialogs.passageEdit.scenePreview.opacity')}
				max={1}
				min={0}
				onChange={opacity => onChange(Math.min(1, Math.max(0, opacity)))}
				resetLabel={t('dialogs.assetEditor.reset')}
				resetTo={1}
				step={0.05}
				value={value}
			/>
		</div>
	);
};

/**
 * The pose names a character declares.
 *
 * Read through the resolver, which is the same path the renderer uses, so the list can
 * never offer a pose that would fail to draw. Characters are looked up by id and props
 * never get here, so there is nothing to fetch for a prop selection.
 */
function useCharacterPoses(
	assets: AssetResolver,
	characterId: string | undefined
): string[] {
	const [poses, setPoses] = React.useState<string[]>([]);

	React.useEffect(() => {
		if (!characterId) {
			setPoses([]);

			return;
		}

		let cancelled = false;

		assets
			.character(characterId)
			.then(character => {
				if (!cancelled) {
					setPoses(Object.keys(character?.poses ?? {}));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setPoses([]);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [assets, characterId]);

	return poses;
}

export const StageSelectionControls: React.FC<
	StageSelectionControlsProps
> = props => {
	const {
		assets,
		editable,
		entities,
		note,
		onDelete,
		onFlip,
		onPose,
		onMotion,
		onMotionSpeed,
		onFit,
		onPoseLoop,
		entityIfs,
		onCondition,
		onOpacity,
		onOpacityCommit,
		onResetStretch,
		onToggleLock,
		onOpenLink,
		onPreviewPose,
		onHighlight,
		onPreviewHighlight,
		onStepZ,
		gradeNote,
		matchBg,
		onGrade,
		onGradeCommit,
		onGradeHover,
		onGradeOpenChange
	} = props;
	const {t} = useTranslation();
	const single = entities.length === 1 ? entities[0] : undefined;
	const poses = useCharacterPoses(
		assets,
		single && single.kind !== 'prop' ? single.ref : undefined
	);
	// A `pose:` naming a pose the character does not declare is an error the list cannot
	// show, so it reads as Automatic here — which is what the renderer does NOT do (see
	// `pickPoseName`: a pose that was asked for and missed draws `? pose`). The menu is
	// for choosing, not for reporting; the scene errors already carry the complaint.
	const current =
		single?.pose && poses.includes(single.pose) ? single.pose : AUTO_POSE;
	// Single selection only: two sprites can lead two different places, and a button that
	// silently picked one of them would be worse than no button.
	const link = single?.link?.to;
	const gradeId = editable && onGrade ? single?.id : undefined;
	const onGradeOpenChangeRef = React.useRef(onGradeOpenChange);
	const onGradeCommitRef = React.useRef(onGradeCommit);

	onGradeOpenChangeRef.current = onGradeOpenChange;
	onGradeCommitRef.current = onGradeCommit;

	const [panelEl, setPanelEl] = React.useState<HTMLDivElement | null>(null);
	// Remembered WITH the sprite it was hovered for, so a selection change drops it without
	// an effect: a new sprite reads as nothing hovered until the pointer moves again. The
	// sliders only fire leave when the pointer goes, not when the row unmounts under it.
	const [gradeHover, setGradeHover] = React.useState<{
		id: string;
		key: GradeKey;
	} | null>(null);
	const hoverKey =
		gradeHover && single && gradeHover.id === single.id ? gradeHover.key : null;
	const hoverGrade = (key: GradeKey | null) => {
		setGradeHover(key && single ? {id: single.id, key} : null);
		onGradeHover?.(key);
	};

	// One sprite's sliders: they open with it and close when the selection moves on, which
	// is the parent's cue to write whatever is left.
	React.useEffect(() => {
		if (!gradeId) {
			return;
		}

		onGradeOpenChangeRef.current?.(true);

		return () => onGradeOpenChangeRef.current?.(false);
	}, [gradeId]);

	// Nothing to offer, nothing to draw.
	if (entities.length === 0 || !editable) {
		return null;
	}

	const names = entities.map(entity => entity.id).join(', ');
	const motion = sharedMotion(entities);
	const fit = sharedToken(entities.map(entity => entity.fit));
	const looping = entities.filter(entity => entity.kind !== 'prop' && entity.steps);
	const poseLoop = sharedToken(looping.map(entity => entity.poseLoop));
	const condition = sharedToken(entities.map(entity => entityIfs?.[entity.id]));
	const highlight = sharedToken(entities.map(entity => entity.highlight));
	const highlightName = (token: string) =>
		token === UNSET
			? t('dialogs.passageEdit.scenePreview.highlightDefault')
			: token === MIXED
			? t('dialogs.passageEdit.scenePreview.motionMixed')
			: token;
	// The presets, plus a token the scene already says that is not one of them — a story
	// stylesheet's own word, or a CSS colour — offered back rather than dropped.
	const highlightTokens = [
		UNSET,
		...Object.keys(HIGHLIGHT_PRESETS),
		...(highlight !== UNSET &&
		highlight !== MIXED &&
		!(highlight in HIGHLIGHT_PRESETS)
			? [highlight]
			: [])
	];

	return (
		<div
			className="scene-preview-selection"
			data-testid="scene-preview-selection"
			ref={setPanelEl}
		>
			<div className="scene-preview-selection-name" title={names}>
				{names}
			</div>
			{note && (
				<span
					className="scene-preview-selection-note"
					data-testid="scene-preview-selection-note"
				>
					{note}
				</span>
			)}
			{link && onOpenLink && (
				<IconButton
					icon={<IconExternalLink />}
					label={link}
					onClick={() => onOpenLink(link)}
					tooltipLabel={t('dialogs.passageEdit.scenePreview.openLink', {
						passage: link
					})}
				/>
			)}
			<div className="scene-preview-selection-buttons">
				<IconButton
					commandId="scene.flip"
					icon={<IconFlipHorizontal />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.flip')}
					onClick={onFlip}
					selectable
					selected={entities.every(entity => entity.flip)}
				/>
				{onResetStretch &&
					entities.some(
						entity =>
							!!entity.stretch &&
							(entity.stretch.x !== 1 || entity.stretch.y !== 1)
					) && (
						<IconButton
							icon={<IconAspectRatio />}
							iconOnly
							label={t('dialogs.passageEdit.scenePreview.resetAspect')}
							onClick={onResetStretch}
						/>
					)}
				{onToggleLock && (
					<IconButton
						icon={
							entities.every(entity => entity.locked) ? (
								<IconLock />
							) : (
								<IconLockOpen />
							)
						}
						iconOnly
						label={
							entities.every(entity => entity.locked)
								? t('dialogs.passageEdit.scenePreview.unlockEntity')
								: t('dialogs.passageEdit.scenePreview.lockEntity')
						}
						onClick={onToggleLock}
						selectable
						selected={entities.every(entity => entity.locked)}
					/>
				)}
				{/* Depth is one number now, so these are the buttons the layer select used
				    to be. They step `z:`, exactly as `[` / `]` and mod+down / mod+up do. */}
				<IconButton
					commandId="scene.zBack"
					icon={<IconArrowDown />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.zBack')}
					onClick={() => onStepZ(-1)}
				/>
				<IconButton
					commandId="scene.zFront"
					icon={<IconArrowUp />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.zFront')}
					onClick={() => onStepZ(1)}
				/>
				<IconButton
					commandId="scene.delete"
					icon={<IconTrash />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.remove')}
					onClick={onDelete}
				/>
			</div>
			{single && single.kind !== 'prop' && poses.length > 0 && (
				<MenuButton
					icon={<IconMoodSmile />}
					items={[AUTO_POSE, ...poses].map(name => ({
						checkable: true as const,
						checked: name === current,
						label:
							name === AUTO_POSE
								? t('dialogs.passageEdit.scenePreview.poseAuto')
								: name,
						onClick: () => {
							// The scene says this pose now, so there is nothing left to
							// preview. Cleared here as well as on close because choosing is
							// the one case where the answer outlives the question.
							onPreviewPose(null);
							onPose(name || undefined);
						},
						onHover: (hovering: boolean) =>
							onPreviewPose(hovering ? name : null)
					}))}
					label={t('dialogs.passageEdit.scenePreview.poseNamed', {
						pose:
							current === AUTO_POSE
								? t('dialogs.passageEdit.scenePreview.poseAuto')
								: current
					})}
					// The menu can close without a leave event — a click anywhere does it,
					// and the items unmount under the pointer — so the preview is turned
					// off here as well as on leave. Turning it off twice costs nothing;
					// missing the second one leaves the stage showing a pose the scene
					// does not say.
					onChangeOpen={open => {
						if (!open) {
							onPreviewPose(null);
						}
					}}
					// Down and to the stage's side: the sidebar is at the right edge, and a
					// menu that opens leftward covers the sidebar, not the sprite.
					placement="bottom-end"
					tooltipLabel={t('dialogs.passageEdit.scenePreview.poseHint')}
				/>
			)}
			{onHighlight && (
				// A dropdown like Motion and Fit below it, and still a hover preview: a
				// `PreviewSelect`'s list is ours, so the option under the pointer (or the
				// arrows) is known and glows on the stage until the list closes.
				<PreviewSelect
					onActiveChange={token =>
						onPreviewHighlight?.(token === null || token === MIXED ? null : token)
					}
					onChange={token => {
						if (token === MIXED) {
							return;
						}

						onPreviewHighlight?.(null);
						onHighlight(token || undefined);
					}}
					options={[
						...(highlight === MIXED
							? [{label: highlightName(MIXED), value: MIXED}]
							: []),
						...highlightTokens.map(token => ({
							label: highlightName(token),
							preview: <HighlightSwatch token={token} />,
							value: token
						}))
					]}
					// Down and to the stage's side — see the pose menu above.
					placement="bottom-end"
					title={t(
						entities.some(entity => entity.link)
							? 'dialogs.passageEdit.scenePreview.highlightHint'
							: 'dialogs.passageEdit.scenePreview.highlightHintUnlinked'
					)}
					value={highlight}
				>
					{t('dialogs.passageEdit.scenePreview.highlight')}
				</PreviewSelect>
			)}
			{onPoseLoop && looping.length > 0 && (
				<TextSelect
					onChange={event =>
						event.target.value !== MIXED &&
						onPoseLoop((event.target.value as PoseLoop) || undefined)
					}
					options={tokenOptions(
						poseLoop,
						t('dialogs.passageEdit.scenePreview.poseLoopDefault'),
						t('dialogs.passageEdit.scenePreview.motionMixed'),
						POSE_LOOPS
					)}
					value={poseLoop}
				>
					{t('dialogs.passageEdit.scenePreview.poseLoop')}
				</TextSelect>
			)}
			{onMotion && (
				<TextSelect
					onChange={event =>
						event.target.value !== MIXED &&
						onMotion(event.target.value || undefined)
					}
					options={[
						...(motion === MIXED
							? [
									{
										disabled: true,
										label: t('dialogs.passageEdit.scenePreview.motionMixed'),
										value: MIXED
									}
							  ]
							: []),
						{
							label: t('dialogs.passageEdit.scenePreview.motionStill'),
							value: STILL
						},
						// A story stylesheet's own token is offered back, not dropped.
						...(motion !== MIXED &&
						motion !== STILL &&
						!(BG_MOTIONS as readonly string[]).includes(motion)
							? [{label: motion, value: motion}]
							: []),
						...BG_MOTIONS.map(id => ({label: id, value: id}))
					]}
					value={motion}
				>
					{t('dialogs.passageEdit.scenePreview.motion')}
				</TextSelect>
			)}
			{onMotionSpeed && entities.some(entity => entity.motion) && (
				<div className="scene-preview-selection-motion-speed">
					<NumberField
						label={t('dialogs.passageEdit.scenePreview.motionSpeed')}
						min={0.1}
						onCommit={onMotionSpeed}
						placeholder={t('dialogs.passageEdit.scenePreview.motionSpeedPreset')}
						unit="s"
						value={sharedSpeed(entities)}
					/>
				</div>
			)}
			{onFit && (
				<TextSelect
					onChange={event =>
						event.target.value !== MIXED &&
						onFit((event.target.value as EntityFit) || undefined)
					}
					options={tokenOptions(
						fit,
						t('dialogs.passageEdit.scenePreview.fitSprite'),
						t('dialogs.passageEdit.scenePreview.motionMixed'),
						ENTITY_FITS
					)}
					value={fit}
				>
					{t('dialogs.passageEdit.scenePreview.fit')}
				</TextSelect>
			)}
			{onOpacity && (
				<OpacitySlider
					onChange={onOpacity}
					onCommit={() => onOpacityCommit?.()}
					// The first selected sprite's: a slider has one thumb, and a move sets the
					// whole selection to wherever it is.
					value={entities[0].opacity}
				/>
			)}
			{single && onGrade && (
				<GradeSliders
					// Inside the sliders' group, which also commits on any button click in it:
					// a second commit while one is in flight is queued and writes nothing.
					fixes={
						<>
							{matchBg}
							<IconButton
								disabled={!normalizeGrade(single.grade)}
								icon={<IconArrowBackUp />}
								label={t('dialogs.passageEdit.scenePreview.grade.resetAll')}
								onClick={() => {
									onGrade(undefined);
									// After the paint has landed, like a slider's release.
									window.setTimeout(() => onGradeCommitRef.current?.(), 0);
								}}
							/>
						</>
					}
					grade={single.grade}
					note={gradeNote}
					onChange={onGrade}
					onCommit={() => onGradeCommit?.()}
					onHoverKey={hoverGrade}
				/>
			)}
			{onCondition && (
				<TextField
					label={t('dialogs.passageEdit.scenePreview.condition')}
					onCommit={onCondition}
					placeholder={
						condition === MIXED
							? t('dialogs.passageEdit.scenePreview.motionMixed')
							: t('dialogs.passageEdit.scenePreview.conditionAlways')
					}
					// Mixed shows empty; the box writes only what was typed into it.
					value={condition === MIXED || condition === UNSET ? undefined : condition}
				/>
			)}
			{single && onGrade && hoverKey && panelEl && (
				<GradeExtremesOverlay
					anchor={gradeRow(panelEl, hoverKey)}
					// The stage this sidebar belongs to, not the first one in the document:
					// the dialog and the passage editor can both have a preview open.
					art={sprite(panelEl.closest('.scene-preview') ?? document, single.id)}
					flip={single.flip}
					grade={single.grade}
					gradeKey={hoverKey}
				/>
			)}
		</div>
	);
};
