import {defaultCharacter, slugify, uniqueName} from '@sliders/asset-store';
import {AssetKind, Character} from '@sliders/scene-types';
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
import {onAssetFocus, takePendingAssetFocus} from './focus-request';
import type {AssetFocusRequest} from './focus-request';
import {ImportTab} from './import-tab';
import {AssetTile} from './asset-tile';
import {characterFromFile, framesFromFiles} from './character-frames';
import {CharacterTile} from './character-tile';
import {UploadButton} from './upload-button';
import {UploadDropZone} from './upload-drop-zone';
import {useAssetUsage} from './use-asset-usage';
import {useSceneRefRename} from './use-scene-ref-rename';
import {useSyncedRefs} from './use-synced-refs';
import './sliders-assets.css';

/** Tabs, in the order spec 03 draws them. `undefined` is the characters collection tab. */
const TABS: {kind?: AssetKind; labelKey: string}[] = [
	{kind: 'bg', labelKey: 'dialogs.slidersAssets.backgrounds'},
	{kind: 'object', labelKey: 'dialogs.slidersAssets.objects'},
	{kind: undefined, labelKey: 'dialogs.slidersAssets.characters'},
	{kind: 'fx', labelKey: 'dialogs.slidersAssets.fx'},
	{kind: 'sound', labelKey: 'dialogs.slidersAssets.sounds'}
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
	const renameScenes = useSceneRefRename();
	// Art no scene names never leaves this machine on a push. Badge it, don't change it.
	const synced = useSyncedRefs();
	const usage = useAssetUsage();
	const [focus, setFocus] = React.useState<AssetFocusRequest>();
	const [newCharacterName, setNewCharacterName] = React.useState('');
	/** A rename the store refused. Nothing else here can fail in a way the author chose. */
	const [renameError, setRenameError] = React.useState<string>();
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

	/**
	 * A double click on the scene stage asks for the entity it hit. All the caller has is
	 * the scene's `ref`, which is a character id or an asset name out of one namespace —
	 * the same ambiguity `resolveEntity` faces, resolved in the same order.
	 */
	const focusedCharacter = focus
		? library.characters.find(character => character.id === focus.ref)
		: undefined;
	const focusedAsset =
		focus && !focusedCharacter
			? library.visible.find(asset => asset.name === focus.ref)
			: undefined;

	React.useEffect(() => {
		// The dialog may be opening because of this request, in which case it was published
		// before anything was here to hear it.
		setFocus(takePendingAssetFocus());

		return onAssetFocus(setFocus);
	}, []);

	React.useEffect(() => {
		if (!focus) {
			return;
		}

		// A tile that is filtered out cannot be scrolled to, and the author did not ask for
		// the filter this time — they asked for this asset.
		setSearch('');
		setTagFilter([]);

		if (focusedCharacter) {
			setTabIndex(TABS.findIndex(tab => !tab.kind));
		} else if (focusedAsset) {
			setTabIndex(TABS.findIndex(tab => tab.kind === focusedAsset.kind));
		}
		// Keyed on the request, not on what it resolved to: the library can arrive after
		// the request does, and re-running then is exactly right.
	}, [focus, focusedAsset, focusedCharacter]);

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

	/**
	 * Characters aren't an `AssetKind`, so a dropped file can't just "upload into that
	 * kind" the way spec 03 has every other tab do it. Dropped on the tab itself, each file
	 * becomes a new character, with the image as its first frame; dropped on a tile, the
	 * files become new frames of that character instead (`handleDropOnCharacter`).
	 */
	async function handleCharacterDrop(files: File[]) {
		// One free id minted per file without asking the store again, so a drop of forty
		// sprites cannot stop on the first one whose name a backdrop already holds.
		const takenIds = await library.store.takenNames();

		for (const file of files) {
			try {
				await characterFromFile(library.store, file, takenIds);
			} catch (error) {
				console.error(`Could not add ${file.name} as a character`, error);
			}
		}

		library.refresh();
	}

	/** Files dropped onto a character's own tile join that character as frames. */
	async function handleDropOnCharacter(character: Character, files: File[]) {
		const frames = await framesFromFiles(library.store, character, files);

		await library.store.putCharacter({...character, frames});
		library.refresh();
	}

	async function handleCreateCharacter(name: string) {
		const id = uniqueName(slugify(name), await library.store.takenNames());

		await library.store.putCharacter(defaultCharacter(id));
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

	/**
	 * Names and character ids are ONE namespace (spec 03), so a rename is checked against
	 * both. Frames count too: they are addressable from a scene, and `store.update` throws
	 * on a clash rather than numbering--the prompt has to catch it before that.
	 */
	function nameTaken(name: string, exceptId?: string): boolean {
		const lowered = name.toLowerCase();

		return (
			library.all.some(
				asset =>
					asset.id !== exceptId && asset.name.toLowerCase() === lowered
			) ||
			library.characters.some(
				character => character.id.toLowerCase() === lowered
			)
		);
	}

	/**
	 * Renaming art, and optionally carrying the scenes that name it along.
	 *
	 * The store moves first: a rename it refuses (a clash the prompt did not catch, one
	 * namespace with character ids) must not leave the passages rewritten to a name no
	 * asset answers to.
	 */
	async function handleRenameAsset(
		id: string,
		name: string,
		updateScenes = false
	) {
		const oldName = library.all.find(asset => asset.id === id)?.name;

		setRenameError(undefined);

		try {
			await library.store.update(id, {name});
		} catch (error) {
			console.error(`Could not rename ${id} to ${name}`, error);
			setRenameError(t('dialogs.slidersAssets.renameError', {name}));
			library.refresh();
			return;
		}

		if (updateScenes && oldName) {
			renameScenes(oldName, name);
		}

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
						// The file picker on the Sounds tab must offer sounds, or the tab is
						// a dead end for everybody who reaches for the button instead of
						// dragging — the picker would show no files at all.
						accept={kind === 'sound' ? 'audio/*' : 'image/*'}
						commandId="slidersAssets.upload"
						commandScope="sliders-assets"
						label={t('dialogs.slidersAssets.upload')}
						onUpload={kind ? handleUpload : handleCharacterDrop}
					/>
				)}
				{!kind && !importing && (
					<PromptButton
						commandId="slidersAssets.newCharacter"
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
			{renameError && (
				<div className="sliders-note">
					<p className="sliders-upload-report" role="alert">
						{renameError}
					</p>
				</div>
			)}
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
								focused={focusedAsset?.id === asset.id}
								key={asset.id}
								meta={asset}
								nameTaken={name => nameTaken(name, asset.id)}
								onChangeTags={tags => handleChangeTags(asset.id, tags)}
								onDelete={() => handleDeleteAsset(asset.id)}
								onEdit={() => openAssetEditor(asset.id)}
								onRename={(name, updateScenes) =>
									handleRenameAsset(asset.id, name, updateScenes)
								}
								unreferenced={synced.ready && !synced.assetIds.has(asset.id)}
								usedIn={usage.get(asset.name)}
							/>
						))
					) : (
						matchingCharacters.map(character => (
							<CharacterTile
								allTags={library.tags}
								character={character}
								focused={focusedCharacter?.id === character.id}
								key={character.id}
								onChangeTags={tags =>
									handleChangeCharacterTags(character.id, tags)
								}
								onDelete={() => handleDeleteCharacter(character.id)}
								onDropFiles={files => handleDropOnCharacter(character, files)}
								onEdit={() => openCharacterEditor(character.id)}
								unreferenced={
									synced.ready && !synced.characterIds.has(character.id)
								}
								usedIn={usage.get(character.id)}
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
										tab.kind === 'sound'
											? 'dialogs.slidersAssets.emptySounds'
											: tab.kind
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
									tab.kind === 'sound'
										? t('dialogs.slidersAssets.dropHintSounds')
										: tab.kind
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
