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
 * pose and motion, then the grade sliders — the long part goes last so the buttons never move. Hovering one
 * slider shows the sprite at that slider's two ends (`GradeExtremesOverlay`).
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
import {BG_MOTIONS, normalizeGrade} from '@sliders/scene-types';
import type {
	AssetResolver,
	EntityGrade,
	GradeKey,
	StageEntity
} from '@sliders/scene-types';
import {IconButton} from '../../../components/control/icon-button';
import {MenuButton} from '../../../components/control/menu-button';
import {NumberField} from './number-field';
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
	/**
	 * Draw a pose on the stage without writing it: `AUTO_POSE` for the fallback, a name
	 * for that pose, `null` to stop previewing and go back to what the scene says.
	 *
	 * The stage answers a hover, not a click, because choosing a pose is a question about
	 * what it LOOKS like and the names alone do not answer it — `shock` and `surprise` are
	 * the same word until you see them. See `onPreviewPose` in `scene-preview`.
	 */
	onPreviewPose: (pose: string | null) => void;
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

/** The speed every moving sprite in the selection shares, else undefined (box empty). */
function sharedSpeed(entities: StageEntity[]): number | undefined {
	const speeds = new Set(
		entities.filter(entity => entity.motion).map(entity => entity.motion?.speed)
	);

	return speeds.size === 1 ? [...speeds][0] : undefined;
}

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
		onResetStretch,
		onToggleLock,
		onOpenLink,
		onPreviewPose,
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
