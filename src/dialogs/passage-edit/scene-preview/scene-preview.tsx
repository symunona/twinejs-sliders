import {
	IconAlertTriangle,
	IconBox,
	IconCamera,
	IconCameraOff,
	IconChevronLeft,
	IconChevronRight,
	IconGridDots,
	IconLink,
	IconLock,
	IconLockOpen,
	IconMessage2,
	IconMusic,
	IconPlayerPause,
	IconPlayerPlay,
	IconPlayerStop,
	IconPlus,
	IconSettings,
	IconStack2,
	IconTimeline,
	IconUser,
	IconVolume,
	IconVolumeOff,
	IconWalk,
	IconZoomIn,
	IconZoomOut
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import {MenuButton} from '../../../components/control/menu-button';
import {useCommand} from '../../../hotkeys';
import {extractSceneBlock, IndexedPassage} from '@sliders/scene-index';
import {
	AssetResolver,
	Beat,
	BubbleStyle,
	Camera,
	Character,
	EntityId,
	matchPassageName,
	Vec2
} from '@sliders/scene-types';
import {mergeBubbleStyle} from '@sliders/render-dom';
import {
	beatStyleForDefaults,
	storyBubbleDefaults,
	withBeatStyleDefaults,
	writeStoryBubbleVars
} from '../../../util/story-bubble';
import {updatePassage} from '../../../store/stories';
import {useUndoableStoriesContext} from '../../../store/undoable-stories';
import {storyColors} from '../../../util/story-colors';
import type {DomRenderer} from '@sliders/render-dom';
import type {BubbleGeometry} from '@sliders/scene-edit';
import {isAudioFile} from '@sliders/asset-store';
import type {AssetDragPayload} from './asset-drag';
import {beatHoldMs, sceneHoldMs} from './beat-hold';
import {BeatPanel} from './beat-panel';
import {applySceneFix} from '../scene-errors/apply-scene-fix';
import {SceneErrorBadge, SceneErrorPanel} from './scene-error-badge';
import {effectiveLocks, lockReason} from './scene-lock';
import {useStageViewZoom} from './use-stage-view-zoom';
import {BeatTimeline} from './beat-timeline';
import {BubbleEditor} from './bubble-editor';
import {SceneDropMenu, type DropChoice} from './drop-menu';
import {
	assetDropWrites,
	deleteWrites,
	flipWrites,
	lockWrites,
	musicDropWrites,
	unstretchWrites,
	poseWrite,
	zWrites
} from './scene-gestures';
import {
	refreshAssetLibrary,
	useAssetStore,
	useLibraryVersion
} from '../../sliders-assets/asset-store-context';
import {
	characterFromFile,
	posesFromFiles
} from '../../sliders-assets/character-poses';
import {requestAssetFocus} from '../../sliders-assets/focus-request';
import {SlidersAssetsDialog} from '../../sliders-assets/sliders-assets';
import {AssetEditorDialog} from '../../asset-editor';
import {useDialogsContext} from '../../context';
import {useStoryLaunch} from '../../../store/use-story-launch';
import {zResetBlocks} from './layer-order';
import {LayersPanel} from './layers-panel';
import {SceneLinksPanel} from './scene-links-panel';
import {
	SceneSettingsTab,
	sceneBubbleWrite,
	sceneGlobalKeyWrite
} from './scene-settings-panel';
import {
	SceneSidebar,
	SceneSidebarTab,
	SceneSidebarTabId,
	useSceneSidebar
} from './scene-sidebar';
import {SceneStage} from './scene-stage';
import {StageEditorOverlay} from './stage-editor-overlay';
import type {TracePreview} from './stage-trace-layer';
import {StageSelectionControls} from './stage-selection-controls';
import {roundCoord} from './stage-geometry';
import {parseLinks} from '../../../util/parse-links';
import {parentOffsets, resolveStage} from '@sliders/scene-core';
import type {SceneParse} from './use-scene-parse';
import {useActiveBeatMark} from './use-active-beat-mark';
import type {SceneDoc} from '../../../store/passage-docs';
import {useRequestedBeat} from './preview-beat-request';
import {useArrivalBeat} from './use-arrival-beat';
import {useStageSelection} from './use-stage-selection';
import {
	applyCameraPatch,
	applyStagePatch,
	buildWriteEdits,
	cameraAgrees,
	insertedBeatCount,
	isOwnOrigin,
	planEntityWrite,
	previewEdits,
	settlePatch,
	useScenePatch,
	writeSceneEdits,
	DRAG_ORIGIN,
	DROP_ORIGIN,
	EDIT_ORIGIN,
	TYPE_ORIGIN,
	NUDGE_ORIGIN,
	PATCH_TIMEOUT_MS,
	Z_ORIGIN,
	type EntityKeyWrite,
	type SceneWrite
} from './use-scene-writer';
import {useWalkHere, WalkHereInfo, WalkHereRequest} from './use-walk-here';
import {previewSounds, useSoundPreview} from './sound-preview';
import {gradeTarget} from './grade-write';
import {MatchBgButton} from './match-bg-button';
import {applyGradeDraft, useGradeEdit} from './use-grade-edit';
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
	 * The passage's Doc, from the registry. Every visual edit is a text edit through this
	 * document and never around it, so it shares one undo history with the `</>` view
	 * (spec 07). Headless: no editor needs to be open. Absent means a picture.
	 */
	doc?: SceneDoc;
	/** The `</>` view on `doc`, when open. Only the text's double click needs it. */
	view?: CodeMirror.Editor;
	/**
	 * Somebody else holds this passage (spec 11 soft lock): look, write nothing. Separate
	 * from the stage lock, which is the author's own choice.
	 */
	readOnly?: boolean;
	/**
	 * Ctrl/cmd-click on a `[[link]]` inside a bubble, with the passage the link points at.
	 * Absent means the preview shows links but cannot open them.
	 */
	onOpenPassage?: (name: string) => void;
	/**
	 * Which passage the scene on screen came from. Only identity matters: it is how the
	 * preview tells "the author moved to another passage" from "the author is typing",
	 * and the first tells the scrubber to go back to the scene's opening beat.
	 */
	passageId?: string;
	/**
	 * The story the scene belongs to. Only "test from this beat" needs it — launching the
	 * player is a story-level act, and the preview otherwise knows nothing above the
	 * passage.
	 */
	storyId: string;
	/**
	 * Walk-here (point-and-click/walk-area.md): a click on the stage walks a cast member
	 * over the current backdrop's walk area. Preview only, never a text edit. Owned by the
	 * dialog, which also owns the walker picker.
	 */
	walkHere?: WalkHereRequest;
	/** What walk-here found on the beat on screen: who can walk, and why a click will not. */
	onWalkInfo?: (info: WalkHereInfo) => void;
	/**
	 * The dialog's walk-here controls, drawn in the sidebar's walk tab above the preview's
	 * own "edit walk area" link.
	 */
	walkControls?: React.ReactNode;
	/**
	 * The dialog header's mute ("preview sounds"). Silences the stage and the Sounds tab's
	 * Preview alike, without stopping either. Owned by the dialog, which draws the speaker.
	 */
	muted?: boolean;
	/** Preview pressed while muted: a play is a request to hear, so it unmutes. */
	onMutedChange?: (muted: boolean) => void;
	/** Whether something here plays, or would but for the mute: the header shows its speaker. */
	onAudible?: (audible: boolean) => void;
	/**
	 * An error row in the stage's error sidebar was clicked: show that line of the passage
	 * text. Absent means the rows go nowhere.
	 */
	onGoToLine?: (line: number) => void;
	/**
	 * An error names a passage the story does not have, and the author asked for it.
	 * Offered only while the stage is writable.
	 */
	onCreatePassage?: (name: string) => void;
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
 * The camera tool: while it is on, empty ground pans the shot and ctrl+wheel zooms it.
 *
 * OFF by default, which is the opposite of how this started life (a background LOCK the
 * author had to remember to switch on). Panning is a mode, not the resting state: a pan
 * begun by grabbing empty ground while staging a cast is easy to do by accident, it
 * rewrites `camera:`, and `camera:` is not somewhere an author looks afterwards. Framing a
 * shot is a deliberate job, so it gets a deliberate tool.
 *
 * Survives the session the same way the other toggles do, and for the same reason.
 */
const CAMERA_KEY = 'sliders.preview.camera';

/**
 * The grid survives the dialog too, for the same reason the lock does: an author who turned
 * it on is staging, and staging outlasts one passage.
 */
const GRID_KEY = 'sliders.preview.grid';

/**
 * Whether the preview may be heard. OFF unless the author turned it on, and remembered
 * across dialogs like the grid and the lock.
 *
 * Silent by default because the editor is not a player: a passage opened to fix a typo
 * would otherwise start a music bed, and somebody working with headphones on next to other
 * people would learn to mute the whole browser tab — at which point every sound this
 * feature exists for is inaudible too.
 */
const SOUND_KEY = 'sliders.preview.sound';

/**
 * How solid the pose menu's hover preview is drawn.
 *
 * Near enough to opaque to judge the pose by — that is the only reason the preview exists —
 * and far enough off it that the sprite is visibly answering a question rather than showing
 * a change that has been made. Nothing else on the stage is drawn at a fraction, so one
 * step is enough of a signal; a heavier fade would make a dark pose hard to read against
 * the background it is being judged against.
 */
const POSE_PREVIEW_OPACITY = 0.9;

/**
 * The entity the trace panel's hover preview is drawn as.
 *
 * A SECOND sprite, not the real one moved: the ghost box says where the entity used to
 * stand and the whole point of filling it in is comparing that against where it stands now,
 * so the sprite on stage has to stay put. Moving the real one would also corrupt the ruler —
 * every ghost rect is derived from the rect the renderer reports for NOW (see
 * `stage-history.ts`), so the boxes would chase the preview that is describing them.
 *
 * Invisible to the overlay, which is handed the real stage: nothing hit tests it, nothing
 * selects it, and no write can ever address it.
 */
const TRACE_PREVIEW_ID = '__sliders-trace-preview';

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
	/** The cast as it was when the drop happened, for the "poses of…" branch. */
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
	doc,
	onOpenPassage,
	parse,
	passageId,
	passages,
	readOnly,
	storyId,
	stylesheet,
	text,
	view,
	walkHere: walkHereRequest,
	onWalkInfo,
	walkControls,
	muted = false,
	onMutedChange,
	onAudible,
	onCreatePassage,
	onGoToLine
}) => {
	const {t} = useTranslation();
	const store = useAssetStore();
	// An asset edited in the asset dialog keeps its id, so nothing about the scene TEXT
	// changes when its pixels do and no parse reaches the stage. This is the only signal
	// that the art moved; the stage re-resolves on it.
	const libraryVersion = useLibraryVersion();
	const {dispatch} = useDialogsContext();
	const {testStory} = useStoryLaunch();
	// The author's own preference. What actually gates the gestures is `locked`/`cameraLocked`
	// below, which is this with the scene's own `locked:` laid over it.
	const [storedLocked, setLocked] = React.useState(
		() => window.localStorage.getItem(LOCKED_KEY) === 'true'
	);
	// The tool, not the lock: on means the camera may be moved. Default off.
	const [cameraTool, setCameraTool] = React.useState(
		() => window.localStorage.getItem(CAMERA_KEY) === 'true'
	);
	const [grid, setGrid] = React.useState(
		() => window.localStorage.getItem(GRID_KEY) === 'true'
	);
	const [sound, setSound] = React.useState(
		() => window.localStorage.getItem(SOUND_KEY) === 'true'
	);
	/**
	 * What is locked right now: the scene's word over the author's preference.
	 *
	 * One way only -- a scene pins things and never releases them -- so the toggles below
	 * still mean what they said, they just cannot un-pin what the file pinned. See
	 * `scene-lock.ts` for the precedence.
	 */
	const {cameraLocked, locked} = effectiveLocks(parse.result?.scene, {
		cameraLocked: !cameraTool,
		locked: storedLocked
	});
	/** Set when the SCENE is what locked it, so the toggle would be a dead button. */
	const stageLockedByScene = lockReason(parse.result?.scene, 'entities');
	const cameraLockedByScene = lockReason(parse.result?.scene, 'bg');
	const [timelineLabels, setTimelineLabels] = React.useState(
		() => window.localStorage.getItem(TIMELINE_LABELS_KEY) !== 'false'
	);
	/**
	 * The sidebar: which tab, and whether open. Both remembered. A press on the bubble
	 * opens the beat tab, the error badge the problems tab, a selection the selection tab.
	 */
	const sidebar = useSceneSidebar();
	const {setActive: setSidebarTab, setOpen: setSidebarOpen} = sidebar;
	const openTab = React.useCallback(
		(id: SceneSidebarTabId) => {
			setSidebarTab(id);
			setSidebarOpen(true);
		},
		[setSidebarOpen, setSidebarTab]
	);
	const tabShown = (id: SceneSidebarTabId) =>
		sidebar.open && sidebar.active === id;
	const toggleTab = (id: SceneSidebarTabId) =>
		tabShown(id) ? setSidebarOpen(false) : openTab(id);
	const toggleLayers = () => toggleTab('layers');
	/** Bumped by a double click on the bubble: focus the panel's text box. */
	const [beatTextFocus, setBeatTextFocus] = React.useState(0);
	const {dispatch: storiesDispatch, stories} = useUndoableStoriesContext();
	/**
	 * Entities the author hid from the editor stage with the layers panel's eye.
	 *
	 * Session state and nothing more: not a pref, not a patch, never a write. It is the
	 * author looking past a sprite, which the scene has no opinion on. Dropped with the
	 * passage, because ids are per scene and a `mira` hidden in one passage is not a promise
	 * about the next one's.
	 */
	const [hidden, setHidden] = React.useState<ReadonlySet<EntityId>>(
		() => new Set()
	);
	const [beat, setBeat] = React.useState(0);
	const [dropRequest, setDropRequest] = React.useState<DropRequest>();
	const [playing, setPlaying] = React.useState(false);
	const [renderer, setRenderer] = React.useState<DomRenderer>();
	const root = React.useRef<HTMLDivElement>(null);
	const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null);
	const viewZoom = useStageViewZoom(viewport);
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
	 * The scene's own pace, for every beat that did not time itself, as a LENGTH: `0` reads
	 * as the standard beat. A primitive, so it is safe in an effect's dependency list where
	 * `parse.result` is a fresh object per parse.
	 */
	const holdMs = sceneHoldMs(parse.result?.scene);
	const parsedStage = parse.states[Math.min(beat, lastBeat)];
	/**
	 * The stage in AUTHORED space: `at` is the number in the YAML, `of` intact. The drag
	 * patch paints onto this one, because a gesture writes the author's coordinate.
	 */
	/**
	 * The Grade popover. Declared this early because its draft paints onto `localStage`,
	 * like the drag patch; `commit` is reached through a ref because it is built further
	 * down and depends on everything above.
	 */
	const gradeCommitRef = React.useRef<(writes: SceneWrite[], origin: string) => void>(
		() => undefined
	);
	const gradeEdit = useGradeEdit({
		beat,
		commit: React.useCallback(
			(writes: SceneWrite[], origin: string) =>
				gradeCommitRef.current(writes, origin),
			[]
		),
		parsedStage,
		scene: parse.result?.scene,
		states: parse.states
	});
	const localStage = React.useMemo(
		() =>
			applyGradeDraft(
				applyCameraPatch(applyStagePatch(parsedStage, patch), cameraPatch),
				gradeEdit.draft
			),
		[cameraPatch, gradeEdit.draft, parsedStage, patch]
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
	// A stable empty array when there is no scene, so the strip and the props row are not
	// handed a fresh `[]` on every render.
	const beats = parse.result?.scene.beats ?? EMPTY_BEATS;
	// State N is produced by beat N-1; S0 has no beat.
	const shownBeat = beat > 0 ? beats[beat - 1] : undefined;
	/** Set by "add beat": focus the beat panel's text once the new beat is on screen. */
	const focusAddedBeat = React.useRef(false);

	React.useEffect(() => {
		if (focusAddedBeat.current && shownBeat) {
			focusAddedBeat.current = false;
			setBeatTextFocus(value => value + 1);
		}
	}, [shownBeat]);
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
	/**
	 * A double click on an entity's line asked to see it: the overlay brings it into view
	 * and flashes it. A counter rather than the id alone, so asking twice for the same
	 * entity still answers twice.
	 */
	const [focusRequest, setFocusRequest] = React.useState<{
		id: EntityId;
		seq: number;
	}>();
	const {clear, select, selection} = useStageSelection({
		beatSpans: parse.result?.beatSpans,
		block,
		editor: doc,
		enabled: true,
		kindOf,
		onCaretBeat: goToBeat,
		onFocusEntity: id =>
			setFocusRequest(current => ({id, seq: (current?.seq ?? 0) + 1})),
		scene: parse.result?.scene,
		stageIds,
		view
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
		if (!doc) {
			return;
		}

		const handler = (_doc: CodeMirror.Doc, change: CodeMirror.EditorChange) => {
			if (!isOwnOrigin(change.origin)) {
				setSeal(value => value + 1);
			}
		};

		doc.on('change', handler);

		return () => doc.off('change', handler);
	}, [doc]);

	const commit = React.useCallback(
		(writes: SceneWrite[], origin: string) => {
			// Offsets from the Doc as it is NOW, not as of the last render: a headless Doc
			// reports its change a tick late, and two writes in that tick would otherwise
			// splice the second into text that is already gone.
			const live = doc ? extractSceneBlock(doc.getValue()) : block;
			const context = live && {
				beat,
				blockOffset: live.offset,
				blockText: live.text,
				scene: parse.result?.scene
			};
			// Asked BEFORE the write, because afterwards the plan is a plan about text that
			// no longer exists.
			const grew = context ? insertedBeatCount(context, writes) : 0;

			if (
				!context ||
				readOnly ||
				!writeSceneEdits(doc, context, writes, origin)
			) {
				// Nowhere to write, or the write changed nothing: the optimistic patch has
				// no text coming to replace it and must not stay on screen.
				clearPatch();
				setCamera(undefined);

				return;
			}

			// The gesture wrote beats that did not exist a moment ago, and the moment the
			// author is looking at is now the last of them — staying put would show the
			// stage BEFORE the move they just made.
			if (grew > 0) {
				setBeat(current => current + grew);
			}

			holdPatch();
			holdCamera();
		},
		[
			beat,
			block,
			clearPatch,
			doc,
			holdCamera,
			holdPatch,
			parse.result,
			readOnly,
			setCamera
		]
	);

	gradeCommitRef.current = commit;

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
				return;
			}

			// Step 0: the same rows edit the scene's globals.
			const write = sceneGlobalKeyWrite(key, value);

			if (write) {
				commit([write], EDIT_ORIGIN);
			}
		},
		[beat, commit]
	);
	const sceneBubble = parse.result?.scene.bubble;
	const handleBeatBubble = React.useCallback(
		(key: keyof BubbleStyle, value: unknown) => {
			if (beat > 0) {
				commit([{beat: beat - 1, bubble: {[key]: value}}], EDIT_ORIGIN);
				return;
			}

			commit([sceneBubbleWrite(sceneBubble, key, value)], EDIT_ORIGIN);
		},
		[beat, commit, sceneBubble]
	);

	/** The beat panel's text box. Live writes while typing merge into one undo step. */
	const handleBeatText = React.useCallback(
		(text: string, live?: boolean) => {
			if (beat > 0) {
				commit(
					[{beat: beat - 1, beatText: text}],
					live ? TYPE_ORIGIN : EDIT_ORIGIN
				);
			}
		},
		[beat, commit]
	);
	const handleSelectBeat = React.useCallback(() => {
		clear();
		openTab('beat');
	}, [clear, openTab]);
	const handleEditBeatText = React.useCallback(() => {
		openTab('beat');
		setBeatTextFocus(value => value + 1);
	}, [openTab]);

	/**
	 * "Add beat": an empty line for `who` right after the beat on screen, then the beat
	 * tab with its text box focused. The focus waits for the parse that brings the new
	 * beat, or it would land on the old one's words.
	 */
	const handleAddBeat = React.useCallback(
		(who: string) => {
			focusAddedBeat.current = true;
			commit([{insertBeat: beat, who}], EDIT_ORIGIN);
			openTab('beat');
		},
		[beat, commit, openTab]
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
	const dropCommitRef = React.useRef(commit);

	textRef.current = text;
	dropAssetRef.current = handleDropAsset;
	dropCommitRef.current = commit;

	/**
	 * Sound files dropped on the stage: uploaded, and the LAST one becomes the scene's
	 * `music:` (replacing whatever was there, adding the key when absent).
	 *
	 * No menu. A picture can be a backdrop, a prop, a character or a pose, so the author is
	 * asked; a sound has exactly one place on a stage, and asking would be a menu of one.
	 * The menu's `bg` branch used to catch audio — `putAsset` stored it as a sound, from the
	 * bytes, and then `bg:` was written pointing at it: a backdrop with nothing to draw.
	 *
	 * Every file is uploaded, the way a multi-file `bg` drop uploads them all: they were
	 * dropped, they belong in the library. One write, one undo step, `DROP_ORIGIN` like
	 * every other drop.
	 */
	const dropSounds = React.useCallback(
		async (files: File[]) => {
			try {
				const uploaded = await Promise.all(
					files.map(file => store.putAsset(file, {kind: 'sound'}))
				);
				const last = uploaded[uploaded.length - 1];

				if (last) {
					dropCommitRef.current(musicDropWrites(last.meta.name), DROP_ORIGIN);
				}
			} catch (error) {
				console.error('Could not add a dropped sound to the library', error);
			}

			assets.invalidate?.();
			refreshAssetLibrary();
		},
		[assets, store]
	);

	/**
	 * Image and sound files dragged onto the stage from outside the app.
	 *
	 * Sounds are told apart by their BYTES (`isAudioFile`, the upload pipeline's own rule)
	 * and go straight to `dropSounds`. A picture says nothing about its role, so the rest
	 * only open the menu (`drop-menu.tsx`); `runDropChoice` below does the work once the
	 * author has said what the image is. The cast is read here rather than subscribed to,
	 * because the "poses of…" branch is the only thing that needs it and a preview that is
	 * always mounted should not hold the whole library open to answer a question nobody
	 * asked.
	 */
	const handleDropFiles = React.useCallback(
		async (dropped: File[], at: Vec2, point: Vec2) => {
			const audio = await Promise.all(dropped.map(file => isAudioFile(file)));
			const sounds = dropped.filter((_, index) => audio[index]);
			const files = dropped.filter((_, index) => !audio[index]);

			if (sounds.length > 0) {
				// Not awaited: the menu for the pictures in the same drop should not wait on
				// an upload. Both write through refs, so neither clobbers the other's text.
				void dropSounds(sounds);
			}

			if (files.length === 0) {
				return;
			}

			let characters: Character[] = [];

			try {
				characters = await store.listCharacters();
			} catch (error) {
				console.error('Could not read the cast for the drop menu', error);
			}

			setDropRequest({at, characters, files, point});
		},
		[dropSounds, store]
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
				if (choice.kind === 'pose') {
					// Poses are not stage entries: the character they belong to may not even
					// be in this scene, and a pose is chosen with `pose:` on an entity that
					// already exists. Nothing is written to the text.
					const poses = await posesFromFiles(store, choice.character, files);

					await store.putCharacter({...choice.character, poses});
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

				// Locked holds against the keyboard too, not just the pointer.
				if (!entity || entity.locked) {
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

	const resetStretch = React.useCallback(
		() => commit(unstretchWrites(stage, selection), EDIT_ORIGIN),
		[commit, selection, stage]
	);

	const toggleEntityLock = React.useCallback(
		() => commit(lockWrites(stage, selection), EDIT_ORIGIN),
		[commit, selection, stage]
	);

	const stepZ = React.useCallback(
		(delta: number) => commit(zWrites(stage, selection, delta), Z_ORIGIN),
		[commit, selection, stage]
	);

	const setPose = React.useCallback(
		(pose: string | undefined) => {
			const write = poseWrite(stage.entities?.[selection[0]], pose);

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
	 * The look every line in this scene starts from: the story's `sliders.bubble.*`
	 * variables with the scene's own `bubble:` over them.
	 *
	 * The story half is scanned out of the passages, which is the only way the editor can
	 * read a Chapbook variable — there is no running state machine here. `passages` is
	 * absent in a bare preview, and then a scene gets its own `bubble:` and nothing wider,
	 * which is the same answer as a story that declared none.
	 */
	const storyBubble = React.useMemo(
		() => (passages ? storyBubbleDefaults(passages) : undefined),
		[passages]
	);
	const bubbleDefaults = React.useMemo(
		() => mergeBubbleStyle(storyBubble, parse.result?.scene.bubble),
		[parse.result, storyBubble]
	);

	/**
	 * The colours the story already uses, for the beat row's colour wells. Stylesheet
	 * included: a palette written once as CSS is the likeliest one to reuse.
	 */
	const swatches = React.useMemo(
		() => (passages ? storyColors({passages, stylesheet}) : undefined),
		[passages, stylesheet]
	);

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
		// then the name is taken on trust. `matchPassageName`, not an exact compare: a way
		// out the reader can take must show as a way out here (`onOpenPassage` resolves the
		// same rule, so the name stays as the author wrote it).
		const existing = passages?.map(passage => passage.name);

		return existing
			? [...names].filter(
					name => matchPassageName(existing, name) !== undefined
			  )
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
	 * The selection tab follows the selection: selecting shows it, deselecting goes back to
	 * whichever tab the author was on. Never opens a collapsed sidebar -- collapsing it was
	 * the author asking for the stage.
	 */
	const hasSelection = selection.length > 0;
	const sidebarActiveRef = React.useRef(sidebar.active);
	const tabBeforeSelection = React.useRef<SceneSidebarTabId>('scene');

	sidebarActiveRef.current = sidebar.active;

	React.useEffect(() => {
		const active = sidebarActiveRef.current;

		if (hasSelection) {
			if (active !== 'selection') {
				tabBeforeSelection.current = active;
				setSidebarTab('selection');
			}
		} else if (active === 'selection') {
			setSidebarTab(tabBeforeSelection.current);
		}
	}, [hasSelection, setSidebarTab]);

	/**
	 * The pose the pose menu is hovering: drawn, never written. `null` is not hovering,
	 * `''` is the Automatic row — the fallback the renderer picks when no pose is named.
	 *
	 * A preview is not an optimistic patch and deliberately does not go through
	 * `StagePatch`: that map is the value a gesture is PRODUCING, it settles against the
	 * next parse and it times out, and a hover produces nothing. This one is thrown away
	 * whole the moment the pointer leaves.
	 */
	const [posePreview, setPosePreview] = React.useState<string | null>(null);
	// Only ever the single selection the pose menu itself needs. Kept apart from the menu
	// so the preview cannot outlive the entity: selecting something else clears it below.
	const previewId = selection.length === 1 ? selection[0] : undefined;

	React.useEffect(() => setPosePreview(null), [previewId]);

	/**
	 * The past position the trace panel is hovering: drawn as a second sprite, never
	 * written. `null` is not hovering.
	 *
	 * Same bargain as `posePreview` — a hover produces nothing, so it is not a
	 * `StagePatch` — except that this one ADDS art instead of changing it, because the
	 * question it answers ("would it look right back there?") is about two positions at
	 * once.
	 */
	const [tracePreview, setTracePreview] = React.useState<TracePreview | null>(
		null
	);

	React.useEffect(() => setTracePreview(null), [selection]);

	/**
	 * What the renderer draws: the stage, plus the hovered pose at 90%.
	 *
	 * The overlay keeps the REAL stage — boxes, handles and every write are about what the
	 * scene says, not about what the pointer is passing over. Fading is the whole of what
	 * makes this readable as a question rather than as a change that already happened; the
	 * entity's own `opacity` is multiplied rather than replaced, so previewing a sprite the
	 * scene has already faded does not brighten it.
	 */
	const drawnStage = React.useMemo(() => {
		const entity = previewId ? stage.entities?.[previewId] : undefined;
		const traced = tracePreview
			? stage.entities?.[tracePreview.id]
			: undefined;

		if (
			!(posePreview !== null && previewId && entity) &&
			!traced &&
			hidden.size === 0
		) {
			return stage;
		}

		const entities = {...stage.entities};

		// Hidden is drawn at opacity 0 rather than dropped: the sprite keeps its box, so its
		// `of:` children, its selection outline and the renderer's own enter/exit bookkeeping
		// all carry on as if nothing happened — and showing it again is a style change, not a
		// sprite being created. The overlay is told separately so a press goes through it.
		for (const id of hidden) {
			const shown = entities[id];

			// Steps too: the renderer lets a step's own `opacity:` win over the entity's while
			// it plays, so a hidden sprite with a fading cycle would blink back in.
			if (shown) {
				entities[id] = {
					...shown,
					opacity: 0,
					steps: shown.steps?.map(step => ({...step, opacity: 0}))
				};
			}
		}

		// Both previews below start from `entities`, not `stage`, so they are copies of what is
		// drawn — a hidden sprite stays hidden while its pose menu is hovered or it is traced.
		const previewed = previewId ? entities[previewId] : undefined;
		const drawnTrace = tracePreview ? entities[tracePreview.id] : undefined;

		if (posePreview !== null && previewId && previewed) {
			// One pose, as the menu will write it: a scene step list would otherwise keep
			// drawing over the pose being asked about.
			entities[previewId] = {
				...previewed,
				pose: posePreview || undefined,
				steps: undefined,
				opacity: previewed.opacity * POSE_PREVIEW_OPACITY
			};
		}

		// Appended last so it wins a z tie against the sprite it is a copy of: the two
		// overlap whenever the move was a small one, and the preview is the thing being
		// asked about.
		if (tracePreview && drawnTrace) {
			entities[TRACE_PREVIEW_ID] = {
				...drawnTrace,
				at: tracePreview.at,
				id: TRACE_PREVIEW_ID,
				opacity: drawnTrace.opacity * POSE_PREVIEW_OPACITY,
				scale: tracePreview.scale
			};
		}

		return {...stage, entities};
	}, [posePreview, previewId, hidden, stage, tracePreview]);

	/**
	 * Walk-here, laid over what is drawn and nothing else: the overlay, the selection and
	 * every write keep reading `stage`, so a walk the author is only looking at can never
	 * reach the YAML.
	 */
	const walkHere = useWalkHere({
		assets,
		libraryVersion,
		renderer,
		request: walkHereRequest,
		stage
	});
	const {decorate: decorateWalk, info: walkInfo} = walkHere;
	const shownStage = React.useMemo(
		() => decorateWalk(drawnStage),
		[decorateWalk, drawnStage]
	);
	/**
	 * The Sounds tab's audition: what is heard at the scrubber, from the top. Step 0 = the
	 * scene's music, a beat = the music in effect there plus its `sfx:`.
	 */
	const soundPreview = useSoundPreview(assets, muted);
	const heardHere = previewSounds(shownStage.music, shownBeat?.sfx);
	const toggleSoundPreview = () => {
		if (soundPreview.playing) {
			soundPreview.stop();
			return;
		}

		if (muted) {
			onMutedChange?.(false);
		}

		soundPreview.play(heardHere);
	};
	// Stopped by a scrub: what it was playing is no longer what is heard here.
	const stopSoundPreview = soundPreview.stop;

	React.useEffect(() => stopSoundPreview(), [beat, stopSoundPreview]);

	/** Anything to hear in this scene, anywhere — stable while scrubbing. */
	const sceneHasSound =
		!!parse.result?.scene.music ||
		beats.some(one => !!one.sfx || !!one.music) ||
		Object.keys(shownStage.music ?? {}).length > 0;
	const audible = soundPreview.playing || (sound && sceneHasSound);

	React.useEffect(() => {
		onAudible?.(audible);
	}, [audible, onAudible]);
	React.useEffect(() => () => onAudible?.(false), [onAudible]);

	const lastWalkInfo = React.useRef<string>();

	// Told only when it changed: the info is a fresh object every render, and a parent that
	// sets state from it would otherwise re-render this forever.
	React.useEffect(() => {
		const next = JSON.stringify(walkInfo);

		if (next !== lastWalkInfo.current) {
			lastWalkInfo.current = next;
			onWalkInfo?.(walkInfo);
		}
	});

	/**
	 * Everything that would change the text is off while the lock is on.
	 *
	 * One flag, checked in one place: the overlay already treats "not editable" as "select
	 * and look, write nothing" for the case where there is no CodeMirror at all, so the lock
	 * reuses that path rather than inventing a second one the gestures would have to learn.
	 */
	const editable = !!doc && !locked && !readOnly;

	/**
	 * What a gesture on the selection will do to the file, when that is not simply "edit the
	 * line you are looking at".
	 *
	 * Computed up front rather than discovered at commit: a move that quietly grows the
	 * `beats:` list is a structural edit, and an author is owed the warning BEFORE they
	 * reach for the sprite rather than a surprise line afterwards.
	 */
	const beatNote = React.useMemo(() => {
		if (!editable || selection.length === 0) {
			return undefined;
		}

		const scene = parse.result?.scene;

		for (const id of selection) {
			const {insertBeat} = planEntityWrite(scene, beat, kindOf(id), id);

			if (insertBeat) {
				return insertBeat.owner
					? t('dialogs.passageEdit.scenePreview.beatBelongsTo', {
							beat: insertBeat.after + 1,
							name: insertBeat.owner
					  })
					: t('dialogs.passageEdit.scenePreview.beatStagesNothing', {
							beat: insertBeat.after + 1
					  });
			}
		}

		return undefined;
	}, [beat, editable, kindOf, parse.result, selection, t]);

	/** Where a grade from the popover lands, in words. Single selection only. */
	const gradeNote = React.useMemo(() => {
		const entity =
			selection.length === 1 ? stage.entities?.[selection[0]] : undefined;

		if (!entity) {
			return undefined;
		}

		switch (gradeTarget(parse.result?.scene, beat, entity)) {
			case 'beat':
				return t('dialogs.passageEdit.scenePreview.grade.targetBeat', {beat});
			case 'newBeat':
				return t('dialogs.passageEdit.scenePreview.grade.targetNewBeat', {beat});
			default:
				return t('dialogs.passageEdit.scenePreview.grade.targetEntry');
		}
	}, [beat, parse.result, selection, stage, t]);

	// The beat on screen, lit up in the text the author is typing in.
	useActiveBeatMark(
		doc,
		beat > 0 ? parse.result?.beatSpans?.[beat - 1] : undefined,
		block?.lineOffset ?? 0
	);
	/** The beat a bubble gesture writes to: the scrubber position, less the S0 stage. */
	const bubbleBeat =
		editable &&
		(shownBeat?.kind === 'say' || shownBeat?.kind === 'box')
			? beat - 1
			: undefined;

	function toggleGrid() {
		setGrid(value => {
			window.localStorage.setItem(GRID_KEY, String(!value));

			return !value;
		});
	}

	function toggleSound() {
		setSound(value => {
			window.localStorage.setItem(SOUND_KEY, String(!value));

			return !value;
		});
	}

	function toggleTimelineLabels() {
		setTimelineLabels(value => {
			window.localStorage.setItem(TIMELINE_LABELS_KEY, String(!value));

			return !value;
		});
	}

	const toggleHidden = React.useCallback((id: EntityId) => {
		setHidden(current => {
			const next = new Set(current);

			if (!next.delete(id)) {
				next.add(id);
			}

			return next;
		});
	}, []);

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

		dispatch({component: SlidersAssetsDialog, maximized: true, type: 'addDialog'});
		requestAssetFocus(ref);
	}

	/**
	 * The walk tab's link: open the backdrop on screen in the asset editor, on its walk tool.
	 * Resolved the way the preview draws it -- own collection first, `coll/name` too.
	 */
	function handleEditWalkArea() {
		const bg = stage.bg?.trim();

		if (!bg) {
			return;
		}

		void store.lookup(bg).then(asset => {
			if (asset && !asset.ownerCharacter) {
				dispatch({
					component: AssetEditorDialog,
					// Drawing a walk area needs the room.
					maximized: true,
					props: {assetId: asset.id, tool: 'walk'},
					type: 'addDialog'
				});
			}
		});
	}

	function toggleCameraTool() {
		setCameraTool(value => {
			window.localStorage.setItem(CAMERA_KEY, String(!value));

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

	// Same set back when there is nothing to drop — always so on mount — so arriving costs
	// no render and no `drawnStage` rebuild.
	React.useEffect(
		() => setHidden(current => (current.size === 0 ? current : new Set())),
		[passageId]
	);

	// Arriving at a passage stands on state 0, so a first drag edits the scene's defaults.
	useArrivalBeat(passageId, setBeat);
	// After `useArrivalBeat`, so an explicit request beats the arrival default.
	useRequestedBeat(passageId, parse, setBeat);

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

		// `autoAdvance: 0` asks the READER to click. The editor has no reader to ask, so
		// honouring the wait would be a stage that freezes for no visible reason. It takes
		// the standard beat instead, and the author sees the pacing of everything they DID
		// time.

		const timer = window.setTimeout(
			() => setBeat(b => b + 1),
			beatHoldMs(producedBy, holdMs)
		);

		return () => window.clearTimeout(timer);
	}, [beat, holdMs, lastBeat, parse.result, playing]);

	// Viewer keys, unmodified, in the preview's own scope: they only fire once
	// focus is inside the preview, so left and right still move the cursor
	// while the author is writing the scene above.

	// Beat navigation and nudging share the arrow keys, so exactly one of the two is ever
	// enabled. The dispatcher skips disabled commands before it looks at bindings, which
	// makes this deterministic rather than a race between registration orders — and
	// Escape, by clearing the selection, is how the arrows go back to the scrubber.

	/**
	 * Test the story from the beat on the stage.
	 *
	 * The scrubber counts STATES and the player counts beats that have run, which happen
	 * to be the same number: state N is the stage after N beats. State 0 means "before
	 * anything", i.e. an ordinary play, so nothing is sent for it.
	 *
	 * Registered in the passage editor's scope as well as the preview's, because the
	 * author's hands are usually in the scene text — the same reason Alt+P and Alt+A are
	 * chords. `allowInInput` for the same reason again: the caret is in CodeMirror.
	 */
	const handleTestFromBeat = React.useCallback(() => {
		if (!passageId) {
			return;
		}

		void testStory(storyId, passageId, beat > 0 ? beat : undefined);
	}, [beat, passageId, storyId, testStory]);

	const testCommand = {
		allowInInput: true,
		enabled: !!passageId,
		id: 'scene.test',
		label: t('hotkeys.commands.scene.test'),
		run: handleTestFromBeat
	};

	useCommand({...testCommand, scope: 'scene-preview'});
	useCommand({...testCommand, scope: 'passage-editor'});

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

	// A view toggle, so it survives the lock like the grid does.
	useCommand({
		id: 'scene.layersPanel',
		label: t('hotkeys.commands.scene.layersPanel'),
		run: toggleLayers,
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
		enabled: !!doc && !readOnly,
		id: 'scene.undo',
		label: t('hotkeys.commands.scene.undo'),
		run: () => doc?.undo(),
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: !!doc && !readOnly,
		id: 'scene.redo',
		label: t('hotkeys.commands.scene.redo'),
		run: () => doc?.redo(),
		scope: 'scene-preview'
	});

	// Above the no-scene return: hooks must run on every render, or a passage gaining its
	// [scene] block crashes the dialog (React #310).
	const showLayers = tabShown('layers');
	/**
	 * Which pinned rows' "back to auto" would not unpin from here. Asked of the writer itself
	 * (`buildWriteEdits` on the same context `commit` builds) so the panel can never offer a
	 * button the write then ignores. Only while the panel is up: each pinned row is one
	 * look at the block text.
	 */
	const zResetBlocksShown = React.useMemo(() => {
		if (!showLayers) {
			return undefined;
		}

		const context = block && {
			beat,
			blockOffset: block.offset,
			blockText: block.text,
			scene: parse.result?.scene
		};

		// The parsed stage, not `localStage`: the answer is about the text, and a drag
		// patch moving under the pointer would otherwise re-ask it on every frame.
		return zResetBlocks(
			parsedStage,
			parse.result?.scene,
			beat,
			parse.states[0],
			writes =>
				!!context &&
				previewEdits(context.blockText, buildWriteEdits(context, writes)) !==
					context.blockText
		);
	}, [beat, block, parse.result, parse.states, parsedStage, showLayers]);

	if (!parse.hasScene) {
		return null;
	}


	/**
	 * "Make beat styles default for project": this beat's bubble style, laid over the
	 * story's `sliders.bubble.*` vars in the start passage -- the same lines Story > Defaults
	 * writes. Nothing else is touched: no beat, no scene, no other passage. Absent when the
	 * beat states no style, or the story has no start passage to write into.
	 */
	const story = stories.find(candidate => candidate.id === storyId);
	const startPassage = story?.passages.find(
		passage => passage.id === story.startPassage
	);
	const beatStyle =
		shownBeat?.kind === 'say' || shownBeat?.kind === 'box'
			? shownBeat.style
			: undefined;
	const makeBeatStyleDefault =
		story && startPassage && beatStyleForDefaults(beatStyle)
			? () =>
					storiesDispatch(
						updatePassage(story, startPassage, {
							text: writeStoryBubbleVars(
								startPassage.text,
								withBeatStyleDefaults(
									storyBubbleDefaults(story.passages),
									beatStyle
								)
							)
						}),
						'undoChange.editPassage'
					)
			: undefined;

	/**
	 * The beat line: step, count, step, play, the strip, and the strip's labels toggle at
	 * its far end. One row -- the strip is how the author reads the scene's timing, and the
	 * buttons that move through it belong beside it rather than in a bar of their own.
	 */
	/** Who can say the new beat: the narrator, then who is on stage, characters first. */
	const onStage = Object.values(stage.entities ?? {}).sort((a, b) =>
		a.id.localeCompare(b.id)
	);
	const speakers = (cast: boolean) =>
		onStage
			.filter(entity => (entity.kind === 'cast') === cast)
			.map(entity => ({
				label: entity.id,
				onClick: () => handleAddBeat(entity.id)
			}));
	const characterItems = speakers(true);
	const assetItems = speakers(false);
	const addBeatItems = [
		{
			label: t('dialogs.passageEdit.scenePreview.addBeat.narrator'),
			onClick: () => handleAddBeat('box')
		},
		...(characterItems.length > 0
			? [{separator: true as const}, ...characterItems]
			: []),
		...(assetItems.length > 0 ? [{separator: true as const}, ...assetItems] : [])
	];

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
			<BeatTimeline
				autoAdvanceMs={holdMs}
				beat={beat}
				beats={beats}
				labels={timelineLabels}
				onBeatChange={goToBeat}
			/>
			{/* Pinned right. The strip takes the slack when there is one; with under two
			    beats it renders nothing and this group would slide left onto the play
			    button without the auto margin. */}
			<span className="scene-preview-bar-end">
				{editable && (
					<MenuButton
						icon={<IconPlus />}
						iconOnly
						items={addBeatItems}
						label={t('dialogs.passageEdit.scenePreview.addBeat.button')}
					/>
				)}
				<IconButton
					icon={<IconTimeline />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.timelineLabels')}
					onClick={toggleTimelineLabels}
					selectable
					selected={timelineLabels}
				/>
			</span>
		</div>
	);

	/**
	 * Top right of the stage: how big the stage is drawn here and whether it may be
	 * edited. Neither is anything the scene says.
	 */
	const stageTools = (
		<div className="scene-stage-tools" data-testid="scene-stage-tools">
			{/* How big the stage is drawn here, not what the camera frames: nothing
			    about it is written to the scene. */}
			<span className="scene-preview-zoom">
				<IconButton
					disabled={viewZoom.zoom <= viewZoom.minZoom}
					icon={<IconZoomOut />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.zoomOut')}
					onClick={() => viewZoom.stepZoom(-1)}
					tooltipPosition="bottom"
				/>
				<button
					className="scene-preview-zoom-percent"
					onClick={viewZoom.resetZoom}
					title={t('dialogs.passageEdit.scenePreview.zoomReset')}
					type="button"
				>
					{Math.round(viewZoom.zoom * 100)}%
				</button>
				<IconButton
					disabled={viewZoom.zoom >= viewZoom.maxZoom}
					icon={<IconZoomIn />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.zoomIn')}
					onClick={() => viewZoom.stepZoom(1)}
					tooltipPosition="bottom"
				/>
			</span>
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
				tooltipPosition="bottom"
			/>
		</div>
	);

	// The stage itself--everything below the bar.
	const stageOverlay = (
		<StageEditorOverlay
			cameraLocked={cameraLocked}
			beatNote={beatNote}
			editable={editable}
			focusRequest={focusRequest}
			grid={grid}
			hidden={hidden}
			origStage={origStage}
			prevStage={prevStage}
			onCameraPatch={setCamera}
			onCancel={handleCancel}
			onCommit={handleCommit}
			onDropAsset={handleDropAsset}
			onDropFiles={handleDropFiles}
			// Absent only when a click could not write at all — a locked stage. Parked on
			// somebody else's beat the jump still lands, as a new beat of its own.
			onJumpTo={editable ? jumpTo : undefined}
			onTracePreview={setTracePreview}
			onOpenEntity={handleOpenEntity}
			onPatch={setPatch}
			parentOffsets={offsets}
			onSelect={select}
			overscan={viewZoom.stageScale < 1}
			renderer={renderer}
			seal={seal}
			selection={selection}
			stage={stage}
		>
			<SceneStage
				animate={playing}
				assetRevision={libraryVersion}
				assets={assets}
				beat={drawnBeat}
				bubbleDefaults={bubbleDefaults}
				muted={!sound || muted || soundPreview.playing}
				onLink={handleLink}
				onRenderer={handleRenderer}
				sceneEase={parse.result?.scene.ease}
				stage={shownStage}
				stylesheet={stylesheet}
				viewScale={viewZoom.stageScale}
			/>
			{walkHere.layer}
			{/* Over the stage rather than above it. A row that appeared with the
			    selection would resize the stage under the pointer, and the whole scene
			    would jump on the very click that selected a sprite. */}
			<BubbleEditor
				beat={bubbleBeat}
				editable={editable}
				onCommit={handleBubbleCommit}
				onDraft={setBubbleDraft}
				onEditText={handleEditBeatText}
				onSelectBeat={handleSelectBeat}
				style={shownBeat?.kind === 'say' || shownBeat?.kind === 'box' ? shownBeat.style : undefined}
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
		</StageEditorOverlay>
	);


	// The overlay scrolls inside the viewport when the view is zoomed in. The selection
	// row sits outside that scroll, over the viewport, so it stays where the author can
	// reach it however far the stage has been scrolled.
	const passageNames = (passages ?? []).map(passage => passage.name);
	// What `from:` may name: a passage with a scene, never this one (that is a cycle).
	// By id, from the store: a bare preview has no story and offers no templates.
	const templateNames = (story?.passages ?? [])
		.filter(
			passage => passage.id !== passageId && !!extractSceneBlock(passage.text)
		)
		.map(passage => passage.name)
		.sort((a, b) => a.localeCompare(b));
	const singleSelected =
		selectedEntities.length === 1 ? selectedEntities[0] : undefined;

	/** Settings tab: how this preview behaves for me, then what the scene says. */
	const sceneTab = (
		<div className="scene-sidebar-section">
			<div className="scene-sidebar-row">
				{/* The grid is how the author reads the stage, and nothing has to be
				    selected to want to read it. */}
				<IconButton
					icon={<IconGridDots />}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.grid')}
					onClick={toggleGrid}
					selectable
					selected={grid}
					tooltipPosition="bottom"
				/>
			</div>
			<SceneSettingsTab
				assets={assets}
				editable={editable}
				onWrite={writes => commit(writes, EDIT_ORIGIN)}
				scene={parse.result?.scene}
				templates={templateNames}
			/>
		</div>
	);

	/**
	 * Sounds tab: hear the scrubber's point, then what it says. Scope-aware like the beat
	 * tab — Step 0 edits the scene's `music:`, a beat its own `music:` and `sfx:`.
	 */
	const soundsTab = (
		<div className="scene-sidebar-section">
			<div className="scene-sidebar-row">
				{/* A click is also the user gesture the browser wants before it
				    will play anything, so the button that turns sound on is the
				    same one that unblocks it. */}
				<IconButton
					icon={sound ? <IconVolume /> : <IconVolumeOff />}
					iconOnly
					label={t(
						sound
							? 'dialogs.passageEdit.scenePreview.soundOn'
							: 'dialogs.passageEdit.scenePreview.soundOff'
					)}
					onClick={toggleSound}
					selectable
					selected={sound}
					tooltipPosition="bottom"
				/>
				<IconButton
					disabled={!soundPreview.playing && heardHere.length === 0}
					icon={
						soundPreview.playing ? <IconPlayerStop /> : <IconPlayerPlay />
					}
					label={t(
						soundPreview.playing
							? 'dialogs.passageEdit.scenePreview.sounds.stop'
							: 'dialogs.passageEdit.scenePreview.sounds.preview'
					)}
					onClick={toggleSoundPreview}
					tooltipLabel={t(
						soundPreview.playing
							? 'dialogs.passageEdit.scenePreview.sounds.stop'
							: heardHere.length === 0
							? 'dialogs.passageEdit.scenePreview.sounds.nothing'
							: beat > 0
							? 'dialogs.passageEdit.scenePreview.sounds.previewBeat'
							: 'dialogs.passageEdit.scenePreview.sounds.previewScene'
					)}
					tooltipPosition="bottom"
				/>
			</div>
			<SceneSettingsTab
				assets={assets}
				editable={editable}
				onWrite={writes => commit(writes, EDIT_ORIGIN)}
				onWriteBeat={(key, formatted) =>
					beat > 0 &&
					commit(
						[
							formatted === undefined
								? {beat: beat - 1, beatKey: key, value: null}
								: {beat: beat - 1, beatKey: key, formatted, value: formatted}
						],
						EDIT_ORIGIN
					)
				}
				pane="sounds"
				scene={parse.result?.scene}
				soundBeat={shownBeat}
			/>
		</div>
	);

	/** Camera tab: the tool, where the shot looks, and what moves in it. */
	const cameraTab = (
		<div className="scene-sidebar-section">
			<div className="scene-sidebar-row">
				{/* The background lock's successor: a MODE the author turns on to frame
				    the shot, off the rest of the time. */}
				<IconButton
					disabled={!!cameraLockedByScene}
					icon={cameraLocked ? <IconCameraOff /> : <IconCamera />}
					label={t('dialogs.passageEdit.scenePreview.cameraTool')}
					tooltipLabel={t(
						cameraLockedByScene
							? 'dialogs.passageEdit.scenePreview.lockedByScene'
							: cameraTool
							? 'dialogs.passageEdit.scenePreview.cameraToolOn'
							: 'dialogs.passageEdit.scenePreview.cameraToolOff'
					)}
					onClick={toggleCameraTool}
					selectable
					selected={cameraTool && !cameraLocked}
					tooltipPosition="bottom"
				/>
			</div>
			<SceneSettingsTab
				assets={assets}
				camera={localStage.camera}
				cameraLockedReason={
					cameraLockedByScene
						? t('dialogs.passageEdit.scenePreview.lockedByScene')
						: undefined
				}
				editable={editable}
				onWrite={writes => commit(writes, EDIT_ORIGIN)}
				pane="camera"
				scene={parse.result?.scene}
			/>
		</div>
	);

	const selectionTab = (
		<div className="scene-sidebar-section">
			{!editable && (
				<p className="scene-sidebar-empty">
					{beatNote ?? t('dialogs.passageEdit.scenePreview.sidebar.readOnly')}
				</p>
			)}
			<StageSelectionControls
				assets={assets}
				editable={editable}
				entities={selectedEntities}
				note={beatNote}
				onDelete={remove}
				onFlip={flip}
				onResetStretch={resetStretch}
				onToggleLock={toggleEntityLock}
				onPose={setPose}
				onOpenLink={onOpenPassage}
				onPreviewPose={setPosePreview}
				onStepZ={stepZ}
				matchBg={
					selection.length === 1 && (
						<MatchBgButton
							bgKey={stage.bg}
							id={selection[0]}
							onApply={grade => {
								gradeEdit.change(selection[0], grade);
								gradeEdit.commit();
							}}
							root={root.current}
						/>
					)
				}
				gradeNote={gradeNote}
				onGrade={grade =>
					selection.length === 1 && gradeEdit.change(selection[0], grade)
				}
				onGradeCommit={gradeEdit.commit}
				onGradeOpenChange={gradeEdit.openChange}
			/>
		</div>
	);

	const walkTab = (
		<div className="scene-sidebar-section">
			{walkControls && <div className="scene-sidebar-row">{walkControls}</div>}
			{/* The walk area belongs to the backdrop asset, so it is drawn in the asset
			    editor's walk tool. This is the way there. */}
			<IconButton
				disabled={!stage.bg}
				icon={<IconWalk />}
				label={t('dialogs.passageEdit.scenePreview.sidebar.editWalkArea')}
				onClick={handleEditWalkArea}
				tooltipLabel={
					stage.bg
						? t('dialogs.passageEdit.scenePreview.sidebar.editWalkAreaHint', {
								bg: stage.bg
						  })
						: t('dialogs.passageEdit.scenePreview.sidebar.noBg')
				}
			/>
		</div>
	);

	const sidebarTabs: SceneSidebarTab[] = [
		{
			content: sceneTab,
			icon: <IconSettings />,
			id: 'scene',
			label: t('dialogs.passageEdit.scenePreview.sidebar.tabs.scene')
		},
		{
			content: cameraTab,
			icon: <IconCamera />,
			id: 'camera',
			label: t('dialogs.passageEdit.scenePreview.sidebar.tabs.camera')
		},
		{
			content: soundsTab,
			icon: <IconMusic />,
			id: 'sounds',
			label: t('dialogs.passageEdit.scenePreview.sidebar.tabs.sounds'),
			scope: beat > 0 ? 'beat' : 'global'
		},
		{
			content: (
				<LayersPanel
					editable={editable}
					hidden={hidden}
					onCommit={commit}
					onSelect={select}
					onToggleHidden={toggleHidden}
					resetBlocks={zResetBlocksShown}
					selection={selection}
					// Authored, not `stage`: resolving drops `of:`, which is what indents a
					// child row. Same beat, same patch, same ids, kinds and z as `stage` —
					// `layer-order` resolves `at` itself to rank by the drawn y.
					stage={localStage}
				/>
			),
			icon: <IconStack2 />,
			id: 'layers',
			label: t('dialogs.passageEdit.scenePreview.layers.toggle')
		},
		{
			content: (
				<BeatPanel
					autoAdvanceMs={holdMs}
					beat={shownBeat}
					beatCount={beats.length}
					beatNumber={beat}
					editable={editable}
					focusText={beatTextFocus}
					globals={parse.result?.scene}
					// Step 0 edits the scene's globals; they sit over the story's defaults only.
					inherited={beat > 0 ? bubbleDefaults : storyBubble}
					onClose={() => setSidebarOpen(false)}
					onMakeDefault={makeBeatStyleDefault}
					onSetBubble={handleBeatBubble}
					onSetKey={handleBeatKey}
					onSetText={handleBeatText}
					scope={beat > 0 ? 'beat' : 'scene'}
					stageIds={stageIds}
					storyColors={swatches}
				/>
			),
			icon: <IconMessage2 />,
			id: 'beat',
			label: t('dialogs.passageEdit.scenePreview.beatPanel'),
			scope: beat > 0 ? 'beat' : 'global'
		},
		...(hasSelection
			? [
					{
						content: selectionTab,
						icon:
							singleSelected && singleSelected.kind !== 'prop' ? (
								<IconUser />
							) : (
								<IconBox />
							),
						id: 'selection' as const,
						label: t(
							singleSelected && singleSelected.kind !== 'prop'
								? 'dialogs.passageEdit.scenePreview.sidebar.tabs.character'
								: 'dialogs.passageEdit.scenePreview.sidebar.tabs.object'
						)
					}
			  ]
			: []),
		{
			content: walkTab,
			icon: <IconWalk />,
			id: 'walk',
			label: t('dialogs.passageEdit.scenePreview.sidebar.tabs.walk')
		},
		{
			content: (
				<div className="scene-sidebar-section">
					<SceneLinksPanel
						editable={editable}
						onCreatePassage={editable ? onCreatePassage : undefined}
						onOpenPassage={onOpenPassage}
						onWrite={writes => commit(writes, EDIT_ORIGIN)}
						passageNames={passageNames}
						scene={parse.result?.scene}
					/>
				</div>
			),
			icon: <IconLink />,
			id: 'links',
			label: t('dialogs.passageEdit.scenePreview.sidebar.tabs.links')
		},
		...(parse.errors.length > 0 || sidebar.active === 'problems'
			? [
					{
						content: (
							<SceneErrorPanel
								errors={parse.errors}
								onApplyFix={
									editable && doc ? fix => applySceneFix(doc, fix) : undefined
								}
								onClose={() => setSidebarOpen(false)}
								onCreatePassage={editable ? onCreatePassage : undefined}
								onGoToLine={onGoToLine}
							/>
						),
						icon: <IconAlertTriangle />,
						id: 'problems' as const,
						label: t('dialogs.passageEdit.scenePreview.sidebar.tabs.problems')
					}
			  ]
			: [])
	];

	// The overlay scrolls inside the viewport when the view is zoomed in. The sidebar and
	// the stage tools sit outside that scroll, over the view, so they stay where the author
	// can reach them however far the stage has been scrolled.
	const stageBody = (
		<div
			// One width for every tab: a tab switch that resized the viewport would move the
			// stage under the pointer on the very click that selected a sprite.
			className={classNames('scene-stage-view', 'with-layers', {
				'sidebar-collapsed': !sidebar.open
			})}
		>
			<div className="scene-stage-viewport" ref={setViewport}>
				<div className="scene-stage-canvas" style={viewZoom.canvasStyle}>
					{stageOverlay}
				</div>
			</div>
			{stageTools}
			<SceneErrorBadge
				errors={parse.errors}
				onToggle={() => toggleTab('problems')}
				open={tabShown('problems')}
			/>
			<SceneSidebar
				active={sidebar.active}
				onActive={setSidebarTab}
				onOpenChange={setSidebarOpen}
				open={sidebar.open}
				tabs={sidebarTabs}
			/>
		</div>
	);

	return (
		<div
			className="scene-preview"
			data-hotkey-scope="scene-preview"
			data-testid="scene-preview"
			ref={root}
			// Focusable, so a click on the stage puts focus in the preview's key scope. Never
			// in the tab order: everything here is reachable through the controls in the bar.
			tabIndex={-1}
		>
			{bar}
			{stageBody}
		</div>
	);
};
