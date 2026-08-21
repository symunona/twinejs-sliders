import {
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconGridDots,
	IconLock,
	IconLockOpen,
	IconMaximize,
	IconMinimize,
	IconPlayerPause,
	IconPlayerPlay
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import {useCommand} from '../../../hotkeys';
import {extractSceneBlock, IndexedPassage} from '@sliders/scene-index';
import {AssetResolver, Camera, EntityId, Layer, Vec2} from '@sliders/scene-types';
import {parseLinkText} from '@sliders/render-dom';
import type {DomRenderer} from '@sliders/render-dom';
import type {AssetDragPayload} from './asset-drag';
import {
	assetDropWrites,
	deleteWrites,
	flipWrites,
	frameWrite,
	layerStepWrites,
	layerWrites,
	zWrites
} from './scene-gestures';
import {
	refreshAssetLibrary,
	slidersAssetStore
} from '../../sliders-assets/asset-store-context';
import {SceneStage} from './scene-stage';
import {StageEditorOverlay} from './stage-editor-overlay';
import {StageSelectionControls} from './stage-selection-controls';
import {roundCoord} from './stage-geometry';
import {parseLinks} from '../../../util/parse-links';
import {parentOffsets, resolveStage} from '@sliders/scene-core';
import type {SceneParse} from './use-scene-parse';
import {useStageSelection} from './use-stage-selection';
import {
	applyCameraPatch,
	applyStagePatch,
	cameraAgrees,
	isOwnOrigin,
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
}

const OPEN_KEY = 'sliders.preview.open';
const SEEN_KEY = 'sliders.preview.seen';

/**
 * The lock survives the dialog, the passage and the session.
 *
 * An author who locked the stage did so because they are writing rather than staging, and
 * a lock that let go every time the passage editor closed would be worse than none: they
 * would find out it had by moving a character.
 */
const LOCKED_KEY = 'sliders.preview.locked';

/**
 * The grid survives the dialog too, for the same reason the lock does: an author who turned
 * it on is staging, and staging outlasts one passage.
 */
const GRID_KEY = 'sliders.preview.grid';

/** How long each beat holds the screen while playing. */
const AUTO_ADVANCE_MS = 3000;

/** Arrow-key nudge, in scene units. Shift multiplies it. */
const NUDGE_STEP = 0.01;
const NUDGE_SHIFT_MULTIPLIER = 10;

/** How far apart a multi-file drop stacks its props, in scene x. */
const DROP_STACK_STEP = 0.08;

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
 * Live scene preview under the passage text (spec 06), and the visual editor on top of it
 * (spec 07).
 *
 * Collapsible, remembers its state, and opens full screen the very first time so the
 * feature is discoverable.
 */
export const ScenePreview: React.FC<ScenePreviewProps> = ({
	assets,
	editor,
	parse,
	text,
	passages,
	onOpenPassage
}) => {
	const {t} = useTranslation();
	const [open, setOpen] = React.useState(
		() => window.localStorage.getItem(OPEN_KEY) !== 'false'
	);
	const [fullScreen, setFullScreen] = React.useState(false);
	const [locked, setLocked] = React.useState(
		() => window.localStorage.getItem(LOCKED_KEY) === 'true'
	);
	const [grid, setGrid] = React.useState(
		() => window.localStorage.getItem(GRID_KEY) === 'true'
	);
	const [beat, setBeat] = React.useState(0);
	const [playing, setPlaying] = React.useState(false);
	const [renderer, setRenderer] = React.useState<DomRenderer>();
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
	const stageIds = React.useMemo(
		() => Object.keys(stage.entities ?? {}),
		[stage]
	);
	// State N is produced by beat N-1; S0 has no beat.
	const shownBeat = beat > 0 ? parse.result?.scene.beats[beat - 1] : undefined;

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
	const {clear, select, selection} = useStageSelection({
		block,
		editor,
		enabled: open,
		kindOf,
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
	 * They go through the library rather than into the scene directly, because scene YAML
	 * addresses assets by NAME and a name only exists once the store has one: dropping a PNG
	 * here and adding it in the asset manager have to produce the same entry. Uploading is
	 * the whole reason this is asynchronous, and the reason a drop is not a gesture — there
	 * is nothing optimistic to paint while the bytes are being read.
	 *
	 * Files are placed one at a time, each waiting for the previous entry to reach the
	 * document: a gesture is one edit built against one snapshot of the block, so two entries
	 * spliced from the same snapshot would both claim the same offset. The first lands where
	 * it was dropped and the rest stack to its right, so a five-file drop is five props the
	 * author can pull apart rather than one pile to dig through.
	 */
	const handleDropFiles = React.useCallback(
		async (files: File[], at: Vec2) => {
			const store = slidersAssetStore();
			let placed = 0;

			for (const file of files) {
				try {
					const {meta} = await store.putAsset(file, {kind: 'object'});
					const before = textRef.current;

					// Dropped straight onto the stage, so the entry is a prop: the author
					// pointed at a spot, and a background has no spot to point at.
					dropAssetRef.current(
						{label: meta.name, ref: meta.name, target: 'prop'},
						{x: roundCoord(at.x + placed * DROP_STACK_STEP), y: at.y}
					);
					placed++;

					if (placed < files.length) {
						await textChanged(textRef, before);
					}
				} catch (error) {
					console.error('Could not add a dropped image to the library', error);
				}
			}

			// The resolver caches assets by name, and the asset dialogs cache the list. Both
			// were built before this file existed.
			assets.invalidate?.();
			refreshAssetLibrary();
		},
		[assets]
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

	// Every gesture below reads the value it is changing out of the stage the author is
	// looking at and writes the next one. Nothing is remembered between presses, so a key
	// held down cannot drift away from the text.

	const flip = React.useCallback(
		() => commit(flipWrites(stage, selection), EDIT_ORIGIN),
		[commit, selection, stage]
	);

	const setLayer = React.useCallback(
		(layer: Layer) => commit(layerWrites(stage, selection, layer), EDIT_ORIGIN),
		[commit, selection, stage]
	);

	const stepLayer = React.useCallback(
		(delta: number) =>
			commit(layerStepWrites(stage, selection, delta), EDIT_ORIGIN),
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

	function toggleGrid() {
		setGrid(value => {
			window.localStorage.setItem(GRID_KEY, String(!value));

			return !value;
		});
	}

	function toggleLock() {
		setLocked(value => {
			window.localStorage.setItem(LOCKED_KEY, String(!value));

			return !value;
		});
	}

	// The first time the user opens the preview it comes up full screen (D12). Tied to
	// the click rather than to "a scene appeared", which would hijack the screen while
	// they're still typing the block out.
	function handleToggle() {
		const next = !open;

		setOpen(next);

		if (next && !window.localStorage.getItem(SEEN_KEY)) {
			window.localStorage.setItem(SEEN_KEY, '1');
			setFullScreen(true);
		}
	}

	function goToPreviousBeat() {
		setPlaying(false);
		setBeat(b => Math.max(0, b - 1));
	}

	function goToNextBeat() {
		setPlaying(false);

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

	React.useEffect(() => {
		window.localStorage.setItem(OPEN_KEY, String(open));
	}, [open]);

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

		const timer = window.setTimeout(() => setBeat(b => b + 1), AUTO_ADVANCE_MS);

		return () => window.clearTimeout(timer);
	}, [beat, lastBeat, playing]);

	React.useEffect(() => {
		if (!fullScreen) {
			return;
		}

		const onKey = (event: KeyboardEvent) => {
			// `scene.deselect` owns Escape while something is selected and calls
			// preventDefault, so the first Escape drops the selection and the second one
			// leaves full screen.
			if (event.key === 'Escape' && !event.defaultPrevented) {
				setFullScreen(false);
			}
		};

		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [fullScreen]);

	// Viewer keys, unmodified, in the preview's own scope: they only fire once
	// focus is inside the preview, so left and right still move the cursor
	// while the author is writing the scene above.

	useCommand({
		id: 'scene.togglePreview',
		label: t('hotkeys.commands.scene.togglePreview'),
		run: handleToggle,
		scope: 'scene-preview'
	});

	// Beat navigation and nudging share the arrow keys, so exactly one of the two is ever
	// enabled. The dispatcher skips disabled commands before it looks at bindings, which
	// makes this deterministic rather than a race between registration orders — and
	// Escape, by clearing the selection, is how the arrows go back to the scrubber.

	useCommand({
		allowRepeat: true,
		enabled: open && beat > 0 && selection.length === 0,
		id: 'scene.previousBeat',
		label: t('hotkeys.commands.scene.previousBeat'),
		run: goToPreviousBeat,
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && (beat < lastBeat || !!nextScene) && selection.length === 0,
		id: 'scene.nextBeat',
		label: t('hotkeys.commands.scene.nextBeat'),
		run: goToNextBeat,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open,
		id: 'scene.play',
		label: t('hotkeys.commands.scene.play'),
		run: togglePlaying,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open,
		id: 'scene.fullScreen',
		label: t('hotkeys.commands.scene.fullScreen'),
		run: () => setFullScreen(f => !f),
		scope: 'scene-preview'
	});

	// Deselecting is not an edit, so it survives the lock.
	useCommand({
		enabled: open && selection.length > 0,
		id: 'scene.deselect',
		label: t('hotkeys.commands.scene.deselect'),
		run: clear,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open,
		id: 'scene.toggleLock',
		label: t('hotkeys.commands.scene.toggleLock'),
		run: toggleLock,
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && editable && selection.length > 0,
		id: 'scene.nudgeLeft',
		label: t('hotkeys.commands.scene.nudgeLeft'),
		run: () => nudge(-1, 0),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && editable && selection.length > 0,
		id: 'scene.nudgeRight',
		label: t('hotkeys.commands.scene.nudgeRight'),
		run: () => nudge(1, 0),
		scope: 'scene-preview'
	});

	// Scene y is UP (spec 02), so the up arrow adds.

	useCommand({
		allowRepeat: true,
		enabled: open && editable && selection.length > 0,
		id: 'scene.nudgeUp',
		label: t('hotkeys.commands.scene.nudgeUp'),
		run: () => nudge(0, 1),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && editable && selection.length > 0,
		id: 'scene.nudgeDown',
		label: t('hotkeys.commands.scene.nudgeDown'),
		run: () => nudge(0, -1),
		scope: 'scene-preview'
	});

	// The rest of the visual editor. All of them need a selection, and all of them write
	// through the same one-gesture-one-edit path the drag uses.

	useCommand({
		enabled: open && editable && selection.length > 0,
		id: 'scene.flip',
		label: t('hotkeys.commands.scene.flip'),
		run: flip,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open && editable && selection.length > 0,
		id: 'scene.delete',
		label: t('hotkeys.commands.scene.delete'),
		run: remove,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open && editable && selection.length > 0,
		id: 'scene.layerBack',
		label: t('hotkeys.commands.scene.layerBack'),
		run: () => stepLayer(-1),
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open && editable && selection.length > 0,
		id: 'scene.layerFront',
		label: t('hotkeys.commands.scene.layerFront'),
		run: () => stepLayer(1),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && editable && selection.length > 0,
		id: 'scene.zBack',
		label: t('hotkeys.commands.scene.zBack'),
		run: () => stepZ(-1),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && editable && selection.length > 0,
		id: 'scene.zFront',
		label: t('hotkeys.commands.scene.zFront'),
		run: () => stepZ(1),
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

	const body = (
		<div
			className={classNames('scene-preview', {
				open,
				'full-screen': fullScreen
			})}
			data-hotkey-scope="scene-preview"
			data-testid="scene-preview"
		>
			<div className="scene-preview-bar">
				<IconButton
					icon={
						open ? <IconChevronDown /> : <IconChevronRight />
					}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.toggle')}
					onClick={handleToggle}
					selectable
					selected={open}
				/>
				<span className="scene-preview-title">
					{t('dialogs.passageEdit.scenePreview.title')}
				</span>
				<span className="scene-preview-spacer" />
				{open && (
					<>
						<IconButton
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
							icon={playing ? <IconPlayerPause /> : <IconPlayerPlay />}
							iconOnly
							label={t('dialogs.passageEdit.scenePreview.play')}
							onClick={togglePlaying}
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
						{/* Always here, selection or not: the lock is how the author stops
						    the stage editing the file, so it cannot be a control that only
						    appears once something has been grabbed. */}
						<IconButton
							icon={locked ? <IconLock /> : <IconLockOpen />}
							iconOnly
							label={t(
								locked
									? 'dialogs.passageEdit.scenePreview.unlock'
									: 'dialogs.passageEdit.scenePreview.lock'
							)}
							onClick={toggleLock}
							selectable
							selected={locked}
						/>
						<IconButton
							icon={fullScreen ? <IconMinimize /> : <IconMaximize />}
							iconOnly
							label={t('dialogs.passageEdit.scenePreview.fullScreen')}
							onClick={() => setFullScreen(f => !f)}
						/>
					</>
				)}
			</div>
			{open && (
				<>
					{/* A click on the stage selects, so full screen moved to a double
					    click. The toolbar button above is still the keyboard-accessible
					    path, and `scene.fullScreen` still works. */}
					<StageSelectionControls
						assets={assets}
						editable={editable}
						entities={selectedEntities}
						onDelete={remove}
						onFlip={flip}
						onFrame={setFrame}
						onLayer={setLayer}
					/>
					<StageEditorOverlay
						editable={editable}
						grid={grid}
						onAdvance={canAdvance ? goToNextBeat : undefined}
						onCameraPatch={setCamera}
						onCancel={handleCancel}
						onCommit={handleCommit}
						onDropAsset={handleDropAsset}
						onDropFiles={handleDropFiles}
						onPatch={setPatch}
						parentOffsets={offsets}
						onSelect={select}
						onToggleFullScreen={() => setFullScreen(f => !f)}
						player={fullScreen}
						renderer={renderer}
						seal={seal}
						selection={selection}
						stage={stage}
					>
						<SceneStage
							animate={playing}
							assets={assets}
							beat={shownBeat}
							onLink={handleLink}
							onRenderer={handleRenderer}
							stage={stage}
						/>
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
				</>
			)}
		</div>
	);

	// The passage dialog stack is a transformed ancestor, which would make
	// `position: fixed` resolve against IT rather than the viewport. Portal to the body
	// so full screen is actually full screen.
	return fullScreen ? createPortal(body, document.body) : body;
};
