import {
	IconAlertTriangle,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
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
import {SceneStage} from './scene-stage';
import {StageEditorOverlay} from './stage-editor-overlay';
import {StageSelectionControls} from './stage-selection-controls';
import {roundCoord} from './stage-geometry';
import {useSceneParse} from './use-scene-parse';
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
	assets: AssetResolver;
	text: string;
	/** The whole story. Needed only so `from:` can resolve across passages. */
	passages?: IndexedPassage[];
	/**
	 * The passage's CodeMirror. Every visual edit is a text edit through this document and
	 * never around it, so Twine's undo works for free (spec 07). Absent when the author
	 * turned CodeMirror off in preferences: the stage is then selectable but read-only.
	 */
	editor?: CodeMirror.Editor;
	/** Called when the user clicks an error, so the editor can jump to that line. */
	onGoToLine?: (line: number) => void;
}

const OPEN_KEY = 'sliders.preview.open';
const SEEN_KEY = 'sliders.preview.seen';

/** Arrow-key nudge, in scene units. Shift multiplies it. */
const NUDGE_STEP = 0.01;
const NUDGE_SHIFT_MULTIPLIER = 10;

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
	text,
	passages,
	onGoToLine
}) => {
	const {t} = useTranslation();
	const parse = useSceneParse(text, passages);
	const [open, setOpen] = React.useState(
		() => window.localStorage.getItem(OPEN_KEY) !== 'false'
	);
	const [fullScreen, setFullScreen] = React.useState(false);
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
	const stage = React.useMemo(
		() => applyCameraPatch(applyStagePatch(parsedStage, patch), cameraPatch),
		[cameraPatch, parsedStage, patch]
	);
	const stageIds = React.useMemo(
		() => Object.keys(stage.entities ?? {}),
		[stage]
	);
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

	const selectedEntities = React.useMemo(
		() =>
			selection
				.map(id => stage.entities?.[id])
				.filter((entity): entity is NonNullable<typeof entity> => !!entity),
		[selection, stage]
	);

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
		setBeat(b => Math.min(lastBeat, b + 1));
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

		const timer = window.setTimeout(() => setBeat(b => b + 1), 900);

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
		enabled: open && beat < lastBeat && selection.length === 0,
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

	useCommand({
		enabled: open && selection.length > 0,
		id: 'scene.deselect',
		label: t('hotkeys.commands.scene.deselect'),
		run: clear,
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && selection.length > 0,
		id: 'scene.nudgeLeft',
		label: t('hotkeys.commands.scene.nudgeLeft'),
		run: () => nudge(-1, 0),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && selection.length > 0,
		id: 'scene.nudgeRight',
		label: t('hotkeys.commands.scene.nudgeRight'),
		run: () => nudge(1, 0),
		scope: 'scene-preview'
	});

	// Scene y is UP (spec 02), so the up arrow adds.

	useCommand({
		allowRepeat: true,
		enabled: open && selection.length > 0,
		id: 'scene.nudgeUp',
		label: t('hotkeys.commands.scene.nudgeUp'),
		run: () => nudge(0, 1),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && selection.length > 0,
		id: 'scene.nudgeDown',
		label: t('hotkeys.commands.scene.nudgeDown'),
		run: () => nudge(0, -1),
		scope: 'scene-preview'
	});

	// The rest of the visual editor. All of them need a selection, and all of them write
	// through the same one-gesture-one-edit path the drag uses.

	useCommand({
		enabled: open && selection.length > 0,
		id: 'scene.flip',
		label: t('hotkeys.commands.scene.flip'),
		run: flip,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open && selection.length > 0,
		id: 'scene.delete',
		label: t('hotkeys.commands.scene.delete'),
		run: remove,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open && selection.length > 0,
		id: 'scene.layerBack',
		label: t('hotkeys.commands.scene.layerBack'),
		run: () => stepLayer(-1),
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open && selection.length > 0,
		id: 'scene.layerFront',
		label: t('hotkeys.commands.scene.layerFront'),
		run: () => stepLayer(1),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && selection.length > 0,
		id: 'scene.zBack',
		label: t('hotkeys.commands.scene.zBack'),
		run: () => stepZ(-1),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && selection.length > 0,
		id: 'scene.zFront',
		label: t('hotkeys.commands.scene.zFront'),
		run: () => stepZ(1),
		scope: 'scene-preview'
	});

	if (!parse.hasScene) {
		return null;
	}

	const errors = parse.errors.filter(e => e.severity === 'error');
	const warnings = parse.errors.filter(e => e.severity === 'warning');

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
				{(errors.length > 0 || warnings.length > 0) && (
					<span
						className={classNames('scene-preview-badge', {
							error: errors.length > 0
						})}
						data-testid="scene-preview-badge"
					>
						<IconAlertTriangle />
						{errors.length > 0
							? t('dialogs.passageEdit.scenePreview.errorCount', {
									count: errors.length
							  })
							: t('dialogs.passageEdit.scenePreview.warningCount', {
									count: warnings.length
							  })}
					</span>
				)}
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
							disabled={beat >= lastBeat}
							icon={<IconChevronRight />}
							iconOnly
							label={t('dialogs.passageEdit.scenePreview.nextBeat')}
							onClick={goToNextBeat}
						/>
						<IconButton
							icon={playing ? <IconPlayerPause /> : <IconPlayerPlay />}
							iconOnly
							label={t('dialogs.passageEdit.scenePreview.play')}
							onClick={togglePlaying}
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
						editable={!!editor}
						entities={selectedEntities}
						onDelete={remove}
						onFlip={flip}
						onFrame={setFrame}
						onLayer={setLayer}
					/>
					<StageEditorOverlay
						editable={!!editor}
						onCameraPatch={setCamera}
						onCancel={handleCancel}
						onCommit={handleCommit}
						onDropAsset={handleDropAsset}
						onPatch={setPatch}
						onSelect={select}
						onToggleFullScreen={() => setFullScreen(f => !f)}
						renderer={renderer}
						seal={seal}
						selection={selection}
						stage={stage}
					>
						<SceneStage
							animate={playing}
							assets={assets}
							// State N is produced by beat N-1; S0 has no beat.
							beat={beat > 0 ? parse.result?.scene.beats[beat - 1] : undefined}
							onRenderer={handleRenderer}
							stage={stage}
						/>
					</StageEditorOverlay>
					{parse.errors.length > 0 && (
						<ul className="scene-preview-errors" data-testid="scene-preview-errors">
							{parse.errors.map((error, index) => (
								<li
									className={error.severity}
									key={`${error.code}-${index}`}
									onClick={() => onGoToLine?.(error.line)}
								>
									<span className="line">{error.line}</span>
									<span className="message">{error.message}</span>
									{error.hint && <span className="hint">{error.hint}</span>}
								</li>
							))}
						</ul>
					)}
				</>
			)}
		</div>
	);

	// The passage dialog stack is a transformed ancestor, which would make
	// `position: fixed` resolve against IT rather than the viewport. Portal to the body
	// so full screen is actually full screen.
	return fullScreen ? createPortal(body, document.body) : body;
};
