import {
	IconArrowsMinimize,
	IconChevronLeft,
	IconChevronRight,
	IconGridDots,
	IconLock,
	IconLockOpen,
	IconPhoto,
	IconPhotoShield,
	IconPlayerPause,
	IconPlayerPlay,
	IconTimeline
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import {useCommand} from '../../../hotkeys';
import {extractSceneBlock, IndexedPassage} from '@sliders/scene-index';
import {
	AssetResolver,
	Beat,
	BubbleStyle,
	Camera,
	Character,
	EntityId,
	Vec2
} from '@sliders/scene-types';
import {parseLinkText} from '@sliders/render-dom';
import type {DomRenderer} from '@sliders/render-dom';
import type {BubbleGeometry} from '@sliders/scene-edit';
import type {AssetDragPayload} from './asset-drag';
import {beatHoldMs, sceneAutoAdvanceMs, sceneHoldMs} from './beat-hold';
import {BeatProps} from './beat-props';
import {effectiveLocks, lockReason} from './scene-lock';
import {BeatTimeline} from './beat-timeline';
import {BubbleEditor} from './bubble-editor';
import {SceneDropMenu, type DropChoice} from './drop-menu';
import {
	assetDropWrites,
	deleteWrites,
	flipWrites,
	frameWrite,
	zWrites
} from './scene-gestures';
import {
	refreshAssetLibrary,
	useAssetStore
} from '../../sliders-assets/asset-store-context';
import {
	characterFromFile,
	framesFromFiles
} from '../../sliders-assets/character-frames';
import {requestAssetFocus} from '../../sliders-assets/focus-request';
import {SlidersAssetsDialog} from '../../sliders-assets/sliders-assets';
import {useDialogsContext} from '../../context';
import {SceneStage} from './scene-stage';
import {StageEditorOverlay} from './stage-editor-overlay';
import {StageSelectionControls} from './stage-selection-controls';
import {roundCoord} from './stage-geometry';
import {parseLinks} from '../../../util/parse-links';
import {parentOffsets, resolveStage} from '@sliders/scene-core';
import type {SceneParse} from './use-scene-parse';
import {useActiveBeatMark} from './use-active-beat-mark';
import {useStageSelection} from './use-stage-selection';
import {
	applyCameraPatch,
	applyStagePatch,
	cameraAgrees,
	isOwnOrigin,
	planEntityWrite,
	settlePatch,
	useScenePatch,
	writeSceneEdits,
	DRAG_ORIGIN,
	DROP_ORIGIN,
	EDIT_ORIGIN,
	NUDGE_ORIGIN,
	PATCH_TIMEOUT_MS,
	Z_ORIGIN,
	type EntityKeyWrite,
	type SceneWrite
} from './use-scene-writer';
import './scene-preview.css';

export interface ScenePreviewProps {
	/**
	 * `invalidate` is optional because the type belongs to the story format, which has no
	 * uploads: the app's own resolver caches a name index, and an image dropped onto the
	 * stage would otherwise render as a placeholder until the window regained focus.
	 */
	assets: AssetResolver & {invalidate?: () => void};
	text: string;
	/**
	 * The parse of `text`. Owned by the passage editor rather than by the preview: the
	 * error list above the editor and the editor's own error marks read the same one, and
	 * three parses of the same text would drift apart while the author types.
	 */
	parse: SceneParse;
	/** The whole story. Needed only so `from:` can resolve across passages. */
	passages?: IndexedPassage[];
	/**
	 * The story's own stylesheet, so a bubble styled `as: ghostly` looks the same here as
	 * it will in the player — the published page carries this CSS, and without it the
	 * preview shows every custom token as a plain bubble.
	 */
	stylesheet?: string;
	/**
	 * The passage's CodeMirror. Every visual edit is a text edit through this document and
	 * never around it, so Twine's undo works for free (spec 07). Absent when the author
	 * turned CodeMirror off in preferences: the stage is then selectable but read-only.
	 */
	editor?: CodeMirror.Editor;
	/**
	 * Ctrl/cmd-click on a `[[link]]` inside a bubble, with the passage the link points at.
	 * Absent means the preview shows links but cannot open them.
	 */
	onOpenPassage?: (name: string) => void;
	/**
	 * Covering the whole window, toolbar included. The one state the dialog system does
	 * not provide, so it is the one state that is still ours: normal and maximized are
	 * the card's own, and this is owned by `ScenePreviewDialog` because leaving it has to
	 * put the card back where it came from.
	 */
	fullScreen: boolean;
	onFullScreenChange: (next: boolean) => void;
}

/**
 * The lock survives the dialog, the passage and the session.
 *
 * An author who locked the stage did so because they are writing rather than staging, and
 * a lock that let go every time the passage editor closed would be worse than none: they
 * would find out it had by moving a character.
 */
const LOCKED_KEY = 'sliders.preview.locked';

/**
 * The background lock: the camera holds still and a dropped backdrop will not replace the
 * one already there. A narrower lock than the stage's, for the common case of staging
 * characters against a shot that is already framed — a pan started by grabbing empty ground
 * is easy to do by accident, and `camera:` is not somewhere an author looks afterwards.
 *
 * Survives the session the same way the other two do, and for the same reason.
 */
const BG_LOCKED_KEY = 'sliders.preview.bgLocked';

/**
 * The grid survives the dialog too, for the same reason the lock does: an author who turned
 * it on is staging, and staging outlasts one passage.
 */
const GRID_KEY = 'sliders.preview.grid';

/**
 * Whether the beat strip names its beats.
 *
 * Off by default: the strip's job is spacing, and the labels cost rows of height that full
 * screen does not have to spare. An author who turned them on is reading the scene's shape
 * rather than staging it, and that outlasts one passage like the other three.
 */
const TIMELINE_LABELS_KEY = 'sliders.preview.timelineLabels';

/** Stable identity, so the timeline's memo does not rebuild on every parse. */
const EMPTY_BEATS: Beat[] = [];

/** Arrow-key nudge, in scene units. Shift multiplies it. */
const NUDGE_STEP = 0.01;
const NUDGE_SHIFT_MULTIPLIER = 10;

/** How far apart a multi-file drop stacks its props, in scene x. */
const DROP_STACK_STEP = 0.08;

/** A file drop waiting on the menu that asks what the images are. */
interface DropRequest {
	/** Scene position, for whatever ends up on the stage. */
	at: Vec2;
	/** The cast as it was when the drop happened, for the "frames of…" branch. */
	characters: Character[];
	files: File[];
	/** Where to open the menu, in client coordinates. */
	point: Vec2;
}

/** How long a queued drop waits for its entry to reach the document before giving up. */
const TEXT_SETTLE_TIMEOUT_MS = 1000;
const TEXT_SETTLE_POLL_MS = 25;

/**
 * Resolves once the passage text is no longer `before`, or on timeout.
 *
 * Polling rather than a promise from the writer: the write goes through CodeMirror, out to
 * react-codemirror2, and back in as a prop, and nothing along that path hands back a
 * signal. The timeout is what stops a write that changed nothing from hanging the drop.
 */
async function textChanged(
	ref: React.MutableRefObject<string>,
	before: string
): Promise<void> {
	const deadline = Date.now() + TEXT_SETTLE_TIMEOUT_MS;

	while (ref.current === before && Date.now() < deadline) {
		await new Promise(resolve =>
			window.setTimeout(resolve, TEXT_SETTLE_POLL_MS)
		);
	}
}

/**
 * Live scene preview for one passage's scene (spec 06), and the visual editor on top of it
 * (spec 07).
 *
 * The contents of the scene preview dialog, so the title, the collapse and the maximize
 * are the dialog card's--this is the bar and the stage under it, and nothing else.
 */
export const ScenePreview: React.FC<ScenePreviewProps> = ({
	assets,
	editor,
	fullScreen,
	onFullScreenChange,
	onOpenPassage,
	parse,
	passages,
	stylesheet,
	text
}) => {
	const {t} = useTranslation();
	const store = useAssetStore();
	const {dispatch} = useDialogsContext();
	// The author's own preference. What actually gates the gestures is `locked`/`bgLocked`
	// below, which is this with the scene's own `locked:` laid over it.
	const [storedLocked, setLocked] = React.useState(
		() => window.localStorage.getItem(LOCKED_KEY) === 'true'
	);
	const [storedBgLocked, setBgLocked] = React.useState(
		() => window.localStorage.getItem(BG_LOCKED_KEY) === 'true'
	);
	const [grid, setGrid] = React.useState(
		() => window.localStorage.getItem(GRID_KEY) === 'true'
	);
	/**
	 * What is locked right now: the scene's word over the author's preference.
	 *
	 * One way only -- a scene pins things and never releases them -- so the toggles below
	 * still mean what they said, they just cannot un-pin what the file pinned. See
	 * `scene-lock.ts` for the precedence.
	 */
	const {bgLocked, locked} = effectiveLocks(parse.result?.scene, {
		bgLocked: storedBgLocked,
		locked: storedLocked
	});
	/** Set when the SCENE is what locked it, so the toggle would be a dead button. */
	const stageLockedByScene = lockReason(parse.result?.scene, 'entities');
	const bgLockedByScene = lockReason(parse.result?.scene, 'bg');
	const [timelineLabels, setTimelineLabels] = React.useState(
		() => window.localStorage.getItem(TIMELINE_LABELS_KEY) === 'true'
	);
	const [beat, setBeat] = React.useState(0);
	const [dropRequest, setDropRequest] = React.useState<DropRequest>();
	const [playing, setPlaying] = React.useState(false);
	const [renderer, setRenderer] = React.useState<DomRenderer>();
	const root = React.useRef<HTMLDivElement>(null);
	const mounted = React.useRef(true);
	const [seal, setSeal] = React.useState(0);
	const {clearPatch, holdPatch, mergePatch, patch, setPatch} = useScenePatch();

	/**
	 * The camera a live pan or zoom is painting with.
	 *
	 * Its own state rather than an entry in `StagePatch`, which is keyed by entity id — a
	 * scene is entitled to contain an entity called `camera`. The ref mirrors it so the
	 * hold timer can be armed from inside a commit without re-reading state.
	 */
	const [cameraPatch, setCameraPatch] = React.useState<Camera>();
	const cameraPatchRef = React.useRef<Camera>();
	const cameraTimer = React.useRef<number>();

	// The block is cut from the LIVE text, not from the debounced parse: a write's offsets
	// have to line up with the document CodeMirror is holding right now.
	const block = React.useMemo(() => extractSceneBlock(text), [text]);
	const lastBeat = Math.max(0, parse.states.length - 1);
	/**
	 * The scene's own pace, for every beat that did not time itself. Primitives, so they are
	 * safe in an effect's dependency list where `parse.result` is a fresh object per parse.
	 *
	 * Two of them because the zero splits them. `autoAdvanceMs` is the scene's raw answer,
	 * `0` included, and only the play timer reads it — it is the one thing here that can
	 * decline to schedule. `holdMs` is the same answer as a LENGTH, for drawing the strip
	 * and for the number unchecking Auto writes.
	 */
	const autoAdvanceMs = sceneAutoAdvanceMs(parse.result?.scene);
	const holdMs = sceneHoldMs(parse.result?.scene);
	const parsedStage = parse.states[Math.min(beat, lastBeat)];
	/**
	 * The stage in AUTHORED space: `at` is the number in the YAML, `of` intact. The drag
	 * patch paints onto this one, because a gesture writes the author's coordinate.
	 */
	const localStage = React.useMemo(
		() => applyCameraPatch(applyStagePatch(parsedStage, patch), cameraPatch),
		[cameraPatch, parsedStage, patch]
	);
	/**
	 * The stage as DRAWN: `of` resolved into absolute coordinates. Everything downstream of
	 * here — renderer, differ, hit testing, handles — speaks absolute only.
	 */
	const stage = React.useMemo(() => resolveStage(localStage), [localStage]);
	/**
	 * Where each child's `at` is measured from. The overlay drags in absolute space, because
	 * that is where the pointer is, and subtracts this to get the offset it writes back.
	 */
	const offsets = React.useMemo(() => parentOffsets(localStage), [localStage]);
	/**
	 * The two past stages the measuring overlay draws ghosts from, resolved into the same
	 * absolute space `stage` is in.
	 *
	 * Taken from the raw parse, never from `localStage`: an optimistic drag patch is the
	 * position the author is producing right now, and folding it into "where this used to
	 * be" would make the ghost chase the sprite. Computed only while the grid is on — the
	 * overlay ignores them otherwise, and resolving two stages per keystroke for a marker
	 * nobody asked for is the kind of work that shows up in a scene with a large cast.
	 */
	const origStage = React.useMemo(
		() =>
			grid && parse.states[0] ? resolveStage(parse.states[0]) : undefined,
		[grid, parse.states]
	);
	const prevStage = React.useMemo(() => {
		const previous = parse.states[Math.min(beat, lastBeat) - 1];

		return grid && previous ? resolveStage(previous) : undefined;
	}, [beat, grid, lastBeat, parse.states]);
	const stageIds = React.useMemo(
		() => Object.keys(stage.entities ?? {}),
		[stage]
	);
	// State N is produced by beat N-1; S0 has no beat.
	const shownBeat = beat > 0 ? parse.result?.scene.beats[beat - 1] : undefined;
	/**
	 * What a live bubble drag is painting with.
	 *
	 * Held here rather than inside `BubbleEditor` because the bubble it moves is the
	 * renderer's: the draft has to travel down through `SceneStage` into the dialogue
	 * layer, so the author drags the real thing rather than an outline of it.
	 */
	const [bubbleDraft, setBubbleDraft] = React.useState<BubbleStyle>();
	const drawnBeat = React.useMemo(() => {
		if (!shownBeat || !bubbleDraft) {
			return shownBeat;
		}

		return shownBeat.kind === 'say' || shownBeat.kind === 'box'
			? {...shownBeat, style: bubbleDraft}
			: shownBeat;
	}, [bubbleDraft, shownBeat]);

	/**
	 * Does the beat on screen ask the reader to choose?
	 *
	 * A tap steps forward only when it does not. Links are the one thing on the stage a
	 * click already means something to, and a stage that advanced under them would take
	 * the choice away on the way to pressing one.
	 */
	const beatHasLink = React.useMemo(() => {
		if (shownBeat?.kind !== 'say' && shownBeat?.kind !== 'box') {
			return false;
		}

		return parseLinkText(shownBeat.text).some(token => token.kind === 'link');
	}, [shownBeat]);
	const kindOf = React.useCallback(
		(id: EntityId) => stage.entities?.[id]?.kind ?? 'cast',
		[stage]
	);
	/**
	 * The caret drives the scrubber.
	 *
	 * Clicking into a beat's lines shows that beat on the stage, and clicking out of the
	 * beats goes back to the opening state — the other half of `useActiveBeatMark`, which
	 * lights the beat the scrubber is already on. Playback stops, because the author is
	 * clearly steering by hand now.
	 */
	const goToBeat = React.useCallback((next: number) => {
		setPlaying(false);
		setBeat(next);
	}, []);
	const {clear, select, selection} = useStageSelection({
		beatSpans: parse.result?.beatSpans,
		block,
		editor,
		enabled: true,
		kindOf,
		onCaretBeat: goToBeat,
		scene: parse.result?.scene,
		stageIds
	});


	/**
	 * Shift state, sampled in the CAPTURE phase.
	 *
	 * The command dispatcher calls `run()` with no arguments, and its own listener sits on
	 * `document` in the bubble phase — so a capture-phase listener on the same node has
	 * already run by then and the flag is current. Registering eight separate nudge
	 * commands to tell `left` from `shift+left` would double the shortcuts dialog for one
	 * bit of information.
	 */
	const shiftHeld = React.useRef(false);

	// React tears a tree down from the top, so `SceneStage`'s cleanup — which hands back
	// `undefined` — runs after this one. Without the guard that is a state update on an
	// unmounted component every time the passage dialog closes.
	React.useEffect(
		() => () => {
			mounted.current = false;
		},
		[]
	);

	/**
	 * A `[[link]]` in a bubble, clicked in the preview.
	 *
	 * Plain click is left alone: in the editor the preview is a picture of one scene, and
	 * following a link would throw away the beat the author is staging. Ctrl/cmd-click is the
	 * same "go to the definition" gesture the story map uses, so it opens the target passage.
	 */
	const handleLink = React.useCallback(
		(name: string, target?: string, event?: MouseEvent) => {
			if (event?.ctrlKey || event?.metaKey) {
				onOpenPassage?.(target ?? name);
			}
		},
		[onOpenPassage]
	);

	const handleRenderer = React.useCallback((next?: DomRenderer) => {
		if (mounted.current) {
			setRenderer(next);
		}
	}, []);

	React.useEffect(() => {
		const sample = (event: KeyboardEvent) => {
			shiftHeld.current = event.shiftKey;
		};

		document.addEventListener('keydown', sample, true);

		return () => document.removeEventListener('keydown', sample, true);
	}, []);

	// The parse is debounced, so for a moment after a write the parsed stage still holds
	// the OLD position. Patch entries are dropped one by one as the parse agrees with
	// them; `holdPatch` bounds how long a stubborn one may linger.
	React.useEffect(() => {
		setPatch(settlePatch(patch, parsedStage.entities));
	}, [parsedStage, patch, setPatch]);

	const setCamera = React.useCallback((camera?: Camera) => {
		cameraPatchRef.current = camera;
		setCameraPatch(camera);
	}, []);

	/**
	 * Same bargain as `holdPatch`: the optimistic camera survives until the parse agrees
	 * with it, or until this fires. Identity comparison rather than a value one, so a pan
	 * started while the timer was running is not yanked out from under the pointer.
	 */
	const holdCamera = React.useCallback(() => {
		const held = cameraPatchRef.current;

		if (!held) {
			return;
		}

		window.clearTimeout(cameraTimer.current);
		cameraTimer.current = window.setTimeout(() => {
			cameraTimer.current = undefined;

			if (cameraPatchRef.current === held) {
				cameraPatchRef.current = undefined;
				setCameraPatch(undefined);
			}
		}, PATCH_TIMEOUT_MS);
	}, []);

	React.useEffect(() => () => window.clearTimeout(cameraTimer.current), []);

	React.useEffect(() => {
		if (cameraPatch && cameraAgrees(cameraPatch, parsedStage.camera)) {
			cameraPatchRef.current = undefined;
			setCameraPatch(undefined);
		}
	}, [cameraPatch, parsedStage]);

	// Author typed, or hit undo, while a gesture was live: every offset the gesture holds
	// now points into text that no longer exists.
	React.useEffect(() => {
		if (!editor) {
			return;
		}

		const handler = (
			_editor: CodeMirror.Editor,
			change: CodeMirror.EditorChange
		) => {
			if (!isOwnOrigin(change.origin)) {
				setSeal(value => value + 1);
			}
		};

		editor.on('change', handler);

		return () => editor.off('change', handler);
	}, [editor]);

	const commit = React.useCallback(
		(writes: SceneWrite[], origin: string) => {
			if (
				!block ||
				!writeSceneEdits(
					editor,
					{
						beat,
						blockOffset: block.offset,
						blockText: block.text,
						scene: parse.result?.scene
					},
					writes,
					origin
				)
			) {
				// Nowhere to write, or the write changed nothing: the optimistic patch has
				// no text coming to replace it and must not stay on screen.
				clearPatch();
				setCamera(undefined);

				return;
			}

			holdPatch();
			holdCamera();
		},
		[
			beat,
			block,
			clearPatch,
			editor,
			holdCamera,
			holdPatch,
			parse.result,
			setCamera
		]
	);

	const handleCommit = React.useCallback(
		(writes: SceneWrite[], origin: string = DRAG_ORIGIN) =>
			commit(writes, origin),
		[commit]
	);

	const handleBubbleCommit = React.useCallback(
		(beatIndex: number, geometry: BubbleGeometry) =>
			commit([{beat: beatIndex, bubble: geometry}], DRAG_ORIGIN),
		[commit]
	);

	/**
	 * The beat toolbar's writes. Addressed by beat index, like the bubble drag.
	 *
	 * `EDIT_ORIGIN` rather than `DRAG_ORIGIN`: there is no optimistic stage patch to hold
	 * open, and these are deliberate one-shot edits an author expects their own undo step
	 * for -- not the tail of a gesture.
	 */
	const handleBeatKey = React.useCallback(
		(key: string, value: unknown) => {
			if (beat > 0) {
				commit([{beat: beat - 1, beatKey: key, value}], EDIT_ORIGIN);
			}
		},
		[beat, commit]
	);
	const handleBeatBubble = React.useCallback(
		(key: keyof BubbleStyle, value: unknown) => {
			if (beat > 0) {
				commit([{beat: beat - 1, bubble: {[key]: value}}], EDIT_ORIGIN);
			}
		},
		[beat, commit]
	);

	/** A gesture was abandoned: neither optimistic value has text coming to replace it. */
	const handleCancel = React.useCallback(() => {
		clearPatch();
		setCamera(undefined);
	}, [clearPatch, setCamera]);

	/**
	 * A tile from the asset panel landed on the stage.
	 *
	 * The ids already spoken for are taken from the STAGE, not just from this scene's own
	 * entries: with `from:`, an inherited character is on screen without a local entry, and
	 * a dropped prop that reused its id would silently rewrite it.
	 */
	const handleDropAsset = React.useCallback(
		(payload: AssetDragPayload, at: Vec2) => {
			const taken = Array.from(
				new Set([
					...Object.keys(parse.result?.scene.entities ?? {}),
					...Object.keys(stage.entities ?? {})
				])
			);

			commit(assetDropWrites(payload, at, taken), DROP_ORIGIN);
		},
		[commit, parse.result, stage]
	);

	/**
	 * The current text and the current drop handler, for the async file drop below.
	 *
	 * Its loop outlives the render it started in, and every closure it captured — `commit`,
	 * the block offsets, the parsed scene — describes the document as it was before the first
	 * entry was written. Reading both through refs is what lets the second file be placed
	 * into the text the first one produced.
	 */
	const textRef = React.useRef(text);
	const dropAssetRef = React.useRef(handleDropAsset);

	textRef.current = text;
	dropAssetRef.current = handleDropAsset;

	/**
	 * Image files dragged onto the stage from outside the app.
	 *
	 * A file says nothing about its role, so the drop only collects it and opens the menu
	 * (`drop-menu.tsx`); `runDropChoice` below does the work once the author has said what
	 * the image is. The cast is read here rather than subscribed to, because the "frames
	 * of…" branch is the only thing that needs it and a preview that is always mounted
	 * should not hold the whole library open to answer a question nobody asked.
	 */
	const handleDropFiles = React.useCallback(
		async (files: File[], at: Vec2, point: Vec2) => {
			let characters: Character[] = [];

			try {
				characters = await store.listCharacters();
			} catch (error) {
				console.error('Could not read the cast for the drop menu', error);
			}

			setDropRequest({at, characters, files, point});
		},
		[store]
	);

	/**
	 * Uploads the dropped files as the thing the author picked, and writes what belongs in
	 * the scene.
	 *
	 * Everything goes through the library rather than into the scene directly, because scene
	 * YAML addresses assets by NAME and a name only exists once the store has one: dropping a
	 * PNG here and adding it in the asset manager have to produce the same entry. Uploading
	 * is the whole reason this is asynchronous, and the reason a drop is not a gesture —
	 * there is nothing optimistic to paint while the bytes are being read.
	 *
	 * Stage entries are placed one at a time, each waiting for the previous one to reach the
	 * document: a gesture is one edit built against one snapshot of the block, so two entries
	 * spliced from the same snapshot would both claim the same offset. The first lands where
	 * it was dropped and the rest stack to its right, so a five-file drop is five sprites the
	 * author can pull apart rather than one pile to dig through.
	 */
	const runDropChoice = React.useCallback(
		async (request: DropRequest, choice: DropChoice) => {
			const {at, files} = request;

			setDropRequest(undefined);

			try {
				if (choice.kind === 'frame') {
					// Frames are not stage entries: the character they belong to may not even
					// be in this scene, and a pose is chosen with `frame:` on an entity that
					// already exists. Nothing is written to the text.
					const frames = await framesFromFiles(store, choice.character, files);

					await store.putCharacter({...choice.character, frames});
				} else if (choice.kind === 'bg') {
					// One scene has one backdrop, so every file is uploaded — the author
					// dropped them, they belong in the library — but only the first is
					// pointed at. `bg:` takes no position, so the drop point is unused.
					const uploaded = await Promise.all(
						files.map(file => store.putAsset(file, {kind: 'bg'}))
					);

					if (uploaded[0]) {
						dropAssetRef.current(
							{
								label: uploaded[0].meta.name,
								ref: uploaded[0].meta.name,
								target: 'bg'
							},
							at
						);
					}
				} else {
					// Asked once for the batch, then mutated per file by `characterFromFile`.
					const taken =
						choice.kind === 'character' ? await store.takenNames() : new Set<string>();
					let placed = 0;

					for (const file of files) {
						try {
							const ref =
								choice.kind === 'character'
									? await characterFromFile(store, file, taken)
									: (await store.putAsset(file, {kind: 'object'})).meta.name;
							const before = textRef.current;

							dropAssetRef.current(
								{
									label: ref,
									ref,
									target: choice.kind === 'character' ? 'cast' : 'prop'
								},
								{x: roundCoord(at.x + placed * DROP_STACK_STEP), y: at.y}
							);
							placed++;

							if (placed < files.length) {
								await textChanged(textRef, before);
							}
						} catch (error) {
							console.error(`Could not add ${file.name} to the scene`, error);
						}
					}
				}
			} catch (error) {
				console.error('Could not add a dropped image to the library', error);
			}

			// The resolver caches assets by name, and the asset dialogs cache the list. Both
			// were built before this file existed.
			assets.invalidate?.();
			refreshAssetLibrary();
		},
		[assets, store]
	);

	/** Arrow-key move. Reads the CURRENT position each time, so it cannot drift. */
	const nudge = React.useCallback(
		(dx: number, dy: number) => {
			const step =
				NUDGE_STEP * (shiftHeld.current ? NUDGE_SHIFT_MULTIPLIER : 1);
			const writes: EntityKeyWrite[] = [];
			const next: Record<string, {at: {x: number; y: number}}> = {};

			for (const id of selection) {
				const entity = stage.entities?.[id];

				if (!entity) {
					continue;
				}

				const at = {
					x: roundCoord(entity.at.x + dx * step),
					y: roundCoord(entity.at.y + dy * step)
				};

				next[id] = {at};
				writes.push({id, kind: entity.kind, key: 'at', ref: entity.ref, value: at});
			}

			mergePatch(next);
			commit(writes, NUDGE_ORIGIN);
		},
		[commit, mergePatch, selection, stage]
	);

	/**
	 * Put an entity back where a ghost in the measuring overlay says it was.
	 *
	 * The same write a drag makes, with the coordinate read off the past instead of off the
	 * pointer — including the `of:` subtraction, because the ghost is drawn at an ABSOLUTE
	 * point and the YAML holds an offset. Scale rides along only when it differs: writing
	 * `scale: 1` onto every jump would fill the scene with the default.
	 */
	const jumpTo = React.useCallback(
		(id: string, at: {x: number; y: number}, scale: number) => {
			const entity = stage.entities?.[id];

			if (!entity) {
				return;
			}

			const offset = offsets[id];
			const local = {
				x: roundCoord(offset ? at.x - offset.x : at.x),
				y: roundCoord(offset ? at.y - offset.y : at.y)
			};
			const writes: EntityKeyWrite[] = [
				{id, kind: entity.kind, key: 'at', ref: entity.ref, value: local}
			];

			if (roundCoord(scale) !== roundCoord(entity.scale)) {
				writes.push({
					id,
					kind: entity.kind,
					key: 'scale',
					ref: entity.ref,
					// Same bargain the resize handle strikes: 1 is the default, so at the
					// top of the scene it is REMOVED, and on a beat it has to be said out
					// loud because a beat inherits what it does not mention.
					reset: 1,
					value: scale === 1 ? undefined : roundCoord(scale)
				});
			}

			mergePatch({[id]: {at: local}});
			commit(writes, EDIT_ORIGIN);
		},
		[commit, mergePatch, offsets, stage]
	);

	// Every gesture below reads the value it is changing out of the stage the author is
	// looking at and writes the next one. Nothing is remembered between presses, so a key
	// held down cannot drift away from the text.

	const flip = React.useCallback(
		() => commit(flipWrites(stage, selection), EDIT_ORIGIN),
		[commit, selection, stage]
	);

	const stepZ = React.useCallback(
		(delta: number) => commit(zWrites(stage, selection, delta), Z_ORIGIN),
		[commit, selection, stage]
	);

	const setFrame = React.useCallback(
		(frame: string | undefined) => {
			const write = frameWrite(stage.entities?.[selection[0]], frame);

			if (write) {
				commit([write], EDIT_ORIGIN);
			}
		},
		[commit, selection, stage]
	);

	const remove = React.useCallback(() => {
		commit(deleteWrites(stage, selection), EDIT_ORIGIN);
		clear();
	}, [clear, commit, selection, stage]);

	/**
	 * The passages this scene can reach: every `links:` target, plus any `[[link]]` written
	 * outside the block — prose under the scene is a way out too.
	 *
	 * A `[[stay]]` inside bubble text is NOT one of them: it is a link NAME that `links:`
	 * routes to a passage, and counting it as well would make a one-way scene look like two.
	 * Names that no `links:` entry claims are counted, because in a scene without a `links:`
	 * block that is exactly what a plain Twine link is.
	 */
	const forward = React.useMemo(() => {
		const links = parse.result?.scene.links ?? {};
		const names = new Set<string>();

		for (const link of Object.values(links)) {
			if (link.to) {
				names.add(link.to);
			}
		}

		for (const name of parseLinks(text, true)) {
			if (!(name in links)) {
				names.add(name);
			}
		}

		// Only passages that exist can be opened. `passages` is absent in a bare preview, and
		// then the name is taken on trust.
		return passages
			? [...names].filter(name => passages.some(p => p.name === name))
			: [...names];
	}, [parse.result, passages, text]);

	/** The single way out, if there is exactly one and we can open it. */
	const nextScene = onOpenPassage && forward.length === 1 ? forward[0] : undefined;

	const selectedEntities = React.useMemo(
		() =>
			selection
				.map(id => stage.entities?.[id])
				.filter((entity): entity is NonNullable<typeof entity> => !!entity),
		[selection, stage]
	);

	/**
	 * Everything that would change the text is off while the lock is on.
	 *
	 * One flag, checked in one place: the overlay already treats "not editable" as "select
	 * and look, write nothing" for the case where there is no CodeMirror at all, so the lock
	 * reuses that path rather than inventing a second one the gestures would have to learn.
	 */
	const editable = !!editor && !locked;

	/**
	 * Why a gesture on the selection would go nowhere, if it would.
	 *
	 * Computed up front rather than discovered at commit, because a drag that is refused
	 * after the fact just snaps the sprite back and reads as a broken editor. The author is
	 * told BEFORE they reach for it, and the commit still refuses as the backstop.
	 */
	const blockedNote = React.useMemo(() => {
		if (!editable || selection.length === 0) {
			return undefined;
		}

		const scene = parse.result?.scene;

		for (const id of selection) {
			const {blocked} = planEntityWrite(scene, beat, kindOf(id), id);

			if (blocked) {
				return blocked.owner
					? t('dialogs.passageEdit.scenePreview.beatBelongsTo', {
							beat: blocked.beat + 1,
							name: blocked.owner
					  })
					: t('dialogs.passageEdit.scenePreview.beatStagesNothing', {
							beat: blocked.beat + 1
					  });
			}
		}

		return undefined;
	}, [beat, editable, kindOf, parse.result, selection, t]);

	// The beat on screen, lit up in the text the author is typing in.
	useActiveBeatMark(
		editor ?? undefined,
		beat > 0 ? parse.result?.beatSpans?.[beat - 1] : undefined,
		block?.lineOffset ?? 0
	);
	/**
	 * The beat a bubble gesture writes to: the scrubber position, less the S0 stage.
	 *
	 * Never in full screen. That is reading mode — a tap anywhere steps forward — and the
	 * bubble frame would swallow every tap that landed on the words.
	 */
	const bubbleBeat =
		editable &&
		!fullScreen &&
		(shownBeat?.kind === 'say' || shownBeat?.kind === 'box')
			? beat - 1
			: undefined;

	function toggleGrid() {
		setGrid(value => {
			window.localStorage.setItem(GRID_KEY, String(!value));

			return !value;
		});
	}

	function toggleTimelineLabels() {
		setTimelineLabels(value => {
			window.localStorage.setItem(TIMELINE_LABELS_KEY, String(!value));

			return !value;
		});
	}

	function toggleLock() {
		setLocked(value => {
			window.localStorage.setItem(LOCKED_KEY, String(!value));

			return !value;
		});
	}

	/**
	 * Double click on a sprite: show me this thing in the asset manager.
	 *
	 * Only the scene's `ref` is known here — a character id or an asset name out of one
	 * namespace — so the manager resolves it, the same way `resolveEntity` does when it
	 * draws the sprite. The dialog is opened with no props so that an already-open manager
	 * is raised rather than duplicated (the reducer dedupes on `props`), and the target
	 * rides alongside on the focus channel.
	 */
	function handleOpenEntity(id: EntityId) {
		const ref = stage.entities?.[id]?.ref?.trim();

		if (!ref) {
			return;
		}

		dispatch({component: SlidersAssetsDialog, type: 'addDialog'});
		requestAssetFocus(ref);
	}

	function toggleBgLock() {
		setBgLocked(value => {
			window.localStorage.setItem(BG_LOCKED_KEY, String(!value));

			return !value;
		});
	}

	function goToPreviousBeat() {
		setPlaying(false);
		setBeat(b => Math.max(0, b - 1));
	}

	function goToNextBeat() {
		setPlaying(false);
		stepBeat();
	}

	/**
	 * The full-screen tap, which is the reader asking for the next beat rather than the
	 * author scrubbing — so unlike the Next button it does NOT stop playback.
	 *
	 * That only matters in a scene whose `autoAdvance:` is 0: playback parks on every
	 * untimed beat waiting for this tap, and a beat the author DID time has to run on its
	 * own afterwards, exactly as it does in the player. Stopping playback here would make
	 * the tap the only thing that ever moves, and a `dur:` beat would sit there needing one
	 * too.
	 */
	function advanceAsReader() {
		if (autoAdvanceMs !== 0) {
			setPlaying(false);
		}

		stepBeat();
	}

	function stepBeat() {
		// Past the last beat the scene is over, and a scene with exactly one way out has
		// only one place "next" could mean: the passage that link goes to. Two or more and
		// the author has to say which, so the button stops here.
		if (beat >= lastBeat) {
			if (nextScene) {
				onOpenPassage?.(nextScene);
			}

			return;
		}

		setBeat(b => b + 1);
	}

	function togglePlaying() {
		if (!playing && beat >= lastBeat) {
			setBeat(0);
		}

		setPlaying(p => !p);
	}

	// Keep the scrubber in range when the author edits beats out from under it.
	React.useEffect(() => {
		setBeat(current => Math.min(current, lastBeat));
	}, [lastBeat]);

	React.useEffect(() => {
		if (!playing) {
			return;
		}

		if (beat >= lastBeat) {
			setPlaying(false);
			return;
		}

		const producedBy = beat > 0 ? parse.result?.scene.beats[beat - 1] : undefined;

		// `autoAdvance: 0` is the author asking the READER to click, and full screen is the
		// only place in the editor where there is a reader to ask: the stage is a tap target
		// there (see `canAdvance`), exactly as it is in the player. So playback stops on
		// this beat and the tap moves it on, which is what the published story does.
		//
		// Docked, that affordance does not exist, so honouring the wait would be a stage
		// that freezes for no visible reason. It takes the standard beat instead, and the
		// author sees the pacing of everything they DID time.
		if (
			producedBy?.dur === undefined &&
			producedBy?.kind !== 'wait' &&
			autoAdvanceMs === 0 &&
			fullScreen
		) {
			return;
		}

		const timer = window.setTimeout(
			() => setBeat(b => b + 1),
			beatHoldMs(producedBy, holdMs)
		);

		return () => window.clearTimeout(timer);
	}, [autoAdvanceMs, beat, fullScreen, holdMs, lastBeat, parse.result, playing]);

	// Full screen takes focus, for two reasons that happen to want the same thing: the
	// preview's own keys resolve from where focus is, and Escape has to be the preview's
	// rather than the dialog card's -- a header button still holding focus would close the
	// whole dialog on the first press.
	React.useEffect(() => {
		if (fullScreen) {
			root.current?.focus();
		}
	}, [fullScreen]);

	React.useEffect(() => {
		if (!fullScreen) {
			return;
		}

		const onKey = (event: KeyboardEvent) => {
			// `scene.deselect` owns Escape while something is selected and calls
			// preventDefault, so the first Escape drops the selection and the second one
			// leaves full screen.
			if (event.key === 'Escape' && !event.defaultPrevented) {
				onFullScreenChange(false);
			}
		};

		// The document rather than the window: full screen portals the preview to the body,
		// and a listener on the window would sit above anything that stops propagation on
		// the way up. Listeners on the document itself still run.
		document.addEventListener('keydown', onKey);

		return () => document.removeEventListener('keydown', onKey);
	}, [fullScreen, onFullScreenChange]);

	// Viewer keys, unmodified, in the preview's own scope: they only fire once
	// focus is inside the preview, so left and right still move the cursor
	// while the author is writing the scene above.

	// Beat navigation and nudging share the arrow keys, so exactly one of the two is ever
	// enabled. The dispatcher skips disabled commands before it looks at bindings, which
	// makes this deterministic rather than a race between registration orders — and
	// Escape, by clearing the selection, is how the arrows go back to the scrubber.

	useCommand({
		allowRepeat: true,
		enabled: beat > 0 && selection.length === 0,
		id: 'scene.previousBeat',
		label: t('hotkeys.commands.scene.previousBeat'),
		run: goToPreviousBeat,
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: (beat < lastBeat || !!nextScene) && selection.length === 0,
		id: 'scene.nextBeat',
		label: t('hotkeys.commands.scene.nextBeat'),
		run: goToNextBeat,
		scope: 'scene-preview'
	});

	useCommand({
		id: 'scene.play',
		label: t('hotkeys.commands.scene.play'),
		run: togglePlaying,
		scope: 'scene-preview'
	});

	useCommand({
		id: 'scene.fullScreen',
		label: t('hotkeys.commands.scene.fullScreen'),
		run: () => onFullScreenChange(!fullScreen),
		scope: 'scene-preview'
	});

	// Deselecting is not an edit, so it survives the lock.
	useCommand({
		enabled: selection.length > 0,
		id: 'scene.deselect',
		label: t('hotkeys.commands.scene.deselect'),
		run: clear,
		scope: 'scene-preview'
	});

	useCommand({
		// Off when the scene is what locked the stage: the key would write a preference the
		// file overrides, so it would look like a hotkey that does nothing.
		enabled: !stageLockedByScene,
		id: 'scene.toggleLock',
		label: t('hotkeys.commands.scene.toggleLock'),
		run: toggleLock,
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: editable && selection.length > 0,
		id: 'scene.nudgeLeft',
		label: t('hotkeys.commands.scene.nudgeLeft'),
		run: () => nudge(-1, 0),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: editable && selection.length > 0,
		id: 'scene.nudgeRight',
		label: t('hotkeys.commands.scene.nudgeRight'),
		run: () => nudge(1, 0),
		scope: 'scene-preview'
	});

	// Scene y is UP (spec 02), so the up arrow adds.

	useCommand({
		allowRepeat: true,
		enabled: editable && selection.length > 0,
		id: 'scene.nudgeUp',
		label: t('hotkeys.commands.scene.nudgeUp'),
		run: () => nudge(0, 1),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: editable && selection.length > 0,
		id: 'scene.nudgeDown',
		label: t('hotkeys.commands.scene.nudgeDown'),
		run: () => nudge(0, -1),
		scope: 'scene-preview'
	});

	// The rest of the visual editor. All of them need a selection, and all of them write
	// through the same one-gesture-one-edit path the drag uses.

	useCommand({
		enabled: editable && selection.length > 0,
		id: 'scene.flip',
		label: t('hotkeys.commands.scene.flip'),
		run: flip,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: editable && selection.length > 0,
		id: 'scene.delete',
		label: t('hotkeys.commands.scene.delete'),
		run: remove,
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: editable && selection.length > 0,
		id: 'scene.zBack',
		label: t('hotkeys.commands.scene.zBack'),
		run: () => stepZ(-1),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: editable && selection.length > 0,
		id: 'scene.zFront',
		label: t('hotkeys.commands.scene.zFront'),
		run: () => stepZ(1),
		scope: 'scene-preview'
	});

	// Undo while focus is on the stage means the drag that was just made, and that lives in
	// the passage's CodeMirror history -- every gesture here writes through that document
	// (spec 07), so the store's own undo stack never saw it. The lock is deliberately not
	// checked: locking the stage stops new edits, it does not disown the old ones, and an
	// author who locks after a mistaken drag would otherwise have no way back.

	useCommand({
		allowRepeat: true,
		enabled: !!editor,
		id: 'scene.undo',
		label: t('hotkeys.commands.scene.undo'),
		run: () => editor?.undo(),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: !!editor,
		id: 'scene.redo',
		label: t('hotkeys.commands.scene.redo'),
		run: () => editor?.redo(),
		scope: 'scene-preview'
	});

	if (!parse.hasScene) {
		return null;
	}

	/**
	 * Full screen is the player: there is nothing else on the screen to click, so a tap on
	 * the stage is the reader asking for the next beat. Small screen keeps the plain
	 * editor behaviour — a click there is aimed at the passage the preview sits under.
	 *
	 * Same reach as the next button, link guard aside: past the last beat a scene with one
	 * way out steps into it, and one with several stops and lets the reader pick.
	 */
	const canAdvance = fullScreen && !beatHasLink && (beat < lastBeat || !!nextScene);

	const bar = (
		<div className="scene-preview-bar">
			<IconButton
			commandId="scene.previousBeat"
				disabled={beat <= 0}
				icon={<IconChevronLeft />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.previousBeat')}
				onClick={goToPreviousBeat}
			/>
			<span className="scene-preview-beat" data-testid="scene-preview-beat">
				{beat} / {lastBeat}
			</span>
			<IconButton
			commandId="scene.nextBeat"
				disabled={beat >= lastBeat && !nextScene}
				icon={<IconChevronRight />}
				iconOnly
				label={
					beat >= lastBeat && nextScene
						? t('dialogs.passageEdit.scenePreview.nextScene', {
								name: nextScene
						  })
						: t('dialogs.passageEdit.scenePreview.nextBeat')
				}
				onClick={goToNextBeat}
			/>
			<IconButton
			commandId="scene.play"
				icon={playing ? <IconPlayerPause /> : <IconPlayerPlay />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.play')}
				onClick={togglePlaying}
			/>
			{/* Next to play rather than next to the locks: it is what the strip
			    below shows, and the strip is part of reading the scene's
			    timing, not part of staging it. */}
			<IconButton
				icon={<IconTimeline />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.timelineLabels')}
				onClick={toggleTimelineLabels}
				selectable
				selected={timelineLabels}
			/>
			{/* Sits beside the lock rather than in the selection row: the grid
			    is how the author reads the stage, and nothing has to be
			    selected to want to read it. */}
			<IconButton
				icon={<IconGridDots />}
				iconOnly
				label={t('dialogs.passageEdit.scenePreview.grid')}
				onClick={toggleGrid}
				selectable
				selected={grid}
			/>
			{/* Beside the stage lock, because it is the same idea one notch
			    narrower: this one pins the shot and leaves the cast free. */}
			<IconButton
				disabled={!!bgLockedByScene}
				icon={bgLocked ? <IconPhotoShield /> : <IconPhoto />}
				iconOnly
				label={t(
					bgLockedByScene
						? 'dialogs.passageEdit.scenePreview.lockedByScene'
						: bgLocked
						? 'dialogs.passageEdit.scenePreview.unlockBg'
						: 'dialogs.passageEdit.scenePreview.lockBg'
				)}
				onClick={toggleBgLock}
				selectable
				selected={bgLocked}
			/>
			{/* Always here, selection or not: the lock is how the author stops
			    the stage editing the file, so it cannot be a control that only
			    appears once something has been grabbed. */}
			<IconButton
			commandId="scene.toggleLock"
				disabled={!!stageLockedByScene}
				icon={locked ? <IconLock /> : <IconLockOpen />}
				iconOnly
				label={t(
					stageLockedByScene
						? 'dialogs.passageEdit.scenePreview.lockedByScene'
						: locked
						? 'dialogs.passageEdit.scenePreview.unlock'
						: 'dialogs.passageEdit.scenePreview.lock'
				)}
				onClick={toggleLock}
				selectable
				selected={locked}
			/>
			{/* Entering full screen is a header control on the dialog card, next to
			    maximize. LEAVING it cannot be: full screen portals out of the card and
			    the header goes with it, so the way back has to live in the bar. */}
			{fullScreen && (
				<span className="scene-preview-bar-right">
					<IconButton
						commandId="scene.fullScreen"
						icon={<IconArrowsMinimize />}
						iconOnly
						label={t('dialogs.passageEdit.scenePreview.fullScreen')}
						onClick={() => onFullScreenChange(false)}
					/>
				</span>
			)}
		</div>
	);

	// The stage itself--everything below the bar.
	const stageBody = (
		<StageEditorOverlay
			bgLocked={bgLocked}
			blockedNote={blockedNote}
			editable={editable}
			grid={grid}
			origStage={origStage}
			prevStage={prevStage}
			onAdvance={canAdvance ? advanceAsReader : undefined}
			onCameraPatch={setCamera}
			onCancel={handleCancel}
			onCommit={handleCommit}
			onDropAsset={handleDropAsset}
			onDropFiles={handleDropFiles}
			// Absent when a click could not write: locked stage, or the scrubber parked on
			// a beat this entity has no line in. `blockedNote` then tells the author why.
			onJumpTo={editable && !blockedNote ? jumpTo : undefined}
			onOpenEntity={handleOpenEntity}
			onPatch={setPatch}
			parentOffsets={offsets}
			onSelect={select}
			onToggleFullScreen={() => onFullScreenChange(!fullScreen)}
			player={fullScreen}
			renderer={renderer}
			seal={seal}
			selection={selection}
			stage={stage}
		>
			<SceneStage
				animate={playing}
				assets={assets}
				beat={drawnBeat}
				onLink={handleLink}
				onRenderer={handleRenderer}
				stage={stage}
				stylesheet={stylesheet}
			/>
			{/* Over the stage rather than above it. A row that appeared with the
			    selection would resize the stage under the pointer, and the whole scene
			    would jump on the very click that selected a sprite. A click on the
			    stage selects, so full screen moved to a double click; the bar button
			    above is still the keyboard-accessible path. */}
			<BubbleEditor
				beat={bubbleBeat}
				editable={editable}
				onCommit={handleBubbleCommit}
				onDraft={setBubbleDraft}
				style={shownBeat?.kind === 'say' || shownBeat?.kind === 'box' ? shownBeat.style : undefined}
			/>
			<BeatProps
				autoAdvanceMs={holdMs}
				beat={shownBeat}
				editable={editable}
				onSetBubble={handleBeatBubble}
				onSetKey={handleBeatKey}
			/>
			<StageSelectionControls
				assets={assets}
				editable={editable}
				entities={selectedEntities}
				note={blockedNote}
				onDelete={remove}
				onFlip={flip}
				onFrame={setFrame}
				onStepZ={stepZ}
			/>
			{/* A dropped file is not a background, an object, a cast member or a pose until
			    the author says which, so the drop stops here and asks. */}
			{dropRequest && (
				<SceneDropMenu
					characters={dropRequest.characters}
					count={dropRequest.files.length}
					onCancel={() => setDropRequest(undefined)}
					onChoose={choice => runDropChoice(dropRequest, choice)}
					point={dropRequest.point}
				/>
			)}
			{/* The player's own controls, in the corner the stage needs least.
			    Faint until asked for: full screen exists so the scene can fill
			    the screen, and a bar of chrome across it would undo that. Inside
			    the stage rather than under it, so the error list — which is the
			    author's, not the reader's — never pushes it off the corner. */}
			{fullScreen && lastBeat > 0 && (
				<div className="scene-preview-nav" data-testid="scene-preview-nav">
					<button
						aria-label={t('dialogs.passageEdit.scenePreview.previousBeat')}
						disabled={beat <= 0}
						onClick={goToPreviousBeat}
						type="button"
					>
						<IconChevronLeft />
					</button>
					<span className="scene-preview-nav-count">
						{beat} / {lastBeat}
					</span>
					<button
						aria-label={
							beat >= lastBeat && nextScene
								? t('dialogs.passageEdit.scenePreview.nextScene', {
										name: nextScene
								  })
								: t('dialogs.passageEdit.scenePreview.nextBeat')
						}
						disabled={beat >= lastBeat && !nextScene}
						onClick={goToNextBeat}
						type="button"
					>
						<IconChevronRight />
					</button>
				</div>
			)}
		</StageEditorOverlay>
	);

	const body = (
		<div
			className={classNames('scene-preview', {'full-screen': fullScreen})}
			data-hotkey-scope="scene-preview"
			data-testid="scene-preview"
			ref={root}
			// So full screen can take focus off the dialog card's chrome. Never in the tab
			// order: everything here is reachable through the controls in the bar.
			tabIndex={-1}
		>
			{bar}
			<BeatTimeline
				autoAdvanceMs={holdMs}
				beat={beat}
				beats={parse.result?.scene.beats ?? EMPTY_BEATS}
				labels={timelineLabels}
				onBeatChange={goToBeat}
			/>
			{stageBody}
		</div>
	);

	// Full screen has to escape the dialog stack, which is a transformed ancestor: a
	// `position: fixed` box inside one resolves against the ancestor, not the viewport, so
	// the preview would be trapped in the card. Portalling to the body is what makes the
	// state work at all -- from the normal card and the maximized one alike.
	return fullScreen ? createPortal(body, document.body) : body;
};
