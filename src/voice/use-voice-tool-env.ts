/**
 * The editor half of `VoiceToolEnv` — every context the tools are allowed to touch, and
 * nothing else.
 *
 * Every write goes through the UNDOABLE dispatch with a description, so a voice edit lands
 * on the same stack as a typed one and Ctrl-Z reaches it. That is the only guarantee this
 * feature actually has: the wake gate is a prompt rule and the model will sometimes act on
 * a sentence that was not addressed to it.
 *
 * `story()` is a function rather than a captured value because the runner reads it between
 * awaits. A model that writes a passage and then reads the map must see its own write; a
 * snapshot taken when the session opened would hand it the story from ten edits ago.
 */

import {buildStoryMap, catalogFromManifest, lintStory} from '@sliders/story-map';
import type {LintFinding, Manifest, StoryMap} from '@sliders/story-map';
import {extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';
import type {Scene} from '@sliders/scene-types';
import {v4 as uuid} from '@lukeed/uuid';
import * as React from 'react';
import {resolveSceneAssets} from '@sliders/story-map';
import {addPassageEditors, useDialogsContext} from '../dialogs';
import {ScenePreviewDialog, setScenePreviewDismissed} from '../dialogs/scene-preview';
import {requestPreviewBeat} from '../dialogs/passage-edit/scene-preview/preview-beat-request';
import {
	useAssetStore,
	useLibraryVersion
} from '../dialogs/sliders-assets/asset-store-context';
import {useServerSyncContext} from '../store/persistence/server';
import {syncRecord} from '../store/persistence/server/sync-record';
import {
	addPassageTag,
	createUntitledPassage,
	deletePassage,
	highlightPassages,
	removePassageTag,
	replaceInPassage,
	replaceInStory,
	selectPassage,
	updatePassage
} from '../store/stories';
import type {Passage, Story} from '../store/stories';
import {useUndoableStoriesContext} from '../store/undoable-stories';
import type {Point} from '../util/geometry';
import type {VoiceToolEnv} from './voice.types';

/**
 * Undo labels. i18n KEYS, resolved when the undo button renders — and they must be keys
 * that exist. A missing one does not throw: i18next hands back the key itself, so the
 * undo button reads "Undo undoChange.editPassage" and nobody notices until an author does.
 */
const DESC = {
	create: 'undoChange.newPassage',
	delete: 'undoChange.deletePassage',
	rename: 'undoChange.renamePassage',
	replace: 'undoChange.replaceAllText',
	scene: 'undoChange.patchScene',
	tag: 'undoChange.addTag',
	untag: 'undoChange.removeTag',
	text: 'undoChange.editPassage'
} as const;

export interface UseVoiceToolEnvOptions {
	/** Where the map is looking, so a created passage lands where the author is. */
	getCenter: () => Point;
	/**
	 * Rasterises the scene a passage holds. Absent means no host is mounted, and the
	 * `screenshot_scene` tool then says so rather than pretending to look.
	 */
	screenshot?: VoiceToolEnv['screenshot'];
	/** Scrolls the map so a passage is on screen. From `useViewCenter`. */
	setCenter: (point: Point) => void;
	story: Story;
}

/** The story's library as a `story-map` manifest. Built on demand, never cached stale. */
function manifestOf(
	assets: {bytes: number; hash: string; id: string; kind: string; mime: string; name: string; tags: string[]; h: number; w: number; ownerCharacter?: string}[],
	characters: unknown[]
): Manifest {
	return {
		assets: assets.map(asset => ({
			bytes: asset.bytes,
			h: asset.h,
			hash: asset.hash,
			id: asset.id,
			kind: asset.kind,
			mime: asset.mime,
			name: asset.name,
			ownerCharacter: asset.ownerCharacter,
			tags: asset.tags,
			w: asset.w
		})),
		characters,
		// The editor's library has no "the bytes are gone" state — a blob it lists is a
		// blob it holds. Missing is a server-side idea, and the panel is not the server.
		missing: [],
		rev: 0,
		version: 1
	};
}

export function useVoiceToolEnv(options: UseVoiceToolEnvOptions): VoiceToolEnv {
	const {getCenter, screenshot, setCenter, story} = options;
	const {dispatch} = useUndoableStoriesContext();
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const assetStore = useAssetStore();
	const {client} = useServerSyncContext();
	const libraryVersion = useLibraryVersion();

	/*
	 * Mirrors. Everything below reads `.current`, so the env object itself is STABLE and
	 * the tool runner — created once, because its `seen` set is the session's write gate —
	 * keeps working against the live editor.
	 *
	 * `dispatch` is in here for a reason that cost a crash. `UndoableStoriesContextProvider`
	 * memoises its dispatch on the stories state, and that dispatch computes each change's
	 * REVERSE action against the state it closed over. A dispatch captured when the panel
	 * opened therefore undoes against the story as it was then: create a passage, write to
	 * it, and `reverseAction` looks up a passage its snapshot has never heard of and throws
	 * through the error boundary. Always the live one.
	 */
	const storyRef = React.useRef(story);
	const dispatchRef = React.useRef(dispatch);
	const dialogsDispatchRef = React.useRef(dialogsDispatch);

	storyRef.current = story;
	dispatchRef.current = dispatch;
	dialogsDispatchRef.current = dialogsDispatch;

	const libraryRef = React.useRef(libraryVersion);

	libraryRef.current = libraryVersion;

	const passageById = React.useCallback((id: string): Passage => {
		const passage = storyRef.current.passages.find(
			candidate => candidate.id === id
		);

		if (!passage) {
			throw new Error(`there is no longer a passage with id ${id}`);
		}

		return passage;
	}, []);

	/** The manifest and the parsed scenes, both of which three tools want. */
	const catalog = React.useCallback(async () => {
		const [assets, characters] = await Promise.all([
			assetStore.list({includeFrames: true}),
			assetStore.listCharacters()
		]);

		return catalogFromManifest(manifestOf(assets, characters));
	}, [assetStore]);

	const scenesOf = React.useCallback((): Map<string, Scene> => {
		const scenes = new Map<string, Scene>();

		for (const passage of storyRef.current.passages) {
			const block = extractSceneBlock(passage.text);

			if (!block) {
				continue;
			}

			const scene = parseScene(block.text).scene;

			if (scene.id !== undefined && !scenes.has(scene.id)) {
				scenes.set(scene.id, scene);
			}
		}

		return scenes;
	}, []);

	return React.useMemo<VoiceToolEnv>(
		() => ({
			assets: async () => {
				const rows = await assetStore.list({includeFrames: true});

				return rows.map(asset => ({
					bytes: asset.bytes,
					id: asset.id,
					kind: asset.kind,
					name: asset.name
				}));
			},

			assetUsage: async () => {
				const resolved = await catalog();
				const scenes = scenesOf();
				const usage: Record<string, string[]> = {};

				for (const [id, scene] of scenes) {
					// `allFrames`, because "does this scene use that picture" has to mean
					// any pose of any cast member — the narrow walk answers a different
					// question and would call a frame unused while a beat flips to it.
					for (const row of resolveSceneAssets(scene, resolved, {
						allFrames: true,
						scenes: sceneId => scenes.get(sceneId)
					})) {
						if (row.id === '') {
							continue;
						}

						(usage[row.id] ??= []).push(id);
					}
				}

				return usage;
			},

			checkpoint: client
				? async label => {
						const rev = syncRecord(storyRef.current.id)?.rev;

						if (rev === undefined || rev === 0) {
							throw new Error(
								'this story has not been saved to the server yet, so there is no revision to pin'
							);
						}

						await client.setRevisionMeta(storyRef.current.id, rev, {
							label,
							pinned: true
						});
					}
				: undefined,

			createPassage: (name, text, at) => {
				const current = storyRef.current;
				// The editor's own creator for the SIZE and the overlap walk — a voice
				// passage must not land on top of another one — but its name is discarded
				// and its position only used when the model named none.
				const center = at
					? {left: at[0], top: at[1]}
					: (() => {
							try {
								return getCenter();
							} catch {
								// The map is not in the DOM yet. Anywhere is better than
								// refusing to create the passage.
								return {left: 100, top: 100};
							}
						})();
				const placed = createUntitledPassage(current, center.left, center.top);
				// Minted HERE, not read off the action: `createPassage` in the reducer
				// mints its own when `props.id` is absent, so reading it back gives
				// undefined — and an `updatePassage` on `undefined` throws inside the
				// reducer, which takes the whole story route down with it.
				const id = uuid();

				dispatchRef.current(
					{
						props: {
							...placed.props,
							...(at ? {left: at[0], top: at[1]} : {}),
							id,
							name,
							text
						},
						storyId: current.id,
						type: 'createPassage'
					},
					DESC.create
				);

				return id;
			},

			deletePassage: id =>
				dispatchRef.current(deletePassage(storyRef.current, passageById(id)), DESC.delete),

			findReplace: (search, replace, passageIds) => {
				const current = storyRef.current;
				const flags = {
					includePassageNames: false,
					matchCase: true,
					useRegexes: false
				};

				if (passageIds === undefined) {
					const hits = current.passages.filter(passage =>
						passage.text.includes(search)
					).length;

					dispatchRef.current(replaceInStory(current, search, replace, flags), DESC.replace);

					return hits;
				}

				for (const id of passageIds) {
					dispatchRef.current(
						replaceInPassage(current, passageById(id), search, replace, flags),
						DESC.replace
					);
				}

				return passageIds.length;
			},

			goto: id => {
				const passage = passageById(id);

				dispatchRef.current(selectPassage(storyRef.current, passage, true));
				setCenter({
					left: passage.left + passage.width / 2,
					top: passage.top + passage.height / 2
				});
			},

			highlight: ids =>
				dispatchRef.current(highlightPassages(storyRef.current, ids)),

			lint: async (): Promise<LintFinding[]> =>
				lintStory({
					body: storyRef.current,
					catalog: await catalog(),
					ref: storyRef.current.name
				}),

			map: async (): Promise<StoryMap> =>
				buildStoryMap({
					catalog: await catalog(),
					ref: storyRef.current.name,
					rev: syncRecord(storyRef.current.id)?.rev,
					story: storyRef.current
				}),

			openPassageEditor: id =>
				dialogsDispatchRef.current(addPassageEditors(storyRef.current.id, [id])),

			openPreview: (id, beat) => {
				const passage = passageById(id);

				// Selecting first is what makes the dialog show THIS passage: with no
				// editor open the preview follows the map's solo selection.
				dispatchRef.current(selectPassage(storyRef.current, passage, true));

				if (beat !== undefined) {
					// Placed before the dialog mounts on purpose — the request waits for a
					// parse, so it survives both orders.
					requestPreviewBeat(id, beat);
				}

				setScenePreviewDismissed(false);
				dialogsDispatchRef.current({
					type: 'addDialog',
					component: ScenePreviewDialog,
					props: {storyId: storyRef.current.id}
				});
			},

			screenshot,

			renamePassage: (id, name) =>
				dispatchRef.current(
					updatePassage(storyRef.current, passageById(id), {name}),
					DESC.rename
				),

			revs: client
				? async () => {
						const result = await client.listRevisions(storyRef.current.id);

						return result.revisions.map(revision => ({
							at: revision.at,
							label: revision.label,
							rev: revision.rev
						}));
					}
				: undefined,

			story: () => ({
				id: storyRef.current.id,
				name: storyRef.current.name,
				passages: storyRef.current.passages
			}),

			tagPassage: (id, add, remove) => {
				for (const tag of add) {
					dispatchRef.current(
						addPassageTag(storyRef.current, passageById(id), tag),
						DESC.tag
					);
				}

				for (const tag of remove) {
					dispatchRef.current(
						removePassageTag(storyRef.current, passageById(id), tag),
						DESC.untag
					);
				}
			},

			writePassage: (id, text, reason) =>
				dispatchRef.current(
					updatePassage(storyRef.current, passageById(id), {text}),
					reason === 'scene' ? DESC.scene : DESC.text
				)
		}),
		// No `dispatch` and no `dialogsDispatch`: both are refs above, deliberately, so
		// this object stays stable across the renders those identities churn on.
		[
			assetStore,
			catalog,
			client,
			getCenter,
			passageById,
			scenesOf,
			screenshot,
			setCenter
		]
	);
}
