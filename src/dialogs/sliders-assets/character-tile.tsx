import {characterFragment} from '@sliders/asset-store';
import {Character} from '@sliders/scene-types';
import {IconEdit, IconTrash} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../components/badge/badge';
import {ButtonBar} from '../../components/container/button-bar';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {TagCardButton} from '../../components/tag/tag-card-button';
import {setAssetDragData} from '../passage-edit/scene-preview/asset-drag';
import {AssetPreview} from './asset-preview';
import {CopyFragmentButton} from './copy-fragment-button';

export interface CharacterTileProps {
	allTags: string[];
	character: Character;
	onChangeTags: (tags: string[]) => void;
	onDelete: () => void;
	onEdit: () => void;
}

/**
 * A character is one tile, not one tile per frame (spec 03). Clicking it opens the
 * character editor.
 */
export const CharacterTile: React.FC<CharacterTileProps> = props => {
	const {allTags, character, onChangeTags, onDelete, onEdit} = props;
	const frameNames = Object.keys(character.frames);
	const {t} = useTranslation();

	return (
		<div
			className="sliders-tile"
			data-character-id={character.id}
			draggable
			// A cast entry is addressed by the character's ID, which is what `ref` resolves
			// through — unlike a prop, whose ref is an asset name.
			onDragStart={event =>
				setAssetDragData(
					event.dataTransfer,
					{label: character.name, ref: character.id, target: 'cast'},
					characterFragment(character)
				)
			}
			title={t('dialogs.slidersAssets.dragToStage')}
		>
			<button
				className="sliders-tile-open"
				onClick={onEdit}
				title={t('dialogs.slidersAssets.openCharacter', {name: character.name})}
			>
				<AssetPreview
					alt={character.name}
					assetId={character.frames[frameNames[0]]?.asset}
				/>
				<span className="sliders-tile-name">{character.name}</span>
				<span className="sliders-tile-detail">
					{t('dialogs.slidersAssets.frameCount', {count: frameNames.length})}
				</span>
			</button>
			<div className="sliders-tile-badges">
				{character.tags.map(tag => (
					<Badge key={tag} label={tag} />
				))}
			</div>
			<CopyFragmentButton fragment={characterFragment(character)} />
			<ButtonBar>
				<IconButton
					icon={<IconEdit />}
					label={t('dialogs.slidersAssets.editCharacter')}
					onClick={onEdit}
				/>
				<TagCardButton
					allTags={allTags}
					id={`character-tag-input-${character.id}`}
					onAdd={tag => onChangeTags([...character.tags, tag])}
					onRemove={tag =>
						onChangeTags(character.tags.filter(t => t !== tag))
					}
					tags={character.tags}
				/>
				<ConfirmButton
					confirmVariant="danger"
					icon={<IconTrash />}
					label={t('common.delete')}
					onConfirm={onDelete}
					prompt={t('dialogs.slidersAssets.deleteCharacterPrompt', {
						name: character.name
					})}
				/>
			</ButtonBar>
		</div>
	);
};
