import {defaultCharacter, slugify} from '@sliders/asset-store';
import {AssetKind} from '@sliders/scene-types';
import {IconUserPlus} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Tab, TabList, TabPanel, Tabs} from 'react-tabs';
import {ButtonBar} from '../../components/container/button-bar';
import {DialogCard} from '../../components/container/dialog-card';
import {PromptButton} from '../../components/control/prompt-button';
import {TextInput} from '../../components/control/text-input';
import {TextSelect} from '../../components/control/text-select';
import {AssetEditorDialog} from '../asset-editor';
import {useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {SlidersCharactersDialog} from '../sliders-characters';
import {useAssetLibrary} from './asset-store-context';
import {AssetTile} from './asset-tile';
import {CharacterTile} from './character-tile';
import {UploadButton} from './upload-button';
import {UploadDropZone} from './upload-drop-zone';
import './sliders-assets.css';

/** Tabs, in the order spec 03 draws them. `undefined` is the characters collection tab. */
const TABS: {kind?: AssetKind; labelKey: string}[] = [
	{kind: 'bg', labelKey: 'dialogs.slidersAssets.backgrounds'},
	{kind: 'object', labelKey: 'dialogs.slidersAssets.objects'},
	{kind: undefined, labelKey: 'dialogs.slidersAssets.characters'},
	{kind: 'fx', labelKey: 'dialogs.slidersAssets.fx'}
];

export type SlidersAssetsDialogProps = DialogComponentProps;

export const SlidersAssetsDialog: React.FC<SlidersAssetsDialogProps> = props => {
	const {dispatch} = useDialogsContext();
	const library = useAssetLibrary();
	const [newCharacterName, setNewCharacterName] = React.useState('');
	const [search, setSearch] = React.useState('');
	const [tabIndex, setTabIndex] = React.useState(0);
	const [tagFilter, setTagFilter] = React.useState('');
	const {t} = useTranslation();

	const {kind} = TABS[tabIndex];
	const searchText = search.trim().toLowerCase();

	const matchingAssets = library.visible.filter(
		asset =>
			asset.kind === kind &&
			(!searchText || asset.name.toLowerCase().includes(searchText)) &&
			(!tagFilter || asset.tags.includes(tagFilter))
	);
	const matchingCharacters = library.characters.filter(
		character =>
			(!searchText ||
				character.name.toLowerCase().includes(searchText) ||
				character.id.includes(searchText)) &&
			(!tagFilter || character.tags.includes(tagFilter))
	);

	function openAssetEditor(assetId: string) {
		dispatch({
			type: 'addDialog',
			component: AssetEditorDialog,
			// Editing needs the room--the preview is the point.
			maximized: true,
			props: {assetId}
		});
	}

	function openCharacterEditor(characterId?: string) {
		dispatch({
			type: 'addDialog',
			component: SlidersCharactersDialog,
			props: {characterId}
		});
	}

	async function handleUpload(files: File[]) {
		await library.upload(files, {kind: kind ?? 'bg'});
	}

	async function handleCreateCharacter(name: string) {
		const id = slugify(name);

		await library.store.putCharacter(defaultCharacter(id, name.trim() || id));
		setNewCharacterName('');
		library.refresh();
		openCharacterEditor(id);
	}

	async function handleDeleteAsset(id: string) {
		await library.store.remove(id);
		library.refresh();
	}

	async function handleDeleteCharacter(id: string) {
		await library.store.removeCharacter(id);
		library.refresh();
	}

	async function handleChangeTags(id: string, tags: string[]) {
		await library.store.update(id, {tags});
		library.refresh();
	}

	const report = library.lastUpload;
	const hasReport =
		report &&
		(report.duplicates.length > 0 ||
			report.animated.length > 0 ||
			report.errors.length > 0);

	return (
		<DialogCard
			{...props}
			className="sliders-assets-dialog"
			headerLabel={t('dialogs.slidersAssets.title')}
			maximizable
		>
			<ButtonBar>
				<UploadButton
					label={t('dialogs.slidersAssets.upload')}
					onUpload={handleUpload}
				/>
				{!kind && (
					<PromptButton
						icon={<IconUserPlus />}
						label={t('dialogs.slidersAssets.newCharacter')}
						onChange={event => setNewCharacterName(event.target.value)}
						onSubmit={handleCreateCharacter}
						prompt={t('dialogs.slidersAssets.newCharacterPrompt')}
						value={newCharacterName}
						variant="create"
					/>
				)}
				<TextInput
					onChange={event => setSearch(event.target.value)}
					type="search"
					value={search}
				>
					{t('dialogs.slidersAssets.search')}
				</TextInput>
				<TextSelect
					onChange={event => setTagFilter(event.target.value)}
					options={[
						{label: t('dialogs.slidersAssets.allTags'), value: ''},
						...library.tags.map(tag => ({label: tag, value: tag}))
					]}
					value={tagFilter}
				>
					{t('common.tag')}
				</TextSelect>
			</ButtonBar>
			{hasReport && (
				<div className="sliders-note">
					<p className="sliders-upload-report" role="status">
						{report!.duplicates.length > 0 &&
							t('dialogs.slidersAssets.duplicateWarning', {
								names: report!.duplicates.join(', ')
							})}{' '}
						{report!.animated.length > 0 &&
							t('dialogs.slidersAssets.animatedNotice', {
								names: report!.animated.join(', ')
							})}{' '}
						{report!.errors.length > 0 &&
							t('dialogs.slidersAssets.uploadError', {
								names: report!.errors.join(', ')
							})}
					</p>
				</div>
			)}
			<Tabs
				onSelect={setTabIndex}
				selectedIndex={tabIndex}
				selectedTabClassName="selected"
			>
				<TabList className="sliders-tablist">
					{TABS.map(tab => (
						<Tab className="sliders-tab" key={tab.labelKey}>
							{t(tab.labelKey)}
						</Tab>
					))}
				</TabList>
				{TABS.map(tab => (
					<TabPanel key={tab.labelKey}>
						<UploadDropZone
							label={t('dialogs.slidersAssets.dropHint', {
								kind: t(tab.labelKey)
							})}
							onDrop={handleUpload}
						>
							<div className="sliders-tiles">
								{tab.kind
									? matchingAssets.map(asset => (
											<AssetTile
												key={asset.id}
												meta={asset}
												onChangeTags={tags => handleChangeTags(asset.id, tags)}
												onDelete={() => handleDeleteAsset(asset.id)}
												onEdit={() => openAssetEditor(asset.id)}
											/>
									  ))
									: matchingCharacters.map(character => (
											<CharacterTile
												character={character}
												key={character.id}
												onDelete={() => handleDeleteCharacter(character.id)}
												onEdit={() => openCharacterEditor(character.id)}
											/>
									  ))}
							</div>
							{!library.busy &&
								(tab.kind
									? matchingAssets.length === 0
									: matchingCharacters.length === 0) && (
									<p className="sliders-empty">
										{t('dialogs.slidersAssets.empty')}
									</p>
								)}
						</UploadDropZone>
					</TabPanel>
				))}
			</Tabs>
			<div className="sliders-note">
				<p className="sliders-backend">
					{t('dialogs.slidersAssets.backend', {backend: library.store.backend})}
				</p>
			</div>
		</DialogCard>
	);
};
