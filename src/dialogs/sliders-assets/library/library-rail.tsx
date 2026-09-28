import {
	CollectionNameTakenError,
	CollectionRecord,
	LibraryEngine
} from '@sliders/asset-library';
import {
	IconFolderPlus,
	IconGripVertical,
	IconLock,
	IconSearch,
	IconUnlink,
	IconX
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../../components/container/button-bar';
import {IconButton} from '../../../components/control/icon-button';
import {PromptButton} from '../../../components/control/prompt-button';
import {
	ALL,
	collectionLabel,
	LIBRARY_ASSET_MIME,
	LibrarySnapshot,
	MINE,
	namesOnlyIn,
	RailSelection,
	reorder
} from './library-model';

const COLLECTION_MIME = 'application/x-sliders-library-collection';

export interface LibraryRailProps {
	engine: LibraryEngine;
	snapshot: LibrarySnapshot;
	storyId: string;
	storyName: string;
	selection: RailSelection;
	onSelect: (selection: RailSelection) => void;
	/** Own collection + binding, created on demand. Resolves the own id. */
	ensureOwn: () => Promise<string>;
	/** Names the story's scenes write (asset names and character ids). */
	usedNames: string[];
	/** A tile dropped on a collection: move it there, or copy with Alt. */
	onDropAsset: (assetId: string, collection: string, copy: boolean) => void;
}

/**
 * Left rail (plan 1, "Library UI"): Mine, attached (checkbox + drag = resolution
 * order), team (tick = attach), `+ New collection`, All assets. Every attach, detach
 * and reorder is one `engine.bind`.
 */
export const LibraryRail: React.FC<LibraryRailProps> = props => {
	const {
		engine,
		ensureOwn,
		onDropAsset,
		onSelect,
		selection,
		snapshot,
		storyId,
		storyName,
		usedNames
	} = props;
	const {t} = useTranslation();
	const [dragging, setDragging] = React.useState<string>();
	const [dropTarget, setDropTarget] = React.useState<string>();
	const [detachAsk, setDetachAsk] = React.useState<{
		collection: CollectionRecord;
		names: string[];
	}>();
	const [newName, setNewName] = React.useState('');
	const [newOpen, setNewOpen] = React.useState(false);
	const [error, setError] = React.useState<string>();
	const attachedIds = snapshot.attached.map(collection => collection.id);
	const label = (collection: CollectionRecord | undefined) =>
		collectionLabel(collection, name =>
			t('dialogs.library.storyCollection', {name})
		);

	async function bind(ids: string[]) {
		setError(undefined);

		try {
			await ensureOwn();
			engine.bind(storyId, ids);
		} catch (bindError) {
			console.error('Could not change attached collections', bindError);
			setError(t('dialogs.library.bindError'));
		}
	}

	function attach(collection: CollectionRecord) {
		void bind([...attachedIds, collection.id]);
	}

	function detach(collection: CollectionRecord, confirmed = false) {
		const orphans = namesOnlyIn(engine, snapshot, collection.id, usedNames);

		if (orphans.length && !confirmed) {
			setDetachAsk({collection, names: orphans});
			return;
		}

		setDetachAsk(undefined);

		if (selection === collection.id) {
			onSelect(MINE);
		}

		void bind(attachedIds.filter(id => id !== collection.id));
	}

	async function create(name: string) {
		const trimmed = name.trim();

		setError(undefined);

		try {
			const collection = engine.createCollection({name: trimmed});

			await bind([...attachedIds, collection.id]);
			setNewName('');
			onSelect(collection.id);
		} catch (createError) {
			setError(
				createError instanceof CollectionNameTakenError
					? t('dialogs.library.collectionNameTaken', {name: trimmed})
					: t('dialogs.library.bindError')
			);
		}
	}

	// Stable: PromptButton re-validates whenever `validate` changes identity.
	const validateNew = React.useCallback(
		(value: string) => {
			const trimmed = value.trim();

			if (trimmed === '') {
				return {message: t('dialogs.library.collectionNameEmpty'), valid: false};
			}

			if (engine.collectionByName(trimmed)) {
				return {
					message: t('dialogs.library.collectionNameTaken', {name: trimmed}),
					valid: false
				};
			}

			return {valid: true};
		},
		[engine, t]
	);

	/** Tiles land on any collection; collections reorder only among attached ones. */
	function dropProps(collection: CollectionRecord, reorderable: boolean) {
		return {
			onDragLeave: () => setDropTarget(undefined),
			onDragOver: (event: React.DragEvent) => {
				const types = Array.from(event.dataTransfer.types);

				if (
					types.includes(LIBRARY_ASSET_MIME) ||
					(reorderable && dragging && types.includes(COLLECTION_MIME))
				) {
					event.preventDefault();
					event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
					setDropTarget(collection.id);
				}
			},
			onDrop: (event: React.DragEvent) => {
				const assetId = event.dataTransfer.getData(LIBRARY_ASSET_MIME);

				setDropTarget(undefined);

				if (assetId) {
					event.preventDefault();
					onDropAsset(assetId, collection.id, event.altKey);
					return;
				}

				if (reorderable && dragging) {
					event.preventDefault();
					void bind(reorder(attachedIds, dragging, collection.id));
					setDragging(undefined);
				}
			}
		};
	}

	function item(
		collection: CollectionRecord,
		section: 'attached' | 'team'
	): React.ReactNode {
		const attached = section === 'attached';

		return (
			<li
				className={classNames('library-rail-item', {
					'drop-target': dropTarget === collection.id,
					selected: selection === collection.id
				})}
				data-collection-id={collection.id}
				draggable={attached}
				key={collection.id}
				onDragEnd={() => setDragging(undefined)}
				onDragStart={
					attached
						? event => {
								event.dataTransfer.effectAllowed = 'move';
								event.dataTransfer.setData(COLLECTION_MIME, collection.id);
								setDragging(collection.id);
						  }
						: undefined
				}
				{...dropProps(collection, attached)}
			>
				{attached && (
					<span className="library-rail-grip" title={t('dialogs.library.dragToReorder')}>
						<IconGripVertical />
					</span>
				)}
				<input
					aria-label={t(
						attached ? 'dialogs.library.detach' : 'dialogs.library.attach',
						{name: label(collection)}
					)}
					checked={attached}
					onChange={() => (attached ? detach(collection) : attach(collection))}
					type="checkbox"
				/>
				<button
					className="library-rail-name"
					onClick={() => onSelect(collection.id)}
					type="button"
				>
					{label(collection)}
				</button>
				{collection.locked && (
					<span className="library-rail-lock" title={t('dialogs.library.locked')}>
						<IconLock />
					</span>
				)}
			</li>
		);
	}

	return (
		<nav aria-label={t('dialogs.library.collections')} className="library-rail">
			<h3>{t('dialogs.library.collections')}</h3>
			<ul>
				<li
					className={classNames('library-rail-item', 'mine', {
						'drop-target': !!snapshot.own && dropTarget === snapshot.own.id,
						selected: selection === MINE
					})}
					{...(snapshot.own ? dropProps(snapshot.own, false) : {})}
				>
					<button
						className="library-rail-name"
						onClick={() => onSelect(MINE)}
						type="button"
					>
						{t('dialogs.library.mine', {name: storyName})}
					</button>
				</li>
			</ul>
			<h4>{t('dialogs.library.attached')}</h4>
			<ul data-testid="library-rail-attached">
				{snapshot.attached.map(collection => item(collection, 'attached'))}
				{snapshot.attached.length === 0 && (
					<li className="library-rail-empty">
						{t('dialogs.library.attachedEmpty')}
					</li>
				)}
			</ul>
			{detachAsk && (
				<div className="library-ask" role="alertdialog">
					<p>
						{t('dialogs.library.detachWarning', {
							count: detachAsk.names.length,
							name: label(detachAsk.collection),
							names: detachAsk.names.join(', ')
						})}
					</p>
					<ButtonBar>
						<IconButton
							icon={<IconUnlink />}
							label={t('dialogs.library.detachAnyway')}
							onClick={() => detach(detachAsk.collection, true)}
							variant="danger"
						/>
						<IconButton
							icon={<IconX />}
							label={t('common.cancel')}
							onClick={() => setDetachAsk(undefined)}
						/>
					</ButtonBar>
				</div>
			)}
			<h4>{t('dialogs.library.team')}</h4>
			<ul data-testid="library-rail-team">
				{snapshot.team.map(collection => item(collection, 'team'))}
			</ul>
			{error && (
				<p className="library-error" role="alert">
					{error}
				</p>
			)}
			<ButtonBar orientation="vertical">
				<PromptButton
					icon={<IconFolderPlus />}
					label={t('dialogs.library.newCollection')}
					onChange={event => setNewName(event.target.value)}
					onChangeOpen={setNewOpen}
					onSubmit={value => void create(value)}
					open={newOpen}
					prompt={t('dialogs.library.newCollectionPrompt')}
					validate={validateNew}
					value={newName}
					variant="create"
				/>
				<IconButton
					icon={<IconSearch />}
					label={t('dialogs.library.allAssets')}
					onClick={() => onSelect(ALL)}
					selectable
					selected={selection === ALL}
				/>
			</ButtonBar>
		</nav>
	);
};
