/**
 * The controls that only make sense with something selected: flip, layer, frame, delete.
 *
 * These live in the preview's toolbar rather than floating over the sprite. A widget drawn
 * on the stage would have to be excluded from hit testing, would move with the camera, and
 * would cover the very thing the author is looking at. The keyboard is the fast path — this
 * row exists so that the gestures are discoverable at all, which a keymap alone never is.
 *
 * `frame:` is cast-only and single-selection-only: props are one image and have no frames
 * (spec 03), and two characters share no frame vocabulary.
 */

import {IconFlipHorizontal, IconTrash} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {LAYERS} from '@sliders/scene-types';
import type {AssetResolver, Layer, StageEntity} from '@sliders/scene-types';
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
	onLayer: (layer: Layer) => void;
}

/** No frame chosen: the renderer falls back to `idle`, or to the manifest's first frame. */
const AUTO_FRAME = '';

/** Mixed selection — the select shows nothing rather than lying about one of them. */
const MIXED = '';

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
	const {assets, editable, entities, onDelete, onFlip, onFrame, onLayer} = props;
	const {t} = useTranslation();
	const single = entities.length === 1 ? entities[0] : undefined;
	const frames = useCharacterFrames(
		assets,
		single?.kind === 'cast' ? single.ref : undefined
	);

	if (entities.length === 0 || !editable) {
		return null;
	}

	const layers = new Set(entities.map(entity => entity.layer));
	const layer = layers.size === 1 ? entities[0].layer : MIXED;

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
			<TextSelect
				onChange={event => onLayer(event.target.value as Layer)}
				options={[
					// Only reachable as a starting state: picking it would mean picking
					// "leave them as they are", which is what not touching the select does.
					...(layer === MIXED
						? [
								{
									disabled: true,
									label: t('dialogs.passageEdit.scenePreview.layerMixed'),
									value: MIXED
								}
						  ]
						: []),
					...LAYERS.map(name => ({
						label: t(`dialogs.passageEdit.scenePreview.layer_${name}`),
						value: name
					}))
				]}
				value={layer}
			>
				{t('dialogs.passageEdit.scenePreview.layer')}
			</TextSelect>
			{single?.kind === 'cast' && frames.length > 0 && (
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
