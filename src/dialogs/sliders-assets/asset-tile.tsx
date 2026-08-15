import {assetFragment} from '@sliders/asset-store';
import {AssetMeta} from '@sliders/scene-types';
import {IconPhotoEdit, IconTags, IconTrash} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../components/badge/badge';
import {ButtonBar} from '../../components/container/button-bar';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {PromptButton} from '../../components/control/prompt-button';
import {AssetPreview} from './asset-preview';
import {CopyFragmentButton} from './copy-fragment-button';

export interface AssetTileProps {
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
	const {meta, onChangeTags, onDelete, onEdit} = props;
	const [tagText, setTagText] = React.useState(meta.tags.join(', '));
	const {t} = useTranslation();

	return (
		<div className="sliders-tile" data-asset-id={meta.id}>
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
				<PromptButton
					icon={<IconTags />}
					label={t('dialogs.slidersAssets.editTags')}
					onChange={event => setTagText(event.target.value)}
					onSubmit={value =>
						onChangeTags(
							value
								.split(',')
								.map(tag => tag.trim())
								.filter(Boolean)
						)
					}
					prompt={t('dialogs.slidersAssets.editTagsPrompt')}
					value={tagText}
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
