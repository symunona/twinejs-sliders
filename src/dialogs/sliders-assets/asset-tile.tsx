import {assetFragment, musicFragment} from '@sliders/asset-store';
import {AssetMeta} from '@sliders/scene-types';
import {IconMusic, IconPhotoEdit, IconTrash} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../components/badge/badge';
import {ButtonBar} from '../../components/container/button-bar';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {TagCardButton} from '../../components/tag/tag-card-button';
import {setAssetDragData} from '../passage-edit/scene-preview/asset-drag';
import type {AssetDragPayload} from '../passage-edit/scene-preview/asset-drag';
import {copyText} from '../../util/copy-text';
import {AssetPreview} from './asset-preview';
import {SoundPreview} from './sound-preview';
import {TileUses} from './tile-uses';

export interface AssetTileProps {
	allTags: string[];
	/** Highlighted and scrolled to--something asked for this tile by name. */
	focused?: boolean;
	meta: AssetMeta;
	onChangeTags: (tags: string[]) => void;
	onDelete: () => void;
	onEdit: () => void;
	/** Passage names whose scenes write this asset's name. */
	usedIn?: string[];
	/**
	 * No scene names this asset, so a push leaves it behind. Undefined while the scan is
	 * still running, which is not the same as "used" — see `useSyncedRefs`.
	 */
	unreferenced?: boolean;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AssetTile: React.FC<AssetTileProps> = props => {
	const {
		allTags,
		focused,
		meta,
		onChangeTags,
		onDelete,
		onEdit,
		unreferenced,
		usedIn
	} = props;
	const {t} = useTranslation();
	const tileRef = React.useRef<HTMLDivElement>(null);

	// Backgrounds replace `bg:`, objects become an entry under `props:`. Only the NAME
	// travels — scene YAML addresses assets by name, and `a_8f21` is unwritable. An `fx`
	// asset is not draggable: `fx:` is a list of effects on the whole stage, not something
	// with a position, so there is nowhere on the stage for it to land.
	const dragPayload: AssetDragPayload | undefined =
		meta.kind === 'bg' || meta.kind === 'object'
			? {label: meta.name, ref: meta.name, target: meta.kind === 'bg' ? 'bg' : 'prop'}
			: undefined;
	// A sound has no pixels, so the whole art half of a tile means something else for it:
	// audition instead of thumbnail, length instead of dimensions, and no image editor.
	const isSound = meta.kind === 'sound';

	React.useEffect(() => {
		if (focused) {
			tileRef.current?.scrollIntoView({block: 'nearest'});
		}
	}, [focused]);

	return (
		<div
			className={`sliders-tile${focused ? ' focused' : ''}`}
			data-asset-id={meta.id}
			draggable={!!dragPayload || isSound}
			onDragStart={event => {
				if (dragPayload) {
					setAssetDragData(event.dataTransfer, dragPayload, assetFragment(meta));
					return;
				}

				if (isSound) {
					// Text only, and deliberately no ASSET_DRAG_MIME: a sound has nowhere to
					// land ON the stage, so advertising it to the stage's drop target would
					// mean inventing a position for a thing that has none. Dropped into the
					// passage text it pastes its beat, which is the whole gesture.
					event.dataTransfer.effectAllowed = 'copy';
					event.dataTransfer.setData('text/plain', assetFragment(meta));
				}
			}}
			ref={tileRef}
			title={
				dragPayload
					? t('dialogs.slidersAssets.dragToStage')
					: isSound
					? t('dialogs.slidersAssets.dragSoundToText')
					: undefined
			}
		>
			<div className="sliders-tile-art">
				{isSound ? (
					<SoundPreview
						assetId={meta.id}
						duration={meta.duration}
						name={meta.name}
					/>
				) : (
					<>
						{/* Only when the asset carries one: a cross on every default-anchored
						    tile is nine crosses saying nothing. */}
						<AssetPreview alt={meta.name} assetId={meta.id} origin={meta.origin} />
						{/* Dimensions only. Bytes and format are in the tooltip: the pixel size
						    is what an author checks against the stage, the rest is
						    housekeeping. */}
						<span
							className="sliders-tile-size"
							title={t('dialogs.slidersAssets.assetDetail', {
								width: meta.w,
								height: meta.h,
								size: formatBytes(meta.bytes),
								format: meta.mime.replace(/^image\//, '')
							})}
						>
							{meta.w}×{meta.h}
						</span>
					</>
				)}
			</div>
			<div className="sliders-tile-name">{meta.name}</div>
			<TileUses passages={usedIn ?? []} />
			<div className="sliders-tile-badges">
				{unreferenced && (
					<Badge
						label={t('dialogs.slidersAssets.unreferenced')}
						title={t('dialogs.slidersAssets.unreferencedTitle')}
						variant="warning"
					/>
				)}
				{meta.animated && <Badge label={t('dialogs.slidersAssets.animated')} />}
				{meta.tags.map(tag => (
					<Badge key={tag} label={tag} />
				))}
			</div>
			<ButtonBar>
				{isSound ? (
					// The other half of the pair the tile hands out. The drag (and the tile's
					// own fragment) writes the one-shot beat, because that is the commoner
					// half; this writes the scene's looping bed, which is the half an author
					// would otherwise have to remember the spelling of.
					<IconButton
						icon={<IconMusic />}
						iconOnly
						label={t('dialogs.slidersAssets.copyMusicLine')}
						onClick={() => void copyText(musicFragment(meta))}
					/>
				) : (
					<IconButton
						// Editing an animation would flatten it to one frame.
						disabled={meta.animated}
						icon={<IconPhotoEdit />}
						iconOnly
						label={
							meta.animated
								? t('dialogs.slidersAssets.editImageAnimated')
								: t('dialogs.slidersAssets.editImage')
						}
						onClick={onEdit}
					/>
				)}
				<TagCardButton
					allTags={allTags}
					iconOnly
					id={`asset-tag-input-${meta.id}`}
					onAdd={tag => onChangeTags([...meta.tags, tag])}
					onRemove={tag => onChangeTags(meta.tags.filter(t => t !== tag))}
					tags={meta.tags}
				/>
				<ConfirmButton
					confirmVariant="danger"
					icon={<IconTrash />}
					iconOnly
					label={t('common.delete')}
					onConfirm={onDelete}
					prompt={t('dialogs.slidersAssets.deletePrompt', {name: meta.name})}
				/>
			</ButtonBar>
		</div>
	);
};
