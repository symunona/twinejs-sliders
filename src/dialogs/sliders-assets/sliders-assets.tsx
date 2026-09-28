import {
	AssetRecord,
	CollectionRecord,
	LibraryEngine,
	NameTakenError,
	RevEntry,
	ActivityEntry
} from '@sliders/asset-library';
import {
	blobBytes,
	defaultCharacter,
	nameFromFilename,
	prepareUpload,
	slugify,
	uniqueName
} from '@sliders/asset-store';
import {AssetKind, Character} from '@sliders/scene-types';
import {
	IconAlertTriangle,
	IconArrowLeft,
	IconTrash,
	IconUserPlus,
	IconX
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {
	LabeledMenuItem,
	MenuSeparator
} from '../../components/control/menu-button';
import {PromptButton} from '../../components/control/prompt-button';
import {TextInput} from '../../components/control/text-input';
import {TagCardButton} from '../../components/tag/tag-card-button';
import {useCommand} from '../../hotkeys';
import {
	useLibraryEngine,
	useLibraryStatus
} from '../../store/asset-library/library-provider';
import {
	characterFromRecord,
	EditScope,
	isSharedAssetError,
	libraryMetas,
	SharedInfo
} from '../../store/asset-library/story-asset-store';
import {useStoriesContext} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {renameSceneRefs} from '../../util/rename-scene-refs';
import {AssetEditorDialog} from '../asset-editor';
// Deep import, not the `../asset-generator` barrel: the barrel pulls the whole generator
// (and its store) into this dialog's module graph. Only the dialog component is wanted.
import {AssetGeneratorDialog} from '../asset-generator/asset-generator';
import {useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {SlidersCharactersDialog} from '../sliders-characters';
import {AssetTile} from './asset-tile';
import {
	useAssetLibrary,
	useAssetScope,
	useLibraryChange
} from './asset-store-context';
import {characterFromFile, posesFromFiles} from './character-poses';
import {CharacterTile} from './character-tile';
import {onAssetFocus, takePendingAssetFocus} from './focus-request';
import type {AssetFocusRequest} from './focus-request';
import {CollectionHeader} from './library/collection-header';
import {ConflictPanel} from './library/conflict-panel';
import {DupeChoice, DupeDialog, dupeMatch} from './library/dupe-dialog';
import {DuplicatesView} from './library/duplicates-view';
import {
	ActivityPanel,
	MovePanel,
	UsagesPanel,
	VersionsPanel
} from './library/library-panels';
import {LibraryRail} from './library/library-rail';
import {
	ALL,
	collectionLabel,
	collectionSync,
	duplicateGroups,
	librarySnapshot,
	MINE,
	RailSelection,
	recordSync,
	savedSelection,
	saveSelection,
	selectedCollection
} from './library/library-model';
import type {MergeRewrite} from './library/merge-plan';
import {TileBadges} from './library/tile-badges';
import {SharedPrompt, sharedStoriesText} from './shared-prompt';
import {UploadButton} from './upload-button';
import {UploadDropZone} from './upload-drop-zone';
import {useAssetUsage} from './use-asset-usage';
import {useSceneRefRename} from './use-scene-ref-rename';
import {useSyncedRefs} from './use-synced-refs';
import './sliders-assets.css';
import './library/library.css';

/** Kind filter row, in the order spec 03 draws it. `undefined` = characters. */
const TABS: {kind?: AssetKind; labelKey: string}[] = [
	{kind: 'bg', labelKey: 'dialogs.slidersAssets.backgrounds'},
	{kind: 'object', labelKey: 'dialogs.slidersAssets.objects'},
	{kind: undefined, labelKey: 'dialogs.slidersAssets.characters'},
	{kind: 'fx', labelKey: 'dialogs.slidersAssets.fx'},
	{kind: 'sound', labelKey: 'dialogs.slidersAssets.sounds'}
];

type Panel =
	| {kind: 'duplicates'}
	| {kind: 'conflicts'; collection?: string; recordId?: string}
	| {kind: 'activity'; collection: string}
	| {kind: 'versions'; id: string}
	| {kind: 'usages'; id: string}
	| {kind: 'move'; id: string};

type Ask =
	| {
			kind: 'shared';
			info: SharedInfo;
			run: (scope: EditScope) => Promise<void>;
			allowFork?: boolean;
			updateAllLabel?: string;
			message?: string;
	  }
	| {
			kind: 'confirm';
			message: string;
			buttons: {label: string; danger?: boolean; run: () => void}[];
	  };

interface DupeAsk {
	fileName: string;
	report: Parameters<typeof DupeDialog>[0]['report'];
	suggestedName: string;
	resolve: (choice: DupeChoice | undefined) => void;
}

export type SlidersAssetsDialogProps = DialogComponentProps;

/**
 * The Library (asset-library-1-architecture.md, "Library UI"): collections rail on the
 * left, the shown collection's grid on the right. Replaces the per-story Assets dialog
 * and its Import tab — reuse is attaching a collection now, not copying bytes.
 */
export const SlidersAssetsDialog: React.FC<SlidersAssetsDialogProps> = props => {
	const {dispatch} = useDialogsContext();
	const storyId = useAssetScope();
	const library = useAssetLibrary();
	const store = library.store;
	const engine = useLibraryEngine();
	const version = useLibraryChange();
	const status = useLibraryStatus();
	const {stories} = useStoriesContext();
	const {dispatch: storiesDispatch} = useUndoableStoriesContext();
	const renameScenes = useSceneRefRename();
	// Art no scene names. Badge it, don't change it.
	const synced = useSyncedRefs();
	const usage = useAssetUsage();
	const {t} = useTranslation();
	const story = stories.find(candidate => candidate.id === storyId);
	const [focus, setFocus] = React.useState<AssetFocusRequest>();
	const [newCharacterName, setNewCharacterName] = React.useState('');
	const [error, setError] = React.useState<string>();
	const [notice, setNotice] = React.useState<string>();
	const [newCharacterOpen, setNewCharacterOpen] = React.useState(false);
	const [search, setSearch] = React.useState('');
	const [tabIndex, setTabIndex] = React.useState(0);
	const [tagFilter, setTagFilter] = React.useState<string[]>([]);
	const [selection, setSelection] = React.useState<RailSelection>(() =>
		savedSelection(storyId)
	);
	const selectionStory = React.useRef(storyId);

	// Another story → its own last selection; otherwise remember this one.
	React.useEffect(() => {
		if (selectionStory.current !== storyId) {
			selectionStory.current = storyId;
			setSelection(savedSelection(storyId));
			return;
		}

		saveSelection(storyId, selection);
	}, [storyId, selection]);
	const [panel, setPanel] = React.useState<Panel>();
	const [ask, setAsk] = React.useState<Ask>();
	const [dupeAsk, setDupeAsk] = React.useState<DupeAsk>();
	const searchField = React.useRef<HTMLInputElement>(null);
	const {kind} = TABS[tabIndex] ?? {};
	const searchText = search.trim().toLowerCase();

	const snapshot = React.useMemo(
		() => librarySnapshot(engine, storyId),
		// `version` is the engine's change signal.
		[engine, storyId, version]
	);
	const shownId = selectedCollection(snapshot, selection);
	const shown = shownId ? engine?.get(shownId, 'collection') : undefined;
	const labelOf = React.useCallback(
		(id: string) =>
			id === snapshot.own?.id
				? t('dialogs.library.mine', {name: story?.name ?? ''})
				: collectionLabel(engine?.get(id, 'collection'), name =>
						t('dialogs.library.storyCollection', {name})
				  ),
		[engine, snapshot.own?.id, story?.name, t]
	);
	const storyName = React.useCallback(
		(id: string) => stories.find(candidate => candidate.id === id)?.name,
		[stories]
	);

	/** Asset records this pane shows, before the kind/search/tag filters. */
	const shownAssets = React.useMemo(() => {
		if (!engine) {
			return [];
		}

		if (selection === ALL) {
			return engine.assets();
		}

		return shownId ? engine.assets(shownId) : [];
		// `version`: re-read on every library change.
	}, [engine, selection, shownId, version]);
	const metas = React.useMemo(
		() =>
			engine
				? libraryMetas(engine, storyId, shownAssets).filter(
						meta => !meta.ownerCharacter
				  )
				: [],
		[engine, shownAssets, storyId]
	);
	const shownCharacters = React.useMemo(() => {
		if (!engine) {
			return [];
		}

		const records =
			selection === ALL
				? engine.characters()
				: shownId
				? engine.characters(shownId)
				: [];

		return records.map(record => ({character: characterFromRecord(record), record}));
	}, [engine, selection, shownId, version]);
	const resolver = React.useMemo(
		() => engine?.resolver(storyId),
		[engine, storyId, version]
	);
	const allTags = React.useMemo(
		() =>
			Array.from(
				new Set([...library.tags, ...metas.flatMap(meta => meta.tags)])
			).sort((a, b) => a.localeCompare(b)),
		[library.tags, metas]
	);
	const dupeGroups = React.useMemo(() => {
		if (!engine) {
			return [];
		}

		const poseImages = new Set(
			engine
				.characters()
				.flatMap(character =>
					Object.values(character.poses ?? {}).flatMap(pose => [
						...(pose.asset ? [pose.asset] : []),
						...(pose.steps ?? []).map(step => step.asset)
					])
				)
		);

		return duplicateGroups(engine.assets(), asset => poseImages.has(asset.id));
	}, [engine, version]);

	const matchingAssets = metas.filter(
		asset =>
			asset.kind === kind &&
			(!searchText || asset.name.toLowerCase().includes(searchText)) &&
			(tagFilter.length === 0 || asset.tags.some(tag => tagFilter.includes(tag)))
	);
	const matchingCharacters = shownCharacters.filter(
		({character}) =>
			(!searchText ||
				character.name.toLowerCase().includes(searchText) ||
				character.id.includes(searchText)) &&
			(tagFilter.length === 0 ||
				character.tags.some(tag => tagFilter.includes(tag)))
	);

	/**
	 * A double click on the scene stage asks for the entity it hit, by its scene `ref`:
	 * a character id or an asset name out of one namespace, resolved in the story's order.
	 */
	const focusedCharacter = focus
		? library.characters.find(character => character.id === focus.ref)
		: undefined;
	const focusedAsset =
		focus && !focusedCharacter
			? library.visible.find(asset => asset.name === focus.ref)
			: undefined;

	React.useEffect(() => {
		// The dialog may be opening because of this request, published before anything
		// was here to hear it.
		setFocus(takePendingAssetFocus());

		return onAssetFocus(setFocus);
	}, []);

	React.useEffect(() => {
		if (!focus) {
			return;
		}

		// A tile that is filtered out cannot be scrolled to.
		setSearch('');
		setTagFilter([]);
		setPanel(undefined);

		if (focusedCharacter) {
			setTabIndex(TABS.findIndex(tab => !tab.kind));

			const home = resolver?.character(focusedCharacter.id)?.collection;

			setSelection(!home || home === snapshot.own?.id ? MINE : home);
		} else if (focusedAsset) {
			setTabIndex(TABS.findIndex(tab => tab.kind === focusedAsset.kind));
			const home = engine?.get(focusedAsset.id, 'asset')?.collection;

			setSelection(!home || home === snapshot.own?.id ? MINE : home);
		}
		// Keyed on the request and what it resolved to: the library can arrive after it.
	}, [focus, focusedAsset, focusedCharacter]);

	// A collection that went away (deleted, detached elsewhere) falls back to Mine.
	React.useEffect(() => {
		if (
			engine &&
			selection !== MINE &&
			selection !== ALL &&
			!engine.get(selection, 'collection')
		) {
			setSelection(MINE);
		}
	}, [engine, selection, version]);

	function openAssetEditor(assetId: string) {
		dispatch({
			type: 'addDialog',
			component: AssetEditorDialog,
			// Editing needs the room--the preview is the point.
			maximized: true,
			props: {assetId}
		});
	}

	function openGenerator() {
		dispatch({
			type: 'addDialog',
			component: AssetGeneratorDialog,
			// The history grid and the model list both want room.
			maximized: true
		});
	}

	function openCharacterEditor(characterId?: string) {
		dispatch({
			type: 'addDialog',
			component: SlidersCharactersDialog,
			props: {characterId}
		});
	}

	/** Runs an action; a shared target asks first, then reruns it with the scope. */
	async function withShared(
		run: (scope?: EditScope) => Promise<void>,
		options: {
			allowFork?: boolean;
			updateAllLabel?: string;
			message?: (info: SharedInfo) => string;
		} = {}
	) {
		setError(undefined);

		try {
			await run(undefined);
		} catch (runError) {
			if (isSharedAssetError(runError)) {
				setAsk({
					allowFork: options.allowFork,
					info: runError.info,
					kind: 'shared',
					message: options.message?.(runError.info),
					run,
					updateAllLabel: options.updateAllLabel
				});
				return;
			}

			console.error('Library action failed', runError);
			setError(t('dialogs.library.actionError'));
		}
	}

	async function answerShared(scope: EditScope | undefined) {
		const current = ask;

		setAsk(undefined);

		if (current?.kind !== 'shared' || !scope) {
			return;
		}

		try {
			await current.run(scope);
		} catch (runError) {
			console.error('Library action failed', runError);
			setError(t('dialogs.library.actionError'));
		}
	}

	/** Where an upload lands: the shown collection, else the story's own. */
	async function uploadTarget(): Promise<string> {
		return shownId && selection !== MINE && selection !== ALL
			? shownId
			: store.ownCollection();
	}

	function askDupe(request: Omit<DupeAsk, 'resolve'>) {
		return new Promise<DupeChoice | undefined>(resolve =>
			setDupeAsk({...request, resolve})
		);
	}

	/**
	 * File onto the grid → the shown collection. Exact / pixel / perceptual matches ask
	 * (plan 1, "Upload dupe dialog"); everything else just lands.
	 */
	async function handleUpload(files: File[]) {
		if (!engine) {
			return;
		}

		setError(undefined);

		const failed: string[] = [];
		const collection = await uploadTarget();
		const own = collection === snapshot.own?.id || !snapshot.own;

		for (const file of files) {
			try {
				const prepared = await prepareUpload(file);
				const bytes = new Uint8Array(await blobBytes(prepared.blob));
				const assetKind: AssetKind = prepared.audio ? 'sound' : kind ?? 'bg';
				// Own collection: the story's whole view is one namespace. Elsewhere, the
				// collection's own names.
				const taken = own
					? new Set((await store.view()).names)
					: new Set([
							...engine.assets(collection).map(asset => asset.name),
							...engine.characters(collection).map(character => character.charId)
					  ]);
				const suggestedName = uniqueName(nameFromFilename(file.name), taken);
				const report = await engine.findDuplicates(bytes, prepared.mime);
				let choice: DupeChoice | undefined = {kind: 'separate'};

				if (dupeMatch(report)) {
					choice = await askDupe({fileName: file.name, report, suggestedName});
					setDupeAsk(undefined);
				}

				if (!choice) {
					continue;
				}

				if (choice.kind === 'use') {
					const home = choice.asset.collection;

					if (!snapshot.viewIds.includes(home)) {
						await store.ownCollection();
						engine.bind(storyId, [
							...snapshot.attached.map(attached => attached.id),
							home
						]);
					}

					continue;
				}

				await engine.addAsset(bytes, prepared.mime, {
					allowDuplicate: true,
					animated: prepared.animated,
					collection,
					h: prepared.height,
					kind: assetKind,
					name:
						choice.kind === 'alias'
							? uniqueName(choice.name, taken)
							: suggestedName,
					tags: [],
					w: prepared.width,
					...(prepared.duration !== undefined
						? {duration: prepared.duration}
						: {})
				});
			} catch (uploadError) {
				console.error(`Could not upload ${file.name}`, uploadError);
				failed.push(file.name);
			}
		}

		if (failed.length) {
			setError(
				t('dialogs.slidersAssets.uploadError', {names: failed.join(', ')})
			);
		}
	}

	/**
	 * Characters aren't an `AssetKind`. Dropped on the characters filter, each file
	 * becomes a new character (in Mine); dropped on a tile, poses of that character.
	 */
	async function handleCharacterDrop(files: File[]) {
		// One free id minted per file without asking the store again.
		const takenIds = await library.store.takenNames();

		for (const file of files) {
			try {
				await characterFromFile(library.store, file, takenIds);
			} catch (dropError) {
				console.error(`Could not add ${file.name} as a character`, dropError);
			}
		}
	}

	async function handleDropOnCharacter(character: Character, files: File[]) {
		const poses = await posesFromFiles(library.store, character, files);

		await withShared(scope =>
			library.store
				.putCharacter({...character, poses}, scope ? {scope} : {})
				.then(() => undefined)
		);
	}

	async function handleCreateCharacter(name: string) {
		const id = uniqueName(slugify(name), await library.store.takenNames());

		await library.store.putCharacter(defaultCharacter(id));
		setNewCharacterName('');
		openCharacterEditor(id);
	}

	useCommand({
		enabled: !kind,
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

	/** Other stories on this device that should follow a name change. */
	function rewriteOtherStories(info: SharedInfo, from: string, to: string) {
		for (const usage of info.stories) {
			const other = stories.find(candidate => candidate.id === usage.storyId);

			if (!other) {
				continue;
			}

			const passageUpdates: Record<string, {text: string}> = {};

			for (const passage of other.passages) {
				const text = renameSceneRefs(passage.text, from, to);

				if (text !== passage.text) {
					passageUpdates[passage.id] = {text};
				}
			}

			if (Object.keys(passageUpdates).length) {
				storiesDispatch(
					{passageUpdates, storyId: other.id, type: 'updatePassages'},
					t('dialogs.slidersAssets.renameChange', {name: from})
				);
			}
		}
	}

	async function handleRenameAsset(
		id: string,
		name: string,
		updateScenes = false
	) {
		const oldName = engine?.get(id, 'asset')?.name;
		let info: SharedInfo | undefined;

		await withShared(
			async scope => {
				if (scope && !info) {
					info = await store.sharedInfo(id);
				}

				await store.update(id, {name}, scope ? {scope} : {});

				if (updateScenes && oldName) {
					renameScenes(oldName, name);
				}

				// Update All also carries the other stories on this device along.
				if (scope === 'all' && oldName && info) {
					rewriteOtherStories(info, oldName, name);
				}
			},
			{
				message: shared =>
					t('dialogs.library.renameShared', {
						collection: shared.collection.name,
						count: shared.stories.length,
						name: shared.name,
						stories: sharedStoriesText(shared)
					})
			}
		);
	}

	async function handleChangeTags(id: string, tags: string[]) {
		await withShared(scope =>
			store.update(id, {tags}, scope ? {scope} : {}).then(() => undefined)
		);
	}

	async function handleChangeCharacterTags(character: Character, tags: string[]) {
		await withShared(scope =>
			store
				.putCharacter({...character, tags}, scope ? {scope} : {})
				.then(() => undefined)
		);
	}

	async function handleDeleteCharacter(id: string) {
		await withShared(scope => store.removeCharacter(id, scope ? {scope} : {}), {
			allowFork: false,
			updateAllLabel: t('dialogs.library.deleteForEveryone')
		});
	}

	async function handleDeleteAsset(asset: AssetRecord) {
		const info = await store.sharedInfo(asset.id);

		if (info?.shared) {
			setAsk({
				allowFork: false,
				info,
				kind: 'shared',
				message: t('dialogs.library.deleteShared', {
					collection: info.collection.name,
					count: info.stories.length,
					name: info.name,
					stories: sharedStoriesText(info)
				}),
				run: scope => store.remove(asset.id, {scope}),
				updateAllLabel: t('dialogs.library.deleteForEveryone')
			});
			return;
		}

		setAsk({
			buttons: [
				{
					danger: true,
					label: t('common.delete'),
					run: () => void store.remove(asset.id)
				}
			],
			kind: 'confirm',
			message: t('dialogs.slidersAssets.deletePrompt', {name: asset.name})
		});
	}

	/**
	 * Move (or copy) to another collection. Stories that use it and do not attach the
	 * target would lose it: listed, with an offer to attach the target to them.
	 */
	function moveAsset(
		lib: LibraryEngine,
		assetId: string,
		target: string,
		copy: boolean
	) {
		const asset = lib.get(assetId, 'asset');

		setError(undefined);
		setPanel(undefined);

		if (!asset || asset.collection === target) {
			return;
		}

		const targetName = labelOf(target);
		const run = (attachTo: string[]) => {
			try {
				if (copy) {
					lib.copy(assetId, {collection: target});
				} else {
					lib.move(assetId, target);
				}

				for (const id of attachTo) {
					const binding = lib.binding(id);

					if (binding) {
						lib.bind(id, [...(binding.collections ?? []), target]);
					}
				}

				setNotice(
					t(copy ? 'dialogs.library.copied' : 'dialogs.library.moved', {
						collection: targetName,
						name: asset.name
					})
				);
			} catch (moveError) {
				setError(
					moveError instanceof NameTakenError
						? t('dialogs.library.moveNameTaken', {
								collection: targetName,
								name: asset.name
						  })
						: t('dialogs.library.actionError')
				);
			}
		};

		if (copy) {
			run([]);
			return;
		}

		const losing = lib.usage(assetId).filter(id => {
			const binding = lib.binding(id);

			return (
				binding &&
				binding.own !== target &&
				!(binding.collections ?? []).includes(target)
			);
		});

		if (losing.length === 0) {
			run([]);
			return;
		}

		setAsk({
			buttons: [
				{
					label: t('dialogs.library.moveAndAttach', {count: losing.length}),
					run: () => run(losing)
				},
				{danger: true, label: t('dialogs.library.moveAnyway'), run: () => run([])}
			],
			kind: 'confirm',
			message: t('dialogs.library.moveLosing', {
				collection: targetName,
				count: losing.length,
				name: asset.name,
				stories: losing
					.map(id => storyName(id) ?? id.slice(0, 8))
					.join(', ')
			})
		});
	}

	async function restoreVersion(asset: AssetRecord, rev: RevEntry) {
		if (!engine) {
			return;
		}

		const info = await store.sharedInfo(asset.id);
		const restore = async () => {
			await engine.restoreRev(rev.record, 'picture');
			setPanel(undefined);
		};

		if (info && !info.canUpdateAll) {
			setError(t('dialogs.library.lockedRestore', {name: asset.name}));
			return;
		}

		if (info?.stories.length) {
			setAsk({
				allowFork: false,
				info,
				kind: 'shared',
				run: restore,
				updateAllLabel: t('dialogs.library.versions.restoreForEveryone')
			});
			return;
		}

		try {
			await restore();
		} catch (restoreError) {
			console.error('Could not restore the version', restoreError);
			setError(t('dialogs.library.actionError'));
		}
	}

	async function revert(entry: ActivityEntry) {
		if (!engine) {
			return;
		}

		setError(undefined);

		try {
			if (!entry.previous) {
				engine.delete(entry.id, entry.type);
			} else {
				await engine.restoreRev(entry.previous, 'all');
			}
		} catch (revertError) {
			console.error('Could not revert', revertError);
			setError(t('dialogs.library.actionError'));
		}
	}

	function applyRewrites(rewrites: MergeRewrite[]) {
		for (const rewrite of rewrites) {
			storiesDispatch(
				{
					passageUpdates: rewrite.passageUpdates,
					storyId: rewrite.storyId,
					type: 'updatePassages'
				},
				t('dialogs.library.dupes.undo')
			);
		}
	}

	function menuFor(asset: AssetRecord): (LabeledMenuItem | MenuSeparator)[] {
		const own = asset.collection === snapshot.own?.id;
		const items: (LabeledMenuItem | MenuSeparator)[] = [
			{
				label: t('dialogs.library.menu.move'),
				onClick: () => setPanel({id: asset.id, kind: 'move'})
			}
		];

		if (!own) {
			items.push({
				label: t('dialogs.library.menu.fork'),
				onClick: () =>
					void store.forkAsset(asset.id).then(
						fork => {
							setNotice(t('dialogs.library.forked', {name: fork.name}));
						},
						forkError => {
							console.error('Could not fork', forkError);
							setError(
								forkError instanceof NameTakenError
									? t('dialogs.library.forkTaken', {name: asset.name})
									: t('dialogs.library.actionError')
							);
						}
					)
			});
		}

		if (own && asset.sourceAsset) {
			items.push({
				label: t('dialogs.library.menu.unfork'),
				onClick: () => engine?.unfork(asset.id)
			});
		}

		items.push(
			{
				label: t('dialogs.library.menu.usages'),
				onClick: () => setPanel({id: asset.id, kind: 'usages'})
			},
			{
				label: t('dialogs.library.menu.versions'),
				onClick: () => setPanel({id: asset.id, kind: 'versions'})
			},
			{separator: true},
			{
				label: t('common.delete'),
				onClick: () => void handleDeleteAsset(asset),
				variant: 'danger'
			}
		);

		return items;
	}

	/** Collection-level name check for a tile's rename prompt. */
	function nameTaken(asset: AssetRecord, name: string): boolean {
		if (!engine) {
			return false;
		}

		const lowered = name.toLowerCase();
		const inCollection = [
			...engine.assets(asset.collection).filter(other => other.id !== asset.id).map(other => other.name),
			...engine.characters(asset.collection).map(character => character.charId)
		];
		const inView =
			asset.collection === snapshot.own?.id
				? library.all
						.filter(other => other.id !== asset.id)
						.map(other => other.name)
						.concat(library.characters.map(character => character.id))
				: [];

		return [...inCollection, ...inView].some(
			other => other.toLowerCase() === lowered
		);
	}

	const sync =
		engine &&
		collectionSync(engine, selection === ALL ? undefined : shownId, status);
	const panelAsset =
		panel && 'id' in panel ? engine?.get(panel.id, 'asset') : undefined;
	const allCollections: CollectionRecord[] = [
		...(snapshot.own ? [snapshot.own] : []),
		...snapshot.attached,
		...snapshot.team
	];

	function renderPanel(lib: LibraryEngine, current: Panel): React.ReactNode {
		switch (current.kind) {
			case 'duplicates':
				return (
					<DuplicatesView
						applyRewrites={applyRewrites}
						collectionName={labelOf}
						engine={lib}
						groups={dupeGroups}
						stories={stories}
						storyName={storyName}
					/>
				);
			case 'conflicts':
				return (
					<ConflictPanel
						collection={current.collection}
						collectionName={labelOf}
						engine={lib}
						recordId={current.recordId}
						version={version}
					/>
				);
			case 'activity':
				return (
					<ActivityPanel
						collection={current.collection}
						engine={lib}
						onRevert={entry => void revert(entry)}
						version={version}
					/>
				);
			case 'versions':
				return panelAsset ? (
					<VersionsPanel
						asset={panelAsset}
						engine={lib}
						onRestore={rev => void restoreVersion(panelAsset, rev)}
						version={version}
					/>
				) : null;
			case 'usages':
				return (
					<UsagesPanel
						assetId={current.id}
						engine={lib}
						storyId={storyId}
						storyName={storyName}
					/>
				);
			case 'move':
				return panelAsset ? (
					<MovePanel
						asset={panelAsset}
						collections={allCollections}
						label={collection => labelOf(collection.id)}
						onPick={(target, copy) =>
							moveAsset(lib, panelAsset.id, target, copy)
						}
					/>
				) : null;
		}
	}

	function panelTitle(current: Panel): string {
		switch (current.kind) {
			case 'duplicates':
				return t('dialogs.library.dupes.title');
			case 'conflicts':
				return t('dialogs.library.conflict.panelTitle');
			case 'activity':
				return t('dialogs.library.activity.titleOf', {
					name: labelOf(current.collection)
				});
			case 'versions':
				return t('dialogs.library.versions.title', {name: panelAsset?.name ?? ''});
			case 'usages':
				return t('dialogs.library.usages.title', {name: panelAsset?.name ?? ''});
			case 'move':
				return t('dialogs.library.move.title', {name: panelAsset?.name ?? ''});
		}
	}

	const tiles = kind
		? matchingAssets.map(meta => {
				const record = shownAssets.find(asset => asset.id === meta.id)!;
				const winner = resolver?.asset(meta.name);
				const inView = winner?.id === meta.id;
				const source = record.sourceAsset
					? engine?.get(record.sourceAsset, 'asset')
					: undefined;

				return (
					<AssetTile
						allTags={allTags}
						badges={
							engine && (
								<TileBadges
									collection={selection === ALL ? labelOf(meta.collection) : undefined}
									forkedFrom={
										meta.own && source
											? `${labelOf(source.collection)}/${source.name}`
											: undefined
									}
									onConflict={() =>
										setPanel({kind: 'conflicts', recordId: meta.id})
									}
									onUsages={() => setPanel({id: meta.id, kind: 'usages'})}
									shadowed={
										!meta.own && !!winner && !inView && winner.collection === snapshot.own?.id
									}
									sync={recordSync(engine, meta.id, 'asset')}
									usage={engine.usage(meta.id).length}
								/>
							)
						}
						focused={focusedAsset?.id === meta.id}
						key={meta.id}
						menuItems={menuFor(record)}
						meta={meta}
						nameTaken={name => nameTaken(record, name)}
						onChangeTags={tags => void handleChangeTags(meta.id, tags)}
						onDelete={() => void handleDeleteAsset(record)}
						onEdit={() => openAssetEditor(meta.id)}
						onRename={(name, updateScenes) =>
							void handleRenameAsset(meta.id, name, updateScenes)
						}
						unreferenced={
							inView && synced.ready ? !synced.assetIds.has(meta.id) : undefined
						}
						usedIn={inView ? usage.get(meta.name) : undefined}
					/>
				);
		  })
		: matchingCharacters.map(({character, record}) => {
				const inView = resolver?.character(character.id)?.id === record.id;
				const outside = () =>
					setError(
						t('dialogs.library.characterOutside', {name: character.id})
					);

				return (
					<CharacterTile
						allTags={allTags}
						character={character}
						focused={focusedCharacter?.id === character.id && inView}
						key={record.id}
						onChangeTags={tags =>
							inView
								? void handleChangeCharacterTags(character, tags)
								: outside()
						}
						onDelete={() =>
							inView ? void handleDeleteCharacter(character.id) : outside()
						}
						onDropFiles={files =>
							inView ? void handleDropOnCharacter(character, files) : outside()
						}
						onEdit={() =>
							inView ? openCharacterEditor(character.id) : outside()
						}
						unreferenced={
							inView && synced.ready
								? !synced.characterIds.has(character.id)
								: undefined
						}
						usedIn={inView ? usage.get(character.id) : undefined}
					/>
				);
		  });
	const empty = tiles.length === 0;
	const tab = TABS[tabIndex];

	return (
		<DialogCard
			{...props}
			className="sliders-assets-dialog library-dialog"
			focusOnOpen
			headerLabel={t('dialogs.library.title')}
			hotkeyScope="sliders-assets"
			maximizable
		>
			<div className="library-layout">
				{engine && (
					<LibraryRail
						engine={engine}
						ensureOwn={() => store.ownCollection()}
						onDropAsset={(assetId, target, copy) =>
							moveAsset(engine, assetId, target, copy)
						}
						onSelect={next => {
							setSelection(next);
							setPanel(undefined);
						}}
						selection={selection}
						snapshot={snapshot}
						storyId={storyId}
						storyName={story?.name ?? ''}
						usedNames={[...usage.keys()]}
					/>
				)}
				<div className="library-main">
					{engine && sync && (
						<CollectionHeader
							collection={selection === ALL ? undefined : shown}
							count={metas.length + shownCharacters.length}
							engine={engine}
							onActivity={
								shown && selection !== ALL
									? () => setPanel({collection: shown.id, kind: 'activity'})
									: undefined
							}
							onDeleted={() => setSelection(MINE)}
							onOpenConflicts={() =>
								setPanel({
									collection: selection === ALL ? undefined : shownId,
									kind: 'conflicts'
								})
							}
							own={!!shown && shown.id === snapshot.own?.id}
							sync={sync}
							title={
								selection === ALL
									? t('dialogs.library.allAssets')
									: t('dialogs.library.mine', {name: story?.name ?? ''})
							}
						/>
					)}
					<ButtonBar>
						<UploadButton
							// The picker on the Sounds filter must offer sounds.
							accept={kind === 'sound' ? 'audio/*' : 'image/*'}
							commandId="slidersAssets.upload"
							commandScope="sliders-assets"
							label={t('dialogs.slidersAssets.upload')}
							onUpload={kind ? handleUpload : handleCharacterDrop}
						/>
						{!kind && (
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
						<TagCardButton
							allTags={allTags}
							id="sliders-assets-tag-filter"
							onAdd={tag => setTagFilter([...tagFilter, tag])}
							onRemove={tag => setTagFilter(tagFilter.filter(t => t !== tag))}
							restrictToExisting
							tags={tagFilter}
						/>
						<IconButton
							icon={<IconAlertTriangle />}
							label={t('dialogs.library.dupes.button', {
								count: dupeGroups.length
							})}
							onClick={() => setPanel({kind: 'duplicates'})}
							selectable
							selected={panel?.kind === 'duplicates'}
						/>
					</ButtonBar>
					<div className="sliders-tablist" role="tablist">
						{TABS.map((entry, index) => (
							<button
								aria-selected={index === tabIndex}
								className={`sliders-tab${index === tabIndex ? ' selected' : ''}`}
								key={entry.labelKey}
								onClick={() => {
									setTabIndex(index);
									setPanel(undefined);
								}}
								role="tab"
								type="button"
							>
								{t(entry.labelKey)}
							</button>
						))}
						{/* Not a filter: opens the generator. "Where do new assets come from"
						    is one question, and upload is the other half of the answer. */}
						<span className="sliders-tab-link">
							<button onClick={openGenerator} type="button">
								{t('dialogs.slidersAssets.generateTab')}
							</button>
						</span>
					</div>
					{dupeAsk && engine && (
						<DupeDialog
							collectionName={labelOf}
							fileName={dupeAsk.fileName}
							inView={id => snapshot.viewIds.includes(id)}
							onAnswer={dupeAsk.resolve}
							report={dupeAsk.report}
							suggestedName={dupeAsk.suggestedName}
						/>
					)}
					{ask?.kind === 'shared' && (
						<SharedPrompt
							allowFork={ask.allowFork}
							info={ask.info}
							message={ask.message}
							onAnswer={scope => void answerShared(scope)}
							testId="library-shared-prompt"
							updateAllLabel={ask.updateAllLabel}
						/>
					)}
					{ask?.kind === 'confirm' && (
						<div className="library-ask" role="alertdialog">
							<p>{ask.message}</p>
							<ButtonBar>
								{ask.buttons.map(button => (
									<IconButton
										icon={button.danger ? <IconTrash /> : <IconArrowLeft />}
										key={button.label}
										label={button.label}
										onClick={() => {
											setAsk(undefined);
											button.run();
										}}
										variant={button.danger ? 'danger' : 'primary'}
									/>
								))}
								<IconButton
									icon={<IconX />}
									label={t('common.cancel')}
									onClick={() => setAsk(undefined)}
								/>
							</ButtonBar>
						</div>
					)}
					{error && (
						<div className="sliders-note">
							<p className="sliders-upload-report" role="alert">
								{error}
							</p>
						</div>
					)}
					{notice && (
						<div className="sliders-note">
							<p className="sliders-upload-report library-notice" role="status">
								{notice}{' '}
								<button
									aria-label={t('common.close')}
									className="library-notice-close"
									onClick={() => setNotice(undefined)}
									type="button"
								>
									×
								</button>
							</p>
						</div>
					)}
					{panel && engine ? (
						<div className="library-panel">
							<ButtonBar>
								<IconButton
									icon={<IconArrowLeft />}
									label={t('common.back')}
									onClick={() => setPanel(undefined)}
								/>
								<h4 className="library-panel-title">{panelTitle(panel)}</h4>
							</ButtonBar>
							<div className="library-panel-body">{renderPanel(engine, panel)}</div>
						</div>
					) : (
						<UploadDropZone
							floatingHint
							label={
								tab.kind === 'sound'
									? t('dialogs.slidersAssets.dropHintSounds')
									: tab.kind
									? t('dialogs.library.dropHint', {
											collection:
												selection === ALL || selection === MINE || !shownId
													? t('dialogs.library.mine', {name: story?.name ?? ''})
													: labelOf(shownId),
											kind: t(tab.labelKey)
									  })
									: t('dialogs.slidersAssets.dropHintCharacters')
							}
							onDrop={files =>
								void (kind ? handleUpload(files) : handleCharacterDrop(files))
							}
						>
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
						</UploadDropZone>
					)}
				</div>
			</div>
		</DialogCard>
	);
};
