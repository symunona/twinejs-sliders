import {
	defaultCharacter,
	nameFromFilename,
	newFrameAnchors,
	slugify,
	uniqueName
} from '@sliders/asset-store';
import {AssetKind} from '@sliders/scene-types';
import {IconUserPlus} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Tab, TabList, TabPanel, Tabs} from 'react-tabs';
import {ButtonBar} from '../../components/container/button-bar';
import {DialogCard} from '../../components/container/dialog-card';
import {PromptButton} from '../../components/control/prompt-button';
import {TextInput} from '../../components/control/text-input';
import {TagCardButton} from '../../components/tag/tag-card-button';
import {useCommand} from '../../hotkeys';
import {AssetEditorDialog} from '../asset-editor';
import {useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {SlidersCharactersDialog} from '../sliders-characters';
import {useAssetLibrary} from './asset-store-context';
import {ImportTab} from './import-tab';
import {AssetTile} from './asset-tile';
import {CharacterTile} from './character-tile';
import {UploadButton} from './upload-button';
import {UploadDropZone} from './upload-drop-zone';
import {useSyncedRefs} from './use-synced-refs';
import './sliders-assets.css';

/** Tabs, in the order spec 03 draws them. `undefined` is the characters collection tab. */
const TABS: {kind?: AssetKind; labelKey: string}[] = [
	{kind: 'bg', labelKey: 'dialogs.slidersAssets.backgrounds'},
	{kind: 'object', labelKey: 'dialogs.slidersAssets.objects'},
	{kind: undefined, labelKey: 'dialogs.slidersAssets.characters'},
	{kind: 'fx', labelKey: 'dialogs.slidersAssets.fx'}
];

/**
 * The Import tab sits after them. It is not in TABS because it holds no kind of asset —
 * it is the one place that reads a library other than this story's.
 */
const IMPORT_TAB = TABS.length;

export type SlidersAssetsDialogProps = DialogComponentProps;

export const SlidersAssetsDialog: React.FC<SlidersAssetsDialogProps> = props => {
	const {dispatch} = useDialogsContext();
	const library = useAssetLibrary();
	// Art no scene names never leaves this machine on a push. Badge it, don't change it.
	const synced = useSyncedRefs();
	const [newCharacterName, setNewCharacterName] = React.useState('');
	const [newCharacterOpen, setNewCharacterOpen] = React.useState(false);
	const [search, setSearch] = React.useState('');
	const [tabIndex, setTabIndex] = React.useState(0);
	const [tagFilter, setTagFilter] = React.useState<string[]>([]);
	const searchField = React.useRef<HTMLInputElement>(null);
	const {t} = useTranslation();

	const importing = tabIndex === IMPORT_TAB;
	const {kind} = TABS[tabIndex] ?? {};
	const searchText = search.trim().toLowerCase();

	const matchingAssets = library.visible.filter(
		asset =>
			asset.kind === kind &&
			(!searchText || asset.name.toLowerCase().includes(searchText)) &&
			(tagFilter.length === 0 || asset.tags.some(tag => tagFilter.includes(tag)))
	);
	const matchingCharacters = library.characters.filter(
		character =>
			(!searchText ||
				character.name.toLowerCase().includes(searchText) ||
				character.id.includes(searchText)) &&
			(tagFilter.length === 0 ||
				character.tags.some(tag => tagFilter.includes(tag)))
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

	function characterNameFromFilename(filename: string): string {
		const base = nameFromFilename(filename).replace(/[-/]+/g, ' ').trim();

		return base.replace(/\S+/g, word => word[0].toUpperCase() + word.slice(1));
	}

	/**
	 * Characters aren't an `AssetKind`, so a dropped file can't just "upload into that
	 * kind" the way spec 03 has every other tab do it. Each file becomes a new character
	 * instead, with the image as its first (`idle`) frame — the same shape the character
	 * editor's own frame upload writes (`kind: 'frame'`, `ownerCharacter`).
	 */
	async function handleCharacterDrop(files: File[]) {
		// Asset names count, not just other character ids: a scene addresses assets by name
		// and characters by id out of one namespace, and `store.putCharacter` throws on a
		// clash rather than quietly renaming. Minting a free id here is what keeps a drop of
		// forty sprites from stopping on the first one that matches a backdrop.
		const takenIds = await library.store.takenNames();

		for (const file of files) {
			const id = uniqueName(slugify(nameFromFilename(file.name)), takenIds);

			takenIds.add(id);

			try {
				const asset = await library.store.putAsset(file, {
					kind: 'frame',
					ownerCharacter: id
				});
				const character = defaultCharacter(id, characterNameFromFilename(file.name));

				character.frames.idle = {asset: asset.id, anchors: newFrameAnchors(undefined)};
				await library.store.putCharacter(character);
			} catch (error) {
				console.error(`Could not add ${file.name} as a character`, error);
			}
		}

		library.refresh();
	}

	async function handleCreateCharacter(name: string) {
		const id = uniqueName(slugify(name), await library.store.takenNames());

		await library.store.putCharacter(defaultCharacter(id, name.trim() || id));
		setNewCharacterName('');
		library.refresh();
		openCharacterEditor(id);
	}

	// New Character only exists on the characters tab, so its shortcut only
	// works there. Search is a chord so that it can steal focus back from the
	// field it just filled.

	useCommand({
		enabled: !kind && !importing,
		id: 'slidersAssets.newCharacter',
		label: t('hotkeys.commands.slidersAssets.newCharacter'),
		run: () => setNewCharacterOpen(true),
		scope: 'sliders-assets'
	});

	useCommand({
		allowInInput: true,
		id: 'slidersAssets.search',
		label: t('hotkeys.commands.slidersAssets.search'),
		run: () => searchField.current?.select(),
		scope: 'sliders-assets'
	});

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

	async function handleChangeCharacterTags(id: string, tags: string[]) {
		const character = library.characters.find(c => c.id === id);

		if (!character) {
			return;
		}

		await library.store.putCharacter({...character, tags});
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
			focusOnOpen
			headerLabel={t('dialogs.slidersAssets.title')}
			hotkeyScope="sliders-assets"
			maximizable
		>
			<ButtonBar>
				{!importing && (
					<UploadButton
						commandId="slidersAssets.upload"
						commandScope="sliders-assets"
						label={t('dialogs.slidersAssets.upload')}
						onUpload={kind ? handleUpload : handleCharacterDrop}
					/>
				)}
				{!kind && !importing && (
					<PromptButton
						icon={<IconUserPlus />}
						label={t('dialogs.slidersAssets.newCharacter')}
						onChange={event => setNewCharacterName(event.target.value)}
						onChangeOpen={setNewCharacterOpen}
						onSubmit={handleCreateCharacter}
						open={newCharacterOpen}
						prompt={t('dialogs.slidersAssets.newCharacterPrompt')}
						value={newCharacterName}
						variant="create"
					/>
				)}
				<TextInput
					onChange={event => setSearch(event.target.value)}
					ref={searchField}
					type="search"
					value={search}
				>
					{t('dialogs.slidersAssets.search')}
				</TextInput>
				{!importing && (
					<TagCardButton
						allTags={library.tags}
						id="sliders-assets-tag-filter"
						onAdd={tag => setTagFilter([...tagFilter, tag])}
						onRemove={tag =>
							setTagFilter(tagFilter.filter(t => t !== tag))
						}
						restrictToExisting
						tags={tagFilter}
					/>
				)}
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
					<Tab className="sliders-tab">
						{t('dialogs.slidersAssets.importTab')}
					</Tab>
				</TabList>
				{TABS.map(tab => {
					const tiles = tab.kind ? (
						matchingAssets.map(asset => (
							<AssetTile
								allTags={library.tags}
								key={asset.id}
								meta={asset}
								onChangeTags={tags => handleChangeTags(asset.id, tags)}
								onDelete={() => handleDeleteAsset(asset.id)}
								onEdit={() => openAssetEditor(asset.id)}
								unreferenced={synced.ready && !synced.assetIds.has(asset.id)}
							/>
						))
					) : (
						matchingCharacters.map(character => (
							<CharacterTile
								allTags={library.tags}
								character={character}
								key={character.id}
								onChangeTags={tags =>
									handleChangeCharacterTags(character.id, tags)
								}
								onDelete={() => handleDeleteCharacter(character.id)}
								onEdit={() => openCharacterEditor(character.id)}
								unreferenced={
									synced.ready && !synced.characterIds.has(character.id)
								}
							/>
						))
					);
					const empty = tab.kind
						? matchingAssets.length === 0
						: matchingCharacters.length === 0;
					const body = (
						<>
							<div className="sliders-tiles">{tiles}</div>
							{!library.busy && empty && (
								<p className="sliders-empty">
									{t(
										tab.kind
											? 'dialogs.slidersAssets.empty'
											: 'dialogs.slidersAssets.emptyCharacters'
									)}
								</p>
							)}
						</>
					);

					return (
						<TabPanel key={tab.labelKey}>
							<UploadDropZone
								label={
									tab.kind
										? t('dialogs.slidersAssets.dropHint', {kind: t(tab.labelKey)})
										: t('dialogs.slidersAssets.dropHintCharacters')
								}
								onDrop={tab.kind ? handleUpload : handleCharacterDrop}
							>
								{body}
							</UploadDropZone>
						</TabPanel>
					);
				})}
				<TabPanel>
					<ImportTab
						onImported={library.refresh}
						present={library.all}
						search={search}
					/>
				</TabPanel>
			</Tabs>
			<div className="sliders-note">
				<p className="sliders-backend">
					{t('dialogs.slidersAssets.backend', {backend: library.store.backend})}
				</p>
			</div>
		</DialogCard>
	);
};
