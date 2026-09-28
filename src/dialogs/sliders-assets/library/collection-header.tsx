import {
	CollectionNameTakenError,
	CollectionNotEmptyError,
	CollectionRecord,
	LibraryEngine
} from '@sliders/asset-library';
import {IconActivity, IconTrash, IconWriting} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../../components/container/button-bar';
import {CheckboxButton} from '../../../components/control/checkbox-button';
import {ConfirmButton} from '../../../components/control/confirm-button';
import {IconButton} from '../../../components/control/icon-button';
import {PromptButton} from '../../../components/control/prompt-button';
import type {CollectionSync} from './library-model';
import {SyncChip} from './sync-chip';

export interface CollectionHeaderProps {
	engine: LibraryEngine;
	collection?: CollectionRecord;
	/** Heading when there is no record: "Mine: Night Market" before the first write, "All assets". */
	title: string;
	/** The story's own collection: cannot be deleted from here. */
	own: boolean;
	count: number;
	sync: CollectionSync;
	onOpenConflicts: () => void;
	onActivity?: () => void;
	onDeleted: () => void;
}

/**
 * Collection header (plan 2, "Editing collections"): rename, description, lock, sync
 * chip, Activity, delete (refused while any story attaches it).
 */
export const CollectionHeader: React.FC<CollectionHeaderProps> = props => {
	const {
		collection,
		count,
		engine,
		onActivity,
		onDeleted,
		onOpenConflicts,
		own,
		sync,
		title
	} = props;
	const {t} = useTranslation();
	const [renameOpen, setRenameOpen] = React.useState(false);
	const [draft, setDraft] = React.useState('');
	const [description, setDescription] = React.useState(
		collection?.description ?? ''
	);
	const [error, setError] = React.useState<string>();

	React.useEffect(
		() => setDescription(collection?.description ?? ''),
		[collection?.description]
	);

	// Stable: PromptButton re-validates whenever `validate` changes identity.
	const collectionId = collection?.id;
	const validateName = React.useCallback(
		(value: string) => {
			const trimmed = value.trim();

			if (!trimmed) {
				return {
					message: t('dialogs.library.collectionNameEmpty'),
					valid: false
				};
			}

			const holder = engine.collectionByName(trimmed);

			return holder && holder.id !== collectionId
				? {
						message: t('dialogs.library.collectionNameTaken', {
							name: trimmed
						}),
						valid: false
				  }
				: {valid: true};
		},
		[collectionId, engine, t]
	);

	function update(patch: Partial<CollectionRecord>) {
		if (!collection) {
			return;
		}

		setError(undefined);

		try {
			engine.updateCollection(collection.id, patch);
		} catch (updateError) {
			setError(
				updateError instanceof CollectionNameTakenError
					? t('dialogs.library.collectionNameTaken', {name: patch.name})
					: t('dialogs.library.collectionError')
			);
		}
	}

	function remove() {
		if (!collection) {
			return;
		}

		setError(undefined);

		try {
			engine.deleteCollection(collection.id, {cascade: true});
			onDeleted();
		} catch (deleteError) {
			if (deleteError instanceof CollectionNotEmptyError) {
				const stories = engine
					.list('binding')
					.filter(binding =>
						[binding.own, ...(binding.collections ?? [])].includes(
							collection.id
						)
					);

				setError(
					t('dialogs.library.deleteRefused', {count: stories.length})
				);
			} else {
				setError(t('dialogs.library.collectionError'));
			}
		}
	}

	return (
		<div className="library-header">
			<div className="library-header-title">
				<h3>{collection?.name ?? title}</h3>
				<span className="library-header-meta">
					{t(
						collection?.kind === 'story'
							? 'dialogs.library.kindStory'
							: collection
							? 'dialogs.library.kindShared'
							: 'dialogs.library.kindAll',
						{count}
					)}
				</span>
				<SyncChip onOpenConflicts={onOpenConflicts} sync={sync} />
			</div>
			{collection && (
				<ButtonBar>
					<PromptButton
						icon={<IconWriting />}
						label={t('dialogs.library.renameCollection')}
						onChange={event => setDraft(event.target.value)}
						onChangeOpen={open => {
							setRenameOpen(open);

							if (open) {
								setDraft(collection.name);
							}
						}}
						onSubmit={value => update({name: value.trim()})}
						open={renameOpen}
						prompt={t('common.renamePrompt', {name: collection.name})}
						validate={validateName}
						value={draft}
					/>
					<CheckboxButton
						label={t('dialogs.library.lock')}
						onChange={value => update({locked: value})}
						tooltipLabel={t('dialogs.library.lockHint')}
						value={!!collection.locked}
					/>
					{onActivity && (
						<IconButton
							icon={<IconActivity />}
							label={t('dialogs.library.activity.title')}
							onClick={onActivity}
						/>
					)}
					{!own && (
						<ConfirmButton
							confirmVariant="danger"
							icon={<IconTrash />}
							label={t('dialogs.library.deleteCollection')}
							onConfirm={remove}
							prompt={t('dialogs.library.deleteCollectionPrompt', {
								count,
								name: collection.name
							})}
						/>
					)}
				</ButtonBar>
			)}
			{collection && (
				<input
					aria-label={t('dialogs.library.description')}
					className="library-description"
					onBlur={() => {
						if (description !== (collection.description ?? '')) {
							update({description});
						}
					}}
					onChange={event => setDescription(event.target.value)}
					placeholder={t('dialogs.library.descriptionPlaceholder')}
					type="text"
					value={description}
				/>
			)}
			{error && (
				<p className="library-error" role="alert">
					{error}
				</p>
			)}
		</div>
	);
};
