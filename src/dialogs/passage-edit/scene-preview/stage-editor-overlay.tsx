/**
 * The visual editor's pointer surface and markers (spec 10, phases 1-3).
 *
 * This component IS the stage frame: it renders `<SceneStage>` as its child so that its own
 * box and the renderer's mount element are the same rectangle. That is not tidiness — every
 * number here is in MOUNT px (see `stage-geometry.ts`), so "the box the pointer is measured
 * against" and "the box the renderer reports rects in" have to be one element, or the
 * handles sit a few pixels off the sprite and nothing says why.
 *
 * Hit testing is by RECT, never by DOM event: `.sliders-entity` is `pointer-events: none`
 * and a rect test survives the camera transform without the renderer knowing the editor
 * exists. The marker layer is `pointer-events: none` too, so a click on a bubble link still
 * reaches the link and a guide line never eats a drag.
 */

import classNames from 'classnames';
import * as React from 'react';
import type {
	Camera,
	EntityId,
	Stage,
	StageEntity,
	Vec2
} from '@sliders/scene-types';
import {sortByZ} from '@sliders/render-dom';
import type {DomRenderer, Rect, StageBox} from '@sliders/render-dom';
import {
	imageFilesFrom,
	isAssetDrag,
	isFileDrag,
	readAssetDragData
} from './asset-drag';
import type {AssetDragPayload} from './asset-drag';
import {cameraWrite, panCamera, wheelZoomFactor, zoomCamera} from './scene-gestures';
import {
	displaySize,
	dragTo,
	gridCentre,
	gridLines,
	handlePoints,
	hitTest,
	mountToScene,
	nearestSnap,
	roundCoord,
	scaleFrom,
	sceneToMount,
	sceneTolerance,
	snapTargetsX,
	snapTargetsY
} from './stage-geometry';
import type {HandleId, HitTarget, SnapTarget} from './stage-geometry';
import {CAMERA_ORIGIN} from './use-scene-writer';
import type {EntityKeyWrite, SceneWrite, StagePatch} from './use-scene-writer';
import './stage-editor-overlay.css';

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * Without it a plain click would run the whole drag path, and since a drag snaps, clicking
 * a character near the centre line would quietly move it there. A selection gesture that
 * edits the file is not a selection gesture.
 */
const DRAG_THRESHOLD_PX = 3;

/**
 * Snap radius for a DROP, much wider than a drag's.
 *
 * A drag is a continuous adjustment the author can see happening; a drop is one shot from
 * another window entirely, and landing a character three pixels above the floor because the
 * cursor was three pixels high is a worse outcome than snapping a bit eagerly.
 */
const DROP_SNAP_TOLERANCE_PX = 24;

/**
 * How long a wheel-zoom burst waits for the next notch before it commits.
 *
 * A wheel has no pointerup, so the burst has to end on a timer. One write per burst is one
 * undo entry per burst — the same promise a drag makes.
 */
const WHEEL_COMMIT_DELAY_MS = 220;

/** Feet, bottom centre — the fallback when there is no rect to invert an origin out of. */
const DEFAULT_ORIGIN_FRAC = {x: 0.5, y: 1};

/** Gap between the sprite rect and the readout pinned to it, in MOUNT px. */
const READOUT_GAP_PX = 8;

/**
 * How much room the readout needs above a sprite before it stops fitting there.
 *
 * Roughly its own height plus the gap. A sprite whose top is higher than this on the mount
 * gets the readout underneath instead, which is the only other side guaranteed to be inside
 * the frame — the stage is always at least as tall as the tallest thing on it.
 */
const READOUT_HEIGHT_PX = 30;

interface Gesture {
	kind: 'move' | 'scale' | 'pan';
	pointerId: number;
	/** Frame position in client px, read once: a drag must not thrash layout every frame. */
	frame: {left: number; top: number};
	start: Vec2;
	/** Where each entity stood when the gesture began. Read from the stage, never accumulated. */
	startAt: Record<EntityId, Vec2>;
	ids: EntityId[];
	startScale: number;
	/** The camera a pan started from. Fixed, or the pan would chase itself. */
	startCamera: Camera;
	rect?: Rect;
	origin: Vec2;
	handle?: HandleId;
	moved: boolean;
	/**
	 * This press steps the scene forward if it turns out to be a tap.
	 *
	 * Decided at pointerdown, when what the press landed on is still known, and spent on
	 * pointerup — a press that grew into a pan is a pan and nothing else.
	 */
	advance?: boolean;
}

export interface StageEditorOverlayProps {
	children: React.ReactNode;
	renderer?: DomRenderer;
	/**
	 * The stage as drawn, drag patch included, `of:` already RESOLVED — every `at` in here is
	 * absolute, which is the only space a pointer can be compared against.
	 */
	stage: Stage;
	/**
	 * Where each `of:` child's `at` is measured from, absolute. Missing id = world space.
	 *
	 * A drag lands on an absolute point; the YAML holds an offset. This is the difference
	 * between the two, and the only place the overlay has to know `of:` exists at all.
	 */
	parentOffsets?: Record<EntityId, Vec2>;
	selection: EntityId[];
	/** False when there is no CodeMirror to write to — selection still works. */
	editable: boolean;
	/** Bumped when a foreign document change must seal any gesture in flight. */
	seal: number;
	onSelect: (ids: EntityId[]) => void;
	onPatch: (patch: StagePatch) => void;
	/** One gesture, one write. `origin` decides how CodeMirror groups it for undo. */
	onCommit: (writes: SceneWrite[], origin?: string) => void;
	onCancel: () => void;
	onToggleFullScreen: () => void;
	/**
	 * True while the stage IS the full screen player rather than the strip under the passage
	 * text. Clicks there are read as a reader's, not an author's.
	 */
	player?: boolean;
	/**
	 * A tap on empty stage steps the scene forward. Absent when it must not — on the last
	 * beat, or while the beat on screen offers links, which are the reader's own click to
	 * spend.
	 */
	onAdvance?: () => void;
	/** The camera a live pan or zoom is painting with. `undefined` drops it. */
	onCameraPatch?: (camera: Camera | undefined) => void;
	/** A tile from the asset panel landed on the stage, at this scene position. */
	onDropAsset?: (payload: AssetDragPayload, at: Vec2) => void;
	/**
	 * Image FILES landed on the stage — dragged in from the desktop rather than from the
	 * asset panel. They have to be uploaded before anything can be written, which is why
	 * this is a separate door from `onDropAsset` rather than a payload variant.
	 */
	onDropFiles?: (files: File[], at: Vec2) => void;
	/**
	 * Draw the measuring grid — the centre point and the lines a drag snaps to.
	 *
	 * A view aid and nothing else: it is inside the marker layer, so it never takes a
	 * pointer and turning it on cannot change what a click does.
	 */
	grid?: boolean;
}

/**
 * Every entity that can be clicked, ranked in draw order.
 *
 * One z space, so this is exactly the renderer's own sort — same `sortByZ`, same
 * insertion-order tie-break off the scene's key order. Recomputed here rather than read off
 * the DOM because the overlay also has to rank sprites the renderer has not laid out yet.
 */
export function hitTargets(
	stage: Stage,
	rectOf: (id: EntityId) => Rect | null | undefined
): HitTarget[] {
	const targets: HitTarget[] = [];
	const ids = Object.keys(stage?.entities ?? {});
	const all = ids
		.map((id, order) => ({entity: stage.entities[id], order}))
		.filter(item => !!item.entity)
		.map(item => ({...item.entity, order: item.order}));

	for (const entity of sortByZ(all)) {
		const rect = rectOf(entity.id);

		if (rect) {
			targets.push({id: entity.id, rect, zIndex: targets.length});
		}
	}

	return targets;
}

/** The sprite's origin point in MOUNT px — a character's feet. */
function originPoint(box: StageBox, camera: Camera, entity: StageEntity): Vec2 {
	return sceneToMount(box, camera, entity.at);
}

/**
 * The origin as a fraction of the sprite rect, inverted out of where the renderer actually
 * put the thing rather than re-derived from the character manifest. Two sources for one
 * number is how a handle ends up scaling about a point the sprite does not pivot on.
 */
function originFraction(rect: Rect | undefined, point: Vec2): Vec2 {
	if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
		return DEFAULT_ORIGIN_FRAC;
	}

	return {
		x: (point.x - rect.left) / rect.width,
		y: (point.y - rect.top) / rect.height
	};
}

/**
 * Where a dropped sprite lands: the same guides a drag snaps to, with a wider radius.
 *
 * Snapping y to the layer baseline is what makes the written `at:` a bare number rather
 * than a pair — a character dropped near the floor should read `at: -0.4`, not
 * `at: [-0.4, -0.847]`, which pins it to the floor of today's baseline constant forever.
 */
export function snapDropPoint(
	box: StageBox,
	camera: Camera,
	stage: Stage,
	at: Vec2
): Vec2 {
	const tolerance = sceneTolerance(box, camera, DROP_SNAP_TOLERANCE_PX);
	const others = Object.values(stage?.entities ?? {}).filter(Boolean);
	const x = nearestSnap(
		at.x,
		snapTargetsX(others.map(entity => entity.at.x)),
		tolerance.x
	);
	const y = nearestSnap(
		at.y,
		snapTargetsY(others.map(entity => entity.at.y)),
		tolerance.y
	);

	return {x: x ? x.value : at.x, y: y ? y.value : at.y};
}

export const StageEditorOverlay: React.FC<StageEditorOverlayProps> = props => {
	const {
		children,
		editable,
		grid,
		onAdvance,
		onCameraPatch,
		onCancel,
		onCommit,
		onDropAsset,
		onDropFiles,
		onPatch,
		onSelect,
		parentOffsets,
		onToggleFullScreen,
		player,
		renderer,
		seal,
		selection,
		stage
	} = props;
	const frameRef = React.useRef<HTMLDivElement>(null);
	const gestureRef = React.useRef<Gesture>();
	const [rects, setRects] = React.useState<Map<EntityId, Rect>>(new Map());
	const [box, setBox] = React.useState<StageBox>();
	const [guides, setGuides] = React.useState<{x?: number; y?: number}>({});
	const [hover, setHover] = React.useState<EntityId>();
	/**
	 * Which gesture is on screen, once it has passed the drag threshold.
	 *
	 * Also the `dragging` flag the cursor reads — one piece of state rather than two, so a
	 * grabbing cursor and a readout can never disagree about whether a drag is happening.
	 */
	const [active, setActive] = React.useState<Gesture['kind']>();
	/**
	 * Alt is held on a resize, so the pivot is the rect centre and not the sprite's origin.
	 *
	 * A plain boolean rather than part of `active`: it is written on every pointermove, and
	 * React bails out of a re-render when a primitive is set to the value it already has.
	 */
	const [pivotCentre, setPivotCentre] = React.useState(false);
	const [dropActive, setDropActive] = React.useState(false);
	const dragging = active !== undefined;
	const camera = stage.camera;

	/**
	 * The camera a live gesture is painting with.
	 *
	 * A wheel burst has to compound: the parse is debounced, so two notches in the same
	 * frame would both read the same pre-zoom camera off the stage and the second would
	 * undo the first. Cleared on commit, after which the optimistic camera patch on the
	 * stage is the live value again.
	 */
	const cameraRef = React.useRef<Camera>();
	const wheelTimer = React.useRef<number>();

	// What the window-level pointer handlers need, without re-binding them mid-gesture.
	const latest = React.useRef({
		box,
		editable,
		onAdvance,
		onCameraPatch,
		onCommit,
		onPatch,
		parentOffsets,
		stage
	});

	latest.current = {
		box,
		editable,
		onAdvance,
		onCameraPatch,
		onCommit,
		onPatch,
		parentOffsets,
		stage
	};

	// Rects are cached rather than asked for per pointermove: `rectOf` is cheap, but not
	// cheap enough to call once per entity per frame, and `subscribe` already fires after
	// every apply and every resize relayout — exactly when a rect can have moved.
	React.useEffect(() => {
		if (!renderer) {
			setRects(new Map());
			setBox(undefined);

			return;
		}

		const measure = () => {
			const next = new Map<EntityId, Rect>();

			for (const entity of Object.values(stage?.entities ?? {})) {
				const rect = renderer.rectOf(entity.id);

				if (rect) {
					next.set(entity.id, rect);
				}
			}

			setRects(next);
			setBox(renderer.stageBox());
		};

		measure();

		return renderer.subscribe(measure);
	}, [renderer, stage]);

	const targets = React.useMemo(
		() => hitTargets(stage, id => rects.get(id)),
		[rects, stage]
	);
	const targetsRef = React.useRef(targets);

	targetsRef.current = targets;

	const endGesture = React.useCallback(() => {
		gestureRef.current = undefined;
		setActive(undefined);
		setPivotCentre(false);
		setGuides({});
	}, []);

	const cancelWheel = React.useCallback(() => {
		if (wheelTimer.current !== undefined) {
			window.clearTimeout(wheelTimer.current);
			wheelTimer.current = undefined;
		}
	}, []);

	React.useEffect(() => cancelWheel, [cancelWheel]);

	// A foreign document change — the author typed, or hit undo — invalidates every offset
	// the gesture is holding. Drop the patch rather than write a position computed against
	// text that no longer exists.
	React.useEffect(() => {
		if (seal > 0 && (gestureRef.current || wheelTimer.current !== undefined)) {
			endGesture();
			cancelWheel();
			cameraRef.current = undefined;
			latest.current.onCameraPatch?.(undefined);
			onCancel();
		}
		// Only a bump of `seal` may cancel. Re-running because `onCancel` got a new
		// identity would kill a live gesture for no reason.
		// eslint-disable-next-line
	}, [seal]);

	const runGesture = React.useCallback(
		(event: PointerEvent, commit: boolean) => {
			const gesture = gestureRef.current;
			const current = latest.current;

			if (!gesture || !box) {
				return;
			}

			const pointer = {
				x: event.clientX - gesture.frame.left,
				y: event.clientY - gesture.frame.top
			};

			if (
				!gesture.moved &&
				Math.hypot(pointer.x - gesture.start.x, pointer.y - gesture.start.y) <
					DRAG_THRESHOLD_PX
			) {
				if (commit) {
					endGesture();

					// The press never became a drag, so it was a tap on empty stage: in the
					// full screen player that is how the reader turns the page.
					if (gesture.advance) {
						current.onAdvance?.();
					}
				}

				return;
			}

			if (!gesture.moved) {
				gesture.moved = true;
				setActive(gesture.kind);
			}

			if (gesture.kind === 'scale') {
				setPivotCentre(event.altKey);
			}

			if (gesture.kind === 'pan') {
				const next = panCamera(box, gesture.startCamera, gesture.start, pointer);

				cameraRef.current = next;
				current.onCameraPatch?.(next);

				if (commit) {
					endGesture();
					cameraRef.current = undefined;

					if (current.editable) {
						current.onCommit([cameraWrite(next)], CAMERA_ORIGIN);
					} else {
						// `camera:` is part of the scene, not a viewport control: a pan that
						// stayed would look exactly like a scene whose camera had been moved.
						// With nothing to write it into there is no text coming to replace the
						// patch, so the stage snaps back to what the passage actually says.
						current.onCameraPatch?.(undefined);
					}
				}

				return;
			}

			const patch: StagePatch = {};
			const writes: EntityKeyWrite[] = [];
			let snappedX: SnapTarget | undefined;
			let snappedY: SnapTarget | undefined;

			if (gesture.kind === 'scale') {
				const id = gesture.ids[0];
				const entity = current.stage.entities?.[id];

				if (entity) {
					const scale = roundCoord(
						scaleFrom(
							gesture.handle!,
							gesture.startScale,
							gesture.rect!,
							gesture.origin,
							gesture.start,
							pointer,
							{aboutCentre: event.altKey}
						)
					);

					patch[id] = {scale};
					writes.push({
						id,
						kind: entity.kind,
						key: 'scale',
						ref: entity.ref,
						// A default written out explicitly is noise in a hand-edited file,
						// so coming back to 1 deletes the key instead of writing it.
						value: scale === 1 ? undefined : scale
					});
				}
			} else {
				// Snapping one entity onto a line the author can see is helpful; snapping
				// each member of a multi-select to its own line silently destroys the
				// spacing that made them a group.
				const single = gesture.ids.length === 1;
				const others = Object.values(current.stage.entities ?? {}).filter(
					entity => !gesture.ids.includes(entity.id)
				);
				const axisLock = event.shiftKey
					? Math.abs(pointer.x - gesture.start.x) >=
						Math.abs(pointer.y - gesture.start.y)
						? 'x'
						: 'y'
					: undefined;

				for (const id of gesture.ids) {
					const entity = current.stage.entities?.[id];

					if (!entity) {
						continue;
					}

					const result = dragTo(
						gesture.startAt[id],
						gesture.start,
						pointer,
						box,
						camera,
						{
							axisLock,
							snap: single && !event.altKey,
							snapTargetsX: snapTargetsX(others.map(e => e.at.x)),
							snapTargetsY: snapTargetsY(others.map(e => e.at.y))
						}
					);
					// Back into the space the YAML is written in. The drag, the snap lines and
					// the pointer are all absolute; an `of:` child's `at` is an offset. The
					// SCREEN position is what snapped, so the subtraction happens after it —
					// a child snapped onto the centre line sits on the centre line, whatever
					// that makes its offset read as.
					const offset = current.parentOffsets?.[id];
					const local = offset
						? {x: result.at.x - offset.x, y: result.at.y - offset.y}
						: result.at;
					// Rounded here and not only on write, so the optimistic patch holds
					// exactly the value the text will get and the two can be compared for
					// equality when the parse catches up.
					const at = {x: roundCoord(local.x), y: roundCoord(local.y)};

					snappedX = snappedX ?? result.snappedX;
					snappedY = snappedY ?? result.snappedY;
					patch[id] = {at};
					writes.push({
						id,
						kind: entity.kind,
						key: 'at',
						ref: entity.ref,
						value: at
					});
				}
			}

			current.onPatch(patch);
			setGuides({
				x: snappedX && sceneToMount(box, camera, {x: snappedX.value, y: 0}).x,
				y: snappedY && sceneToMount(box, camera, {x: 0, y: snappedY.value}).y
			});

			if (commit) {
				endGesture();

				if (current.editable) {
					current.onCommit(writes);
				} else {
					// Same bargain as the pan above: nothing to write the move into, so no
					// text is coming to replace the optimistic patch and it must not stay.
					current.onPatch({});
				}
			}
		},
		[box, camera, endGesture]
	);

	// Window listeners rather than pointer capture: the preview portals itself to the body
	// when it goes full screen, and a capture set on an element that is then reparented is
	// lost mid-drag.
	React.useEffect(() => {
		const move = (event: PointerEvent) => {
			if (gestureRef.current?.pointerId === event.pointerId) {
				runGesture(event, false);
			}
		};
		const up = (event: PointerEvent) => {
			if (gestureRef.current?.pointerId === event.pointerId) {
				runGesture(event, true);
			}
		};
		const cancel = () => {
			if (gestureRef.current) {
				endGesture();
				onCancel();
			}
		};

		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', cancel);

		return () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', cancel);
		};
	}, [endGesture, onCancel, runGesture]);

	/**
	 * Scroll-zoom, on Ctrl/Cmd + wheel only.
	 *
	 * A bare wheel has to keep scrolling the passage dialog: the preview sits in the middle
	 * of a scrolling column and the pointer passes over it constantly on the way somewhere
	 * else, so a stage that swallowed plain scroll would make the dialog feel broken. Ctrl +
	 * wheel is also exactly what a trackpad pinch reports, so pinch-to-zoom works for free —
	 * and it is the browser's page-zoom chord, which is why the listener is non-passive and
	 * calls preventDefault: inside an editor, zoom means zoom the thing under the cursor.
	 */
	React.useEffect(() => {
		const frame = frameRef.current;

		if (!frame) {
			return;
		}

		const onWheel = (event: WheelEvent) => {
			const current = latest.current;

			if (
				!(event.ctrlKey || event.metaKey) ||
				!current.box ||
				!current.editable
			) {
				return;
			}

			event.preventDefault();

			const rect = frame.getBoundingClientRect();
			const base = cameraRef.current ?? current.stage.camera;
			const next = zoomCamera(
				current.box,
				base,
				{x: event.clientX - rect.left, y: event.clientY - rect.top},
				wheelZoomFactor(event.deltaY, event.deltaMode)
			);

			cameraRef.current = next;
			current.onCameraPatch?.(next);
			cancelWheel();

			wheelTimer.current = window.setTimeout(() => {
				wheelTimer.current = undefined;
				cameraRef.current = undefined;
				latest.current.onCommit([cameraWrite(next)], CAMERA_ORIGIN);
			}, WHEEL_COMMIT_DELAY_MS);
		};

		frame.addEventListener('wheel', onWheel, {passive: false});

		return () => frame.removeEventListener('wheel', onWheel);
	}, [cancelWheel]);

	function frameOffset() {
		const rect = frameRef.current?.getBoundingClientRect();

		return {left: rect?.left ?? 0, top: rect?.top ?? 0};
	}

	function beginGesture(
		event: React.PointerEvent,
		kind: Gesture['kind'],
		ids: EntityId[],
		handle?: HandleId
	) {
		const frame = frameOffset();
		const startAt: Record<EntityId, Vec2> = {};

		for (const id of ids) {
			const entity = stage.entities?.[id];

			if (entity) {
				startAt[id] = {...entity.at};
			}
		}

		const primary = stage.entities?.[ids[0]];
		const rect = rects.get(ids[0]);

		gestureRef.current = {
			frame,
			handle,
			ids,
			kind,
			moved: false,
			origin: originFraction(
				rect,
				primary && box ? originPoint(box, camera, primary) : {x: 0, y: 0}
			),
			pointerId: event.pointerId,
			rect,
			start: {x: event.clientX - frame.left, y: event.clientY - frame.top},
			startAt,
			// A pan mid-burst continues from what the wheel left behind, not from the
			// camera the debounced parse is still holding.
			startCamera: cameraRef.current ?? camera,
			startScale: primary?.scale ?? 1
		};
	}

	function handlePointerDown(event: React.PointerEvent) {
		// Links inside bubbles are real anchors (D3) and the marker layer does not cover
		// them, so a click on one is a click on the link, not on the stage. The player's
		// corner controls and the selection row sit inside the stage for the same reason
		// and are read the same way: a press on them is theirs, and must not also pan, clear
		// the selection the row is speaking for, or turn the page.
		if (
			(event.button !== 0 && event.button !== 1) ||
			(event.target as HTMLElement).closest?.(
				'a, .scene-preview-nav, .scene-preview-selection'
			)
		) {
			return;
		}

		// The browser's own press-and-move gestures — text selection, and the native drag
		// that starts when a press lands INSIDE an existing selection — must not run on the
		// stage. A native drag makes the browser take the pointer away and fire
		// `pointercancel`, so the gesture in flight is thrown away and the sprite snaps back
		// to where it started. That is what made a drag right after a resize look broken: the
		// resize left a text selection behind, and the next press landed in it.
		event.preventDefault();

		// preventDefault also cancels the focus that a press would have moved, so the stage
		// takes the keyboard by hand — that is how the arrows nudge instead of moving the
		// caret, and how the `scene-preview` hotkey scope resolves from focus.
		frameRef.current?.focus();

		// Middle drag pans from anywhere, including from on top of a sprite — the escape
		// hatch for a stage so full that there is no empty ground left to grab.
		if (event.button === 1) {
			beginGesture(event, 'pan', []);

			return;
		}

		const frame = frameOffset();
		const hit = hitTest(targetsRef.current, {
			x: event.clientX - frame.left,
			y: event.clientY - frame.top
		});

		if (!hit) {
			onSelect([]);
			// Empty ground is the discoverable pan handle: the cursor over it is already a
			// grab hand, and a press that never passes the drag threshold is still just the
			// click that cleared the selection.
			beginGesture(event, 'pan', []);

			// Clearing a selection is what the tap was FOR when there was one, so stepping
			// forward waits for the next tap. Same escalation Escape has: let go of the
			// stage first, then read on.
			if (gestureRef.current) {
				gestureRef.current.advance = selection.length === 0;
			}

			return;
		}

		// Ctrl/Cmd-click extends the selection. Shift is not free here: it already means
		// axis lock for the drag this same press may turn into.
		const extend = event.ctrlKey || event.metaKey;
		let next = selection;

		if (extend) {
			next = selection.includes(hit)
				? selection.filter(id => id !== hit)
				: [...selection, hit];
		} else if (!selection.includes(hit)) {
			next = [hit];
		}

		if (next !== selection) {
			onSelect(next);
		}

		if (next.length > 0) {
			beginGesture(event, 'move', next);
		}
	}

	function handlePointerMove(event: React.PointerEvent) {
		if (gestureRef.current) {
			return;
		}

		const frame = frameOffset();

		setHover(
			hitTest(targetsRef.current, {
				x: event.clientX - frame.left,
				y: event.clientY - frame.top
			})
		);
	}

	/** Does this drag carry something the stage knows how to land? */
	function acceptsDrag(types: readonly string[] | undefined): boolean {
		if (!editable) {
			return false;
		}

		return (
			(!!onDropAsset && isAssetDrag(types)) ||
			(!!onDropFiles && isFileDrag(types))
		);
	}

	function handleDragOver(event: React.DragEvent) {
		if (!acceptsDrag(event.dataTransfer?.types)) {
			return;
		}

		// preventDefault on dragover is what makes an element a drop target at all.
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		setDropActive(true);
	}

	function handleDragLeave(event: React.DragEvent) {
		// dragleave also fires when the pointer crosses onto a child, and the stage is full
		// of them. Only a leave that actually left the frame counts.
		if (!frameRef.current?.contains(event.relatedTarget as Node | null)) {
			setDropActive(false);
		}
	}

	function handleDrop(event: React.DragEvent) {
		setDropActive(false);

		if (!editable) {
			return;
		}

		const payload = readAssetDragData(event.dataTransfer);
		// Images dragged in from the desktop, a file manager, or another tab. Only read when
		// the drag is not one of ours: a panel tile also sets `text/plain`, and a browser
		// that decided to synthesize a file out of that would place the wrong thing.
		const files = payload ? [] : imageFilesFrom(event.dataTransfer);

		if (!payload && files.length === 0) {
			return;
		}

		event.preventDefault();

		const frame = frameOffset();
		const point = {
			x: event.clientX - frame.left,
			y: event.clientY - frame.top
		};
		const at = box
			? snapDropPoint(box, camera, stage, mountToScene(box, camera, point))
			: {x: 0, y: 0};

		if (payload) {
			onDropAsset?.(payload, at);
		} else {
			onDropFiles?.(files, at);
		}
	}

	function handleDoubleClick(event: React.MouseEvent) {
		if (
			(event.target as HTMLElement).closest?.(
				'a, .scene-preview-nav, .scene-preview-selection'
			)
		) {
			return;
		}

		// In the player a click is a page turn, so two of them are two page turns — leaving
		// full screen under the reader mid-sentence is not what they asked for. Escape and
		// the toolbar button are the way out; double click is only the way IN.
		if (player) {
			return;
		}

		onToggleFullScreen();
	}

	// Recomputed only when the grid is on: the lines move with the camera and with every
	// relayout, and computing them while they are hidden would be per-keystroke work for
	// nothing.
	const gridMarks = React.useMemo(
		() => (grid && box ? gridLines(box, camera) : []),
		[box, camera, grid]
	);
	const centre = grid && box ? gridCentre(box, camera) : undefined;

	const single = selection.length === 1 ? selection[0] : undefined;
	const singleRect = single === undefined ? undefined : rects.get(single);

	// The entity a live move or resize is speaking for. A multi-select move reports the one
	// that was grabbed first rather than four stacked readouts, and a pan reports nothing —
	// the camera moved, the scene did not.
	const readoutId =
		active === 'move' || active === 'scale' ? selection[0] : undefined;
	const readoutEntity =
		readoutId === undefined ? undefined : stage.entities?.[readoutId];
	const readoutRect = readoutId === undefined ? undefined : rects.get(readoutId);
	const readoutSize = displaySize(readoutRect, camera);
	// Above the sprite by default: a drag holds the pointer at the sprite, and the numbers
	// are no use underneath the hand that is moving it.
	const readoutAbove = (readoutRect?.top ?? 0) > READOUT_HEIGHT_PX;

	return (
		<div
			className={classNames('stage-editor', {
				dragging,
				'drop-active': dropActive,
				'over-entity': !!hover
			})}
			data-testid="stage-editor"
			onDoubleClick={handleDoubleClick}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			onPointerDown={handlePointerDown}
			onPointerLeave={() => setHover(undefined)}
			onPointerMove={handlePointerMove}
			ref={frameRef}
			tabIndex={0}
		>
			{children}
			<div className="stage-editor-markers">
				{/* Clipped to the stage box: zoomed in, the lines run past the letterbox,
				    and a grid drawn over the black bars claims stage where there is none. */}
				{grid && box && (
					<div
						className="stage-editor-grid"
						data-testid="stage-editor-grid"
						style={{
							height: box.height,
							left: box.left,
							top: box.top,
							width: box.width
						}}
					>
						{gridMarks.map(line => (
							<div
								className={`stage-editor-grid-line ${line.axis} ${line.kind}`}
								data-kind={line.kind}
								data-scene={line.scene}
								key={`${line.axis}:${line.scene}`}
								style={
									line.axis === 'x'
										? {left: line.at - box.left}
										: {top: line.at - box.top}
								}
							/>
						))}
						{centre && (
							<div
								className="stage-editor-grid-centre"
								data-testid="stage-editor-grid-centre"
								style={{left: centre.x - box.left, top: centre.y - box.top}}
							/>
						)}
					</div>
				)}
				{guides.x !== undefined && (
					<div
						className="stage-editor-guide vertical"
						style={{left: guides.x}}
					/>
				)}
				{guides.y !== undefined && (
					<div
						className="stage-editor-guide horizontal"
						style={{top: guides.y}}
					/>
				)}
				{selection.map(id => {
					const rect = rects.get(id);
					const entity = stage.entities?.[id];

					if (!rect || !entity) {
						return null;
					}

					const origin = box ? originPoint(box, camera, entity) : undefined;
					// Read-only markers. A character's anchors are global — dragging one
					// here would silently move every other scene's bubbles, and that is
					// the character editor's business, not this one's.
					const anchor = renderer?.measure(id, 'bubble') ?? undefined;

					return (
						<React.Fragment key={id}>
							<div
								className="stage-editor-selection"
								data-entity-id={id}
								style={{
									height: rect.height,
									left: rect.left,
									top: rect.top,
									width: rect.width
								}}
							/>
							{origin && (
								<div
									className={classNames('stage-editor-origin', {
										// The ref point of the thing being dragged: where its
										// `at:` is measured from, and what a resize pivots on.
										// Lit up only for the entity the gesture is about, so a
										// group move does not turn into a field of crosses.
										active:
											id === readoutId && !(active === 'scale' && pivotCentre)
									})}
									data-testid={
										id === readoutId ? 'stage-editor-origin-active' : undefined
									}
									style={{left: origin.x, top: origin.y}}
								/>
							)}
							{/* Alt-resize pivots on the rect centre instead, so that is where
							    the highlight goes — the marker follows the maths, it does not
							    describe an intention. */}
							{id === readoutId && active === 'scale' && pivotCentre && (
								<div
									className="stage-editor-origin active centre"
									data-testid="stage-editor-pivot-centre"
									style={{
										left: rect.left + rect.width / 2,
										top: rect.top + rect.height / 2
									}}
								/>
							)}
							{anchor && (
								<div
									className="stage-editor-anchor"
									style={{left: anchor.x, top: anchor.y}}
								/>
							)}
						</React.Fragment>
					);
				})}
				{/* What the gesture is doing, in numbers: where the ref point now sits, and
				    how big the sprite is drawn. `at` is the ABSOLUTE position — the same
				    space the grid and the snap guides are in — which for an `of:` child is
				    not the offset its YAML line holds. */}
				{readoutEntity && readoutRect && (
					<div
						className="stage-editor-readout"
						data-testid="stage-editor-readout"
						style={{
							left: Math.max(0, readoutRect.left),
							top: readoutAbove
								? readoutRect.top - READOUT_GAP_PX
								: readoutRect.top + readoutRect.height + READOUT_GAP_PX,
							transform: readoutAbove ? 'translateY(-100%)' : undefined
						}}
					>
						{active === 'scale' ? (
							<span className="scale">
								&times;{roundCoord(readoutEntity.scale ?? 1)}
							</span>
						) : (
							<span className="at">
								x {roundCoord(readoutEntity.at.x)} y{' '}
								{roundCoord(readoutEntity.at.y)}
							</span>
						)}
						<span className="size">
							{readoutSize.width} &times; {readoutSize.height}
						</span>
						{selection.length > 1 && (
							<span className="more">+{selection.length - 1}</span>
						)}
					</div>
				)}
				{/* Handles only for a single selection: a group resize would need an
				    anchor that is nobody's origin. Multi-select gets move only. */}
				{editable &&
					single !== undefined &&
					singleRect &&
					Object.entries(handlePoints(singleRect)).map(([handle, point]) => (
						<div
							className={`stage-editor-handle ${handle}`}
							data-handle={handle}
							key={handle}
							onPointerDown={event => {
								event.stopPropagation();
								// Same bargain as the frame's own handler: no browser
								// selection, so the next press cannot land inside one.
								event.preventDefault();
								frameRef.current?.focus();
								beginGesture(event, 'scale', [single], handle as HandleId);
							}}
							style={{left: point.x, top: point.y}}
						/>
					))}
			</div>
		</div>
	);
};
