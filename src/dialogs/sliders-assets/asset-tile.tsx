import {assetFragment} from '@sliders/asset-store';
import {AssetMeta} from '@sliders/scene-types';
import {IconPhotoEdit, IconTrash} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../components/badge/badge';
import {ButtonBar} from '../../components/container/button-bar';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {TagCardButton} from '../../components/tag/tag-card-button';
import {setAssetDragData} from '../passage-edit/scene-preview/asset-drag';
import type {AssetDragPayload} from '../passage-edit/scene-preview/asset-drag';
import {AssetPreview} from './asset-preview';
import {CopyFragmentButton} from './copy-fragment-button';

export interface AssetTileProps {
	allTags: string[];
	meta: AssetMeta;
	onChangeTags: (tags: string[]) => void;
	onDelete: () => void;
	onEdit: () => void;
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
	const {allTags, meta, onChangeTags, onDelete, onEdit} = props;
	const {t} = useTranslation();

	// Backgrounds replace `bg:`, objects become an entry under `props:`. Only the NAME
	// travels — scene YAML addresses assets by name, and `a_8f21` is unwritable. An `fx`
	// asset is not draggable: `fx:` is a list of effects on the whole stage, not something
	// with a position, so there is nowhere on the stage for it to land.
	const dragPayload: AssetDragPayload | undefined =
		meta.kind === 'bg' || meta.kind === 'object'
			? {label: meta.name, ref: meta.name, target: meta.kind === 'bg' ? 'bg' : 'prop'}
			: undefined;

	return (
		<div
			className="sliders-tile"
			data-asset-id={meta.id}
			draggable={!!dragPayload}
			onDragStart={event =>
				dragPayload &&
				setAssetDragData(event.dataTransfer, dragPayload, assetFragment(meta))
			}
			title={dragPayload ? t('dialogs.slidersAssets.dragToStage') : undefined}
		>
			<AssetPreview alt={meta.name} assetId={meta.id} />
			<div className="sliders-tile-name">{meta.name}</div>
			<div className="sliders-tile-detail">
				{t('dialogs.slidersAssets.assetDetail', {
					width: meta.w,
					height: meta.h,
					size: formatBytes(meta.bytes),
					format: meta.mime.replace(/^image\//, '')
				})}
			</div>
			<div className="sliders-tile-badges">
				{meta.animated && <Badge label={t('dialogs.slidersAssets.animated')} />}
				{meta.tags.map(tag => (
					<Badge key={tag} label={tag} />
				))}
			</div>
			<CopyFragmentButton fragment={assetFragment(meta)} />
			<ButtonBar>
				<IconButton
					// Editing an animation would flatten it to one frame.
					disabled={meta.animated}
					icon={<IconPhotoEdit />}
					label={
						meta.animated
							? t('dialogs.slidersAssets.editImageAnimated')
							: t('dialogs.slidersAssets.editImage')
					}
					onClick={onEdit}
				/>
				<TagCardButton
					allTags={allTags}
					id={`asset-tag-input-${meta.id}`}
					onAdd={tag => onChangeTags([...meta.tags, tag])}
					onRemove={tag => onChangeTags(meta.tags.filter(t => t !== tag))}
					tags={meta.tags}
				/>
				<ConfirmButton
					confirmVariant="danger"
					icon={<IconTrash />}
					label={t('common.delete')}
					onConfirm={onDelete}
					prompt={t('dialogs.slidersAssets.deletePrompt', {name: meta.name})}
				/>
			</ButtonBar>
		</div>
	);
};
