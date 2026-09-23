import {defaultCharacter, slugify, uniqueName} from '@sliders/asset-store';
import {AssetMeta, Character} from '@sliders/scene-types';
import {
	IconPencil,
	IconTag,
	IconTrash,
	IconUserPlus,
	IconX
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Tab, TabList, TabPanel, Tabs} from 'react-tabs';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {ConfirmButton} from '../../components/control/confirm-button';
import {EditableTitle} from '../../components/control/editable-title';
import {IconButton} from '../../components/control/icon-button';
import {PromptButton} from '../../components/control/prompt-button';
import {useCommand} from '../../hotkeys';
import {useStoriesContext} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {renameSceneCharacter} from '../../util/rename-scene-character';
import {AssetEditorDialog} from '../asset-editor';
import {useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {
	useAssetLibrary,
	useAssetScope
} from '../sliders-assets/asset-store-context';
import {
	ImportPose,
	importPoseSet,
	posesFromFiles,
	stepImagesFromFiles
} from '../sliders-assets/character-poses';
import {CharacterEditor} from './character-editor';
import {ImportSet} from './import-set';
import {decodeImage} from './import-set-images';
import {looksLikeSheet} from './import-set-logic';
import {appendSteps} from './pose-steps';
import './sliders-characters.css';

/** How long a change sits before it's written to the asset store. */
const SAVE_DELAY = 400;

/** A rename the author has asked for but not yet decided the scenes' fate on. */
interface PendingRename {
	/** How many passages a ref rewrite would touch. Always more than zero. */
	count: number;
	id: string;
}

export interface SlidersCharactersDialogProps extends DialogComponentProps {
	/** Character to open on. Set when the asset manager launches this dialog. */
	characterId?: string;
}

export const SlidersCharactersDialog: React.FC<SlidersCharactersDialogProps> = props => {
	const {characterId, ...other} = props;
	const library = useAssetLibrary();
	const storyId = useAssetScope();
	const {stories} = useStoriesContext();
	const {dispatch: undoableDispatch} = useUndoableStoriesContext();
	const {dispatch} = useDialogsContext();
	const [createOpen, setCreateOpen] = React.useState(false);
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const [draft, setDraft] = React.useState<Character>();
	const [newCharacterName, setNewCharacterName] = React.useState('');
	/** Set when the store refused an id. Shown above the tabs, cleared on the next try. */
	const [idError, setIdError] = React.useState<string>();
	const [pendingRename, setPendingRename] = React.useState<PendingRename>();
	const [selectedId, setSelectedId] = React.useState(characterId);
	/** Set while Import set has the editor's place, with any files it was opened with. */
	const [importing, setImporting] = React.useState<{files?: File[]}>();
	const {t} = useTranslation();

	const {characters, refresh, store} = library;
	const activeId = selectedId ?? characters[0]?.id;
	const story = stories.find(candidate => candidate.id === storyId);

	// Load the selected character into a local draft. Everything the editor does happens
	// on the draft; the store gets it back on a debounce.

	React.useEffect(() => {
		if (activeId && draft?.id !== activeId) {
			const found = characters.find(character => character.id === activeId);

			if (found) {
				setDraft(found);
			}
		} else if (!activeId && draft) {
			setDraft(undefined);
		}
	}, [activeId, characters, draft]);

	// Import set belongs to the character it was opened on.
	React.useEffect(() => setImporting(undefined), [activeId]);

	// Held in a ref so `commit()` can write the newest draft without being re-created on
	// every keystroke.
	const latest = React.useRef(draft);

	latest.current = draft;

	const commit = React.useCallback(async () => {
		if (latest.current) {
			await store.putCharacter(latest.current);
			refresh();
		}
	}, [refresh, store]);

	React.useEffect(() => {
		if (!draft) {
			return;
		}

		const timeout = window.setTimeout(commit, SAVE_DELAY);

		return () => window.clearTimeout(timeout);
	}, [commit, draft]);

	// Flush on unmount. The debounce above CANCELS its pending write on cleanup, so
	// closing the dialog within SAVE_DELAY of an edit would otherwise discard it — a
	// rename made just before closing was silently lost.
	//
	// Writes through the store directly rather than `commit()`, because `refresh()`
	// would set state on an unmounted component.
	const storeRef = React.useRef(store);

	storeRef.current = store;

	React.useEffect(
		() => () => {
			if (latest.current) {
				void storeRef.current.putCharacter(latest.current);
			}
		},
		[]
	);

	const assets = React.useMemo(
		() =>
			library.all.reduce<Record<string, AssetMeta>>((result, asset) => {
				result[asset.id] = asset;
				return result;
			}, {}),
		[library.all]
	);

	async function handleCreate(name: string) {
		// Minted against asset names too. Scene YAML addresses assets by name and characters
		// by id out of one namespace, so `putCharacter` throws on a clash — a new character
		// should quietly become `mira-2` rather than fail.
		const id = uniqueName(slugify(name), await store.takenNames());

		setNewCharacterName('');
		setIdError(undefined);
		await store.putCharacter(defaultCharacter(id));
		setSelectedId(id);
		refresh();
	}

	async function handleDelete() {
		if (!draft) {
			return;
		}

		await store.removeCharacter(draft.id);
		setDraft(undefined);
		setSelectedId(undefined);
		refresh();
	}

	/** The passages whose scene YAML would change, with the text they would end up with. */
	function sceneRewrites(oldId: string, id: string) {
		if (!story) {
			return [];
		}

		return story.passages
			.map(passage => ({
				passage,
				text: renameSceneCharacter(passage.text, oldId, id)
			}))
			.filter(rewrite => rewrite.text !== rewrite.passage.text);
	}

	/**
	 * Move the character onto a new id, and optionally carry every scene that writes the
	 * old one along with it.
	 */
	async function applyRename(id: string, updateScenes: boolean) {
		if (!draft) {
			return;
		}

		const oldId = draft.id;
		const renamed = {...draft, id, name: id};

		setPendingRename(undefined);
		setIdError(undefined);

		// Ahead of the awaits: the debounced save reads this ref, and a timer that fires
		// between the write and the removal would put the old character straight back.
		latest.current = renamed;

		// A rename is deliberate, so a clash is loud: the store throws rather than handing
		// back `mira-2`, and an author who typed `mira` would go on writing `mira` in their
		// scenes. Caught here so it reads as a message instead of an unhandled rejection.
		try {
			await store.putCharacter(renamed);
		} catch (error) {
			latest.current = draft;
			setIdError(
				t('dialogs.slidersCharacters.idTaken', {
					id,
					message: (error as Error).message
				})
			);
			return;
		}

		await store.removeCharacter(oldId);

		if (updateScenes && story) {
			const rewrites = sceneRewrites(oldId, id);

			if (rewrites.length > 0) {
				// One action for the lot, so the whole rename is a single undo rather than
				// one per passage.
				undoableDispatch(
					{
						type: 'updatePassages',
						passageUpdates: rewrites.reduce<Record<string, {text: string}>>(
							(updates, rewrite) => {
								updates[rewrite.passage.id] = {text: rewrite.text};
								return updates;
							},
							{}
						),
						storyId: story.id
					},
					t('dialogs.slidersCharacters.renameChange', {id: oldId})
				);
			}
		}

		setDraft(renamed);
		setSelectedId(id);
		refresh();
	}

	/**
	 * Committing the title bar. Scenes address a character by id, so a rename that leaves
	 * them alone breaks them — the author is told how many passages are at stake and picks.
	 */
	function handleRenameId(value: string) {
		if (!draft) {
			return;
		}

		const id = slugify(value);

		setIdError(undefined);

		if (!id || id === draft.id || characters.some(other => other.id === id)) {
			return;
		}

		const rewrites = sceneRewrites(draft.id, id);

		if (rewrites.length === 0) {
			void applyRename(id, false);
			return;
		}

		setPendingRename({count: rewrites.length, id});
	}

	/** Is something else in this library already called this? Checked as the author types. */
	function idTaken(value: string) {
		const id = slugify(value);

		return id !== draft?.id && characters.some(other => other.id === id);
	}

	/**
	 * A drop or a pick of pose files. Many files, or one image shaped like a sheet, go to
	 * Import set for grouping and review; one ordinary image or one animated file is added
	 * straight away, as it always was.
	 */
	async function handleUploadPoses(files: File[]) {
		if (!draft) {
			return;
		}

		if (files.length > 1) {
			setImporting({files});
			return;
		}

		if (files.length === 1) {
			try {
				const decoded = await decodeImage(files[0]);

				URL.revokeObjectURL(decoded.url);

				if (!decoded.animated && looksLikeSheet(decoded, draft.size)) {
					setImporting({files});
					return;
				}
			} catch {
				// Not decodable here: let the store have its say, as before.
			}
		}

		await addPoses(files);
	}

	async function handleImportSet(set: ImportPose[], faces: 'left' | 'right') {
		const current = latest.current;

		if (!current) {
			return;
		}

		const poses = await importPoseSet(store, current, set);
		const updated: Character = {...(latest.current ?? current), poses};

		// Right is the default, stored as absent.
		if (faces === 'left') {
			updated.faces = 'left';
		} else {
			delete updated.faces;
		}

		setDraft(updated);
		latest.current = updated;
		await store.putCharacter(updated);
		setImporting(undefined);
		refresh();
	}

	async function handleAddSteps(name: string, files: File[]) {
		const current = latest.current;

		if (!current?.poses[name]) {
			return;
		}

		const ids = await stepImagesFromFiles(store, current, name, files);
		// Read again: the upload awaited, and the author may have edited meanwhile.
		const now = latest.current ?? current;

		if (ids.length === 0 || !now.poses[name]) {
			return;
		}

		const updated = {
			...now,
			poses: {...now.poses, [name]: appendSteps(now.poses[name], ids)}
		};

		setDraft(updated);
		latest.current = updated;
		await store.putCharacter(updated);
		refresh();
	}

	async function addPoses(files: File[]) {
		if (!draft) {
			return;
		}

		const poses = await posesFromFiles(store, draft, files);
		const updated = {...draft, poses};

		setDraft(updated);
		await store.putCharacter(updated);
		refresh();
	}

	/**
	 * Pose images are ordinary assets, so editing one is just the asset editor pointed at
	 * it. Replacing reports back the id it came in with and needs no repoint; saving as new
	 * reports a new id, and the pose has to follow or the edit goes nowhere visible.
	 *
	 * A pose with steps has no one image to edit; the list disables the button for it.
	 */
	function handleEditPose(name: string) {
		const pose = latest.current?.poses[name];

		if (!pose?.asset) {
			return;
		}

		dispatch({
			type: 'addDialog',
			component: AssetEditorDialog,
			maximized: true,
			props: {
				assetId: pose.asset,
				onSaved: async (assetId: string) => {
					// Read through the ref: the editor outlives any render this closed over.
					const current = latest.current;

					if (current && current.poses[name] && current.poses[name].asset !== assetId) {
						const updated = {
							...current,
							poses: {
								...current.poses,
								[name]: {...current.poses[name], asset: assetId}
							}
						};

						setDraft(updated);
						await store.putCharacter(updated);
					}

					refresh();
				}
			}
		});
	}

	const tabIndex = Math.max(
		0,
		characters.findIndex(character => character.id === activeId)
	);

	useCommand({
		id: 'slidersCharacters.create',
		label: t('hotkeys.commands.slidersCharacters.create'),
		run: () => setCreateOpen(true),
		scope: 'sliders-characters'
	});

	useCommand({
		enabled: !!draft,
		id: 'slidersCharacters.delete',
		label: t('hotkeys.commands.slidersCharacters.delete'),
		run: () => setDeleteOpen(true),
		scope: 'sliders-characters'
	});

	// Rides in the tab row rather than in the button bar above it: creating a character and
	// choosing one are the same decision, and the bar is for what to do WITH the character
	// already chosen.
	const newCharacterButton = (
		<PromptButton
			commandId="slidersCharacters.create"
			icon={<IconUserPlus />}
			label={t('dialogs.slidersCharacters.newCharacter')}
			onChange={event => setNewCharacterName(event.target.value)}
			onChangeOpen={setCreateOpen}
			onSubmit={handleCreate}
			open={createOpen}
			prompt={t('dialogs.slidersCharacters.newCharacterPrompt')}
			value={newCharacterName}
			variant="create"
		/>
	);

	return (
		<DialogCard
			{...other}
			className="sliders-characters-dialog"
			focusOnOpen
			// The ID is the only name a character has, and it is what scene YAML writes,
			// so the title bar renames it in place — the same gesture the passage editor
			// and the story map already use for a passage name.
			headerDisplayLabel={
				draft ? (
					<>
						{t('dialogs.slidersCharacters.title')}:{' '}
						<EditableTitle
							editable
							nameTaken={idTaken}
							onRename={handleRenameId}
							title={t('dialogs.slidersCharacters.renameIdTitle')}
							value={draft.id}
						/>
					</>
				) : undefined
			}
			headerLabel={t('dialogs.slidersCharacters.title')}
			hotkeyScope="sliders-characters"
			maximizable
		>
			{draft && (
				<ButtonBar>
					<ConfirmButton
						commandId="slidersCharacters.delete"
						confirmVariant="danger"
						icon={<IconTrash />}
						label={t('common.delete')}
						onChangeOpen={setDeleteOpen}
						onConfirm={handleDelete}
						open={deleteOpen}
						prompt={t('dialogs.slidersCharacters.deletePrompt', {
							name: draft.id
						})}
					/>
				</ButtonBar>
			)}
			{pendingRename && draft && (
				<CardContent>
					<p className="sliders-characters-rename" role="alert">
						{t('dialogs.slidersCharacters.renamePrompt', {
							count: pendingRename.count,
							id: pendingRename.id,
							oldId: draft.id
						})}
					</p>
					{/* Updating the scenes is what the author almost always means, so it is
					    the create-coloured default. Renaming the ID alone stays on offer for
					    a character nobody has written into a scene on purpose yet. */}
					<ButtonBar>
						<IconButton
							icon={<IconTag />}
							label={t('dialogs.slidersCharacters.renameUpdateScenes', {
								count: pendingRename.count
							})}
							onClick={() => void applyRename(pendingRename.id, true)}
							variant="create"
						/>
						<IconButton
							icon={<IconPencil />}
							label={t('dialogs.slidersCharacters.renameIdOnly')}
							onClick={() => void applyRename(pendingRename.id, false)}
						/>
						<IconButton
							icon={<IconX />}
							label={t('common.cancel')}
							onClick={() => setPendingRename(undefined)}
						/>
					</ButtonBar>
				</CardContent>
			)}
			{idError && (
				<CardContent>
					<p className="sliders-characters-error" role="alert">
						{idError}
					</p>
				</CardContent>
			)}
			{characters.length === 0 ? (
				<>
					<div className="sliders-characters-tabrow">{newCharacterButton}</div>
					<CardContent>
						<p>{t('dialogs.slidersCharacters.none')}</p>
					</CardContent>
				</>
			) : (
				<Tabs
					className="react-tabs sliders-characters-tabs"
					onSelect={index => setSelectedId(characters[index]?.id)}
					selectedIndex={tabIndex}
					selectedTabClassName="selected"
				>
					{/* react-tabs walks its children for Tab/TabList/TabPanel nodes rather
					    than expecting them at the top, so the row can hold the create button
					    beside the list without confusing the tab indexes. */}
					<div className="sliders-characters-tabrow">
						{newCharacterButton}
						<TabList className="sliders-tablist">
							{characters.map(character => (
								<Tab className="sliders-tab" key={character.id}>
									{character.name}
								</Tab>
							))}
						</TabList>
					</div>
					{characters.map(character => (
						<TabPanel key={character.id}>
							{draft && draft.id === character.id && importing && (
								<ImportSet
									character={draft}
									initialFiles={importing.files}
									onCancel={() => setImporting(undefined)}
									onImport={handleImportSet}
								/>
							)}
							{draft && draft.id === character.id && !importing && (
								<CharacterEditor
									assets={assets}
									character={draft}
									onChange={setDraft}
									onCommit={commit}
									onAddSteps={(name, files) => void handleAddSteps(name, files)}
									onEditPose={handleEditPose}
									onImportSet={files => setImporting({files})}
									onUploadPoses={files => void handleUploadPoses(files)}
								/>
							)}
						</TabPanel>
					))}
				</Tabs>
			)}
		</DialogCard>
	);
};
