import {
	defaultCharacter,
	nameFromFilename,
	newFrameAnchors,
	slugify
} from '@sliders/asset-store';
import {AssetMeta, Character} from '@sliders/scene-types';
import {IconTag, IconTrash, IconUserPlus} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Tab, TabList, TabPanel, Tabs} from 'react-tabs';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {ConfirmButton} from '../../components/control/confirm-button';
import {PromptButton} from '../../components/control/prompt-button';
import {useCommand} from '../../hotkeys';
import {AssetEditorDialog} from '../asset-editor';
import {useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {useAssetLibrary} from '../sliders-assets/asset-store-context';
import {CharacterEditor} from './character-editor';
import './sliders-characters.css';

/** How long a change sits before it's written to the asset store. */
const SAVE_DELAY = 400;

function uniqueFrameName(
	preferred: string,
	frames: Character['frames']
): string {
	if (!frames[preferred]) {
		return preferred;
	}

	let suffix = 2;

	while (frames[`${preferred}-${suffix}`]) {
		suffix++;
	}

	return `${preferred}-${suffix}`;
}

export interface SlidersCharactersDialogProps extends DialogComponentProps {
	/** Character to open on. Set when the asset manager launches this dialog. */
	characterId?: string;
}

export const SlidersCharactersDialog: React.FC<SlidersCharactersDialogProps> = props => {
	const {characterId, ...other} = props;
	const library = useAssetLibrary();
	const {dispatch} = useDialogsContext();
	const [createOpen, setCreateOpen] = React.useState(false);
	const [deleteOpen, setDeleteOpen] = React.useState(false);
	const [draft, setDraft] = React.useState<Character>();
	const [newCharacterName, setNewCharacterName] = React.useState('');
	const [newId, setNewId] = React.useState('');
	const [selectedId, setSelectedId] = React.useState(characterId);
	const {t} = useTranslation();

	const {characters, refresh, store} = library;
	const activeId = selectedId ?? characters[0]?.id;

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
		const id = slugify(name);

		setNewCharacterName('');
		await store.putCharacter(defaultCharacter(id, name.trim() || id));
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

	/**
	 * Renaming an ID does NOT rewrite passage references — that needs the scene index,
	 * which doesn't exist yet (spec 04). The prompt says so.
	 */
	async function handleChangeId(value: string) {
		if (!draft) {
			return;
		}

		const id = slugify(value);

		setNewId('');

		if (!id || id === draft.id || characters.some(other => other.id === id)) {
			return;
		}

		const renamed = {...draft, id};

		await store.putCharacter(renamed);
		await store.removeCharacter(draft.id);
		setDraft(renamed);
		setSelectedId(id);
		refresh();
	}

	async function handleUploadFrames(files: File[]) {
		if (!draft) {
			return;
		}

		const frames = {...draft.frames};

		for (const file of files) {
			try {
				const result = await store.putAsset(file, {
					kind: 'frame',
					ownerCharacter: draft.id
				});

				// A new frame comes in rigged, copying whatever the character's other frames
				// already use — the poses of one sprite sheet are variations on one drawing,
				// so that is far closer to right than the bare defaults, and the author
				// nudges the anchors that actually moved.
				frames[uniqueFrameName(slugify(nameFromFilename(file.name)), frames)] = {
					anchors: newFrameAnchors({frames}),
					asset: result.id
				};
			} catch (error) {
				console.error(`Could not add ${file.name} as a frame`, error);
			}
		}

		const updated = {...draft, frames};

		setDraft(updated);
		await store.putCharacter(updated);
		refresh();
	}

	/**
	 * Frames are ordinary assets, so editing one is just the asset editor pointed at it.
	 * Replacing reports back the id it came in with and needs no repoint; saving as new
	 * reports a new id, and the frame has to follow or the edit goes nowhere visible.
	 */
	function handleEditFrame(name: string) {
		const frame = latest.current?.frames[name];

		if (!frame) {
			return;
		}

		dispatch({
			type: 'addDialog',
			component: AssetEditorDialog,
			maximized: true,
			props: {
				assetId: frame.asset,
				onSaved: async (assetId: string) => {
					// Read through the ref: the editor outlives any render this closed over.
					const current = latest.current;

					if (current && current.frames[name] && current.frames[name].asset !== assetId) {
						const updated = {
							...current,
							frames: {
								...current.frames,
								[name]: {...current.frames[name], asset: assetId}
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

	return (
		<DialogCard
			{...other}
			className="sliders-characters-dialog"
			focusOnOpen
			headerLabel={t('dialogs.slidersCharacters.title')}
			hotkeyScope="sliders-characters"
			maximizable
		>
			<ButtonBar>
				<PromptButton
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
				{draft && (
					<>
						<PromptButton
							icon={<IconTag />}
							label={t('dialogs.slidersCharacters.changeId', {id: draft.id})}
							onChange={event => setNewId(event.target.value)}
							onSubmit={handleChangeId}
							prompt={t('dialogs.slidersCharacters.changeIdPrompt')}
							value={newId}
						/>
						<ConfirmButton
							confirmVariant="danger"
							icon={<IconTrash />}
							label={t('common.delete')}
							onChangeOpen={setDeleteOpen}
							onConfirm={handleDelete}
							open={deleteOpen}
							prompt={t('dialogs.slidersCharacters.deletePrompt', {
								name: draft.name
							})}
						/>
					</>
				)}
			</ButtonBar>
			{characters.length === 0 ? (
				<CardContent>
					<p>{t('dialogs.slidersCharacters.none')}</p>
				</CardContent>
			) : (
				<Tabs
					onSelect={index => setSelectedId(characters[index]?.id)}
					selectedIndex={tabIndex}
					selectedTabClassName="selected"
				>
					<TabList className="sliders-tablist">
						{characters.map(character => (
							<Tab className="sliders-tab" key={character.id}>
								{character.name}
							</Tab>
						))}
					</TabList>
					{characters.map(character => (
						<TabPanel key={character.id}>
							{draft && draft.id === character.id && (
								<CharacterEditor
									assets={assets}
									character={draft}
									onChange={setDraft}
									onCommit={commit}
									onEditFrame={handleEditFrame}
									onUploadFrames={handleUploadFrames}
								/>
							)}
						</TabPanel>
					))}
				</Tabs>
			)}
		</DialogCard>
	);
};
