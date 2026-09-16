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
import {TileUses} from './tile-uses';

export interface CharacterTileProps {
	allTags: string[];
	character: Character;
	/** Highlighted and scrolled to--something asked for this tile by id. */
	focused?: boolean;
	onChangeTags: (tags: string[]) => void;
	onDelete: () => void;
	/** Image files dropped onto this tile, to become new frames of this character. */
	onDropFiles: (files: File[]) => void;
	onEdit: () => void;
	/** Passage names whose scenes cast this character. */
	usedIn?: string[];
	/**
	 * No scene casts this character, so a push leaves it and its frames behind. Undefined
	 * while the scan is still running — see `useSyncedRefs`.
	 */
	unreferenced?: boolean;
}

/**
 * A character is one tile, not one tile per frame (spec 03). Clicking it opens the
 * character editor.
 */
export const CharacterTile: React.FC<CharacterTileProps> = props => {
	const {
		allTags,
		character,
		focused,
		onChangeTags,
		onDelete,
		onDropFiles,
		onEdit,
		unreferenced,
		usedIn
	} = props;
	const frameNames = Object.keys(character.frames);
	const [over, setOver] = React.useState(false);
	const {t} = useTranslation();
	const tileRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (focused) {
			tileRef.current?.scrollIntoView({block: 'nearest'});
		}
	}, [focused]);

	/**
	 * Files only. A tile is itself draggable, so dragging one character across another must
	 * not look like it can be dropped there — the stage is the only place that takes those.
	 */
	function draggingFiles(event: React.DragEvent) {
		return Array.from(event.dataTransfer.types).includes('Files');
	}

	function handleDragOver(event: React.DragEvent) {
		if (!draggingFiles(event)) {
			return;
		}

		// Stopped so the tab's own drop zone doesn't also light up--the two mean different
		// things here (new character vs. new frame of this one).
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = 'copy';
		setOver(true);
	}

	function handleDragLeave(event: React.DragEvent) {
		// Moving onto a child of the tile fires a leave that bubbles up from the element
		// being left, which would flicker the hint off over the tile's own contents.
		if (
			event.relatedTarget instanceof Node &&
			event.currentTarget.contains(event.relatedTarget)
		) {
			return;
		}

		setOver(false);
	}

	function handleDrop(event: React.DragEvent) {
		if (!draggingFiles(event)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		setOver(false);

		const files = Array.from(event.dataTransfer.files);

		if (files.length > 0) {
			onDropFiles(files);
		}
	}

	return (
		<div
			className={`sliders-tile${focused ? ' focused' : ''}${
				over ? ' drag-over' : ''
			}`}
			data-character-id={character.id}
			draggable
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			// A cast entry is addressed by the character's ID, which is what `ref` resolves
			// through — unlike a prop, whose ref is an asset name.
			onDragStart={event =>
				setAssetDragData(
					event.dataTransfer,
					{label: character.name, ref: character.id, target: 'cast'},
					characterFragment(character)
				)
			}
			ref={tileRef}
			title={t('dialogs.slidersAssets.dragToStage')}
		>
			{over && (
				<div className="sliders-tile-drop-hint">
					{t('dialogs.slidersAssets.dropHintFrames', {name: character.name})}
				</div>
			)}
			<button
				className="sliders-tile-open"
				onClick={onEdit}
				title={t('dialogs.slidersAssets.openCharacter', {name: character.name})}
			>
				<span className="sliders-tile-art">
					<AssetPreview
						alt={character.name}
						assetId={character.frames[frameNames[0]]?.asset}
						origin={character.origin}
					/>
					<span className="sliders-tile-size">
						{t('dialogs.slidersAssets.frameCount', {count: frameNames.length})}
					</span>
				</span>
				<span className="sliders-tile-name">{character.name}</span>
			</button>
			<TileUses passages={usedIn ?? []} />
			<div className="sliders-tile-badges">
				{unreferenced && (
					<Badge
						label={t('dialogs.slidersAssets.unreferenced')}
						title={t('dialogs.slidersAssets.unreferencedCharacterTitle')}
						variant="warning"
					/>
				)}
				{character.tags.map(tag => (
					<Badge key={tag} label={tag} />
				))}
			</div>
			<ButtonBar>
				<IconButton
					icon={<IconEdit />}
					iconOnly
					label={t('dialogs.slidersAssets.editCharacter')}
					onClick={onEdit}
				/>
				<TagCardButton
					allTags={allTags}
					iconOnly
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
					iconOnly
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
