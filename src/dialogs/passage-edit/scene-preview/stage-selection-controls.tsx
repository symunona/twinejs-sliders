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
 * `auto` — the resolver decides. Asking it for frames and showing the select only when it
 * answers with some IS the refinement: a name that turns out to be an asset comes back
 * empty and the select stays hidden.
 */

import {
	IconArrowDown,
	IconArrowUp,
	IconFlipHorizontal,
	IconTrash
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {AssetResolver, StageEntity} from '@sliders/scene-types';
import {IconButton} from '../../../components/control/icon-button';
import {TextSelect} from '../../../components/control/text-select';

export interface StageSelectionControlsProps {
	assets: AssetResolver;
	/** The selected entities, in selection order. Empty renders nothing. */
	entities: StageEntity[];
	/** False when there is no CodeMirror to write to. */
	editable: boolean;
	onDelete: () => void;
	onFlip: () => void;
	onFrame: (frame: string | undefined) => void;
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
	const {assets, editable, entities, onDelete, onFlip, onFrame, onStepZ} = props;
	const {t} = useTranslation();
	const single = entities.length === 1 ? entities[0] : undefined;
	const frames = useCharacterFrames(
		assets,
		single && single.kind !== 'prop' ? single.ref : undefined
	);

	// Nothing to offer, nothing to draw. The row floats OVER the stage rather than sitting
	// above it, so it can come and go without moving the scene — which is what the empty
	// placeholder used to be for.
	if (entities.length === 0 || !editable) {
		return null;
	}

	return (
		<div className="scene-preview-selection" data-testid="scene-preview-selection">
			<IconButton
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
				icon={<IconArrowDown />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.zBack')}
				onClick={() => onStepZ(-1)}
			/>
			<IconButton
				icon={<IconArrowUp />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.zFront')}
				onClick={() => onStepZ(1)}
			/>
			{single && single.kind !== 'prop' && frames.length > 0 && (
				<TextSelect
					onChange={event => onFrame(event.target.value || undefined)}
					options={[
						{
							label: t('dialogs.passageEdit.scenePreview.frameAuto'),
							value: AUTO_FRAME
						},
						...frames.map(name => ({label: name, value: name}))
					]}
					value={
						single.frame && frames.includes(single.frame)
							? single.frame
							: AUTO_FRAME
					}
				>
					{t('dialogs.passageEdit.scenePreview.frame')}
				</TextSelect>
			)}
			<IconButton
				icon={<IconTrash />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.remove')}
				onClick={onDelete}
			/>
		</div>
	);
};
