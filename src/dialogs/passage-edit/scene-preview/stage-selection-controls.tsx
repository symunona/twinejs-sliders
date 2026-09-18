/**
 * The controls that only make sense with something selected: flip, depth, frame, delete.
 *
 * These live in the preview's toolbar rather than floating over the sprite. A widget drawn
 * on the stage would have to be excluded from hit testing, would move with the camera, and
 * would cover the very thing the author is looking at. The keyboard is the fast path — this
 * row exists so that the gestures are discoverable at all, which a keymap alone never is.
 *
 * `frame:` is cast-only and single-selection-only: props are one image and have no frames
 * (spec 03), and two characters share no frame vocabulary. An `entities:` entry is kind
 * `auto` — the resolver decides. Asking it for frames and showing the menu only when it
 * answers with some IS the refinement: a name that turns out to be an asset comes back
 * empty and the menu stays hidden.
 *
 * The frame control is a `MenuButton` and not the `TextSelect` it used to be, for one
 * reason: hovering an item previews that pose on the stage. A native `<select>` cannot do
 * that — its popup is drawn by the browser, its `<option>`s are not elements the page gets
 * pointer events from, and there is no way to ask which one the pointer is over. Frame
 * names are the case that needs it most; `shock` and `surprise` are the same word until
 * you have seen both.
 */

import {
	IconArrowDown,
	IconArrowUp,
	IconFlipHorizontal,
	IconMoodSmile,
	IconTrash
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {AssetResolver, StageEntity} from '@sliders/scene-types';
import {IconButton} from '../../../components/control/icon-button';
import {MenuButton} from '../../../components/control/menu-button';

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
	onFrame: (frame: string | undefined) => void;
	/**
	 * Draw a frame on the stage without writing it: `AUTO_FRAME` for the fallback, a name
	 * for that pose, `null` to stop previewing and go back to what the scene says.
	 *
	 * The stage answers a hover, not a click, because choosing a pose is a question about
	 * what it LOOKS like and the names alone do not answer it — `shock` and `surprise` are
	 * the same word until you see them. See `onPreviewFrame` in `scene-preview`.
	 */
	onPreviewFrame: (frame: string | null) => void;
	/** One z step. -1 sends backward, +1 brings forward — same as `[` and `]`. */
	onStepZ: (delta: number) => void;
}

/** No frame chosen: the renderer falls back to `idle`, or to the manifest's first frame. */
const AUTO_FRAME = '';

/**
 * The frame names a character declares.
 *
 * Read through the resolver, which is the same path the renderer uses, so the list can
 * never offer a frame that would fail to draw. Characters are looked up by id and props
 * never get here, so there is nothing to fetch for a prop selection.
 */
function useCharacterFrames(
	assets: AssetResolver,
	characterId: string | undefined
): string[] {
	const [frames, setFrames] = React.useState<string[]>([]);

	React.useEffect(() => {
		if (!characterId) {
			setFrames([]);

			return;
		}

		let cancelled = false;

		assets
			.character(characterId)
			.then(character => {
				if (!cancelled) {
					setFrames(Object.keys(character?.frames ?? {}));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setFrames([]);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [assets, characterId]);

	return frames;
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
		onFrame,
		onPreviewFrame,
		onStepZ
	} = props;
	const {t} = useTranslation();
	const single = entities.length === 1 ? entities[0] : undefined;
	const frames = useCharacterFrames(
		assets,
		single && single.kind !== 'prop' ? single.ref : undefined
	);
	// A `frame:` naming a pose the character does not declare is an error the list cannot
	// show, so it reads as Automatic here — which is what the renderer does NOT do (see
	// `pickFrameName`: a frame that was asked for and missed draws `? frame`). The menu is
	// for choosing, not for reporting; the scene errors already carry the complaint.
	const current =
		single?.frame && frames.includes(single.frame) ? single.frame : AUTO_FRAME;

	// Nothing to offer, nothing to draw. The row floats OVER the stage rather than sitting
	// above it, so it can come and go without moving the scene — which is what the empty
	// placeholder used to be for.
	if (entities.length === 0 || !editable) {
		return null;
	}

	return (
		<div className="scene-preview-selection" data-testid="scene-preview-selection">
			{note && (
				<span
					className="scene-preview-selection-note"
					data-testid="scene-preview-selection-note"
					// Ellipsised on a narrow stage, and the half that gets cut is the half
					// that says what to do about it.
					title={note}
				>
					{note}
				</span>
			)}
			<IconButton
			commandId="scene.flip"
				icon={<IconFlipHorizontal />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.flip')}
				onClick={onFlip}
				selectable
				selected={entities.every(entity => entity.flip)}
			/>
			{/* Depth is one number now, so these are the buttons the layer select used to
			    be. They step `z:`, exactly as `[` / `]` and mod+down / mod+up do. */}
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
			{single && single.kind !== 'prop' && frames.length > 0 && (
				<MenuButton
					icon={<IconMoodSmile />}
					items={[AUTO_FRAME, ...frames].map(name => ({
						checkable: true as const,
						checked: name === current,
						label:
							name === AUTO_FRAME
								? t('dialogs.passageEdit.scenePreview.frameAuto')
								: name,
						onClick: () => {
							// The scene says this pose now, so there is nothing left to
							// preview. Cleared here as well as on close because choosing is
							// the one case where the answer outlives the question.
							onPreviewFrame(null);
							onFrame(name || undefined);
						},
						onHover: (hovering: boolean) =>
							onPreviewFrame(hovering ? name : null)
					}))}
					label={t('dialogs.passageEdit.scenePreview.frameNamed', {
						frame:
							current === AUTO_FRAME
								? t('dialogs.passageEdit.scenePreview.frameAuto')
								: current
					})}
					// The menu can close without a leave event — a click anywhere does it,
					// and the items unmount under the pointer — so the preview is turned
					// off here as well as on leave. Turning it off twice costs nothing;
					// missing the second one leaves the stage showing a pose the scene
					// does not say.
					onChangeOpen={open => {
						if (!open) {
							onPreviewFrame(null);
						}
					}}
					// Upward, because this row sits across the TOP of the stage and a menu
					// dropped from it lands on the sprite it is previewing — on a docked
					// stage, squarely on it. Above the row is the editor's own chrome,
					// which is nothing the author is looking at while choosing a pose.
					// Popper flips it back down when there is no room, which is full
					// screen, where the stage is large enough not to care.
					placement="top-end"
					tooltipLabel={t('dialogs.passageEdit.scenePreview.frameHint')}
				/>
			)}
			<IconButton
			commandId="scene.delete"
				icon={<IconTrash />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.remove')}
				onClick={onDelete}
			/>
		</div>
	);
};
