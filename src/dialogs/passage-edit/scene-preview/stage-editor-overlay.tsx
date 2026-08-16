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
import {LAYERS} from '@sliders/scene-types';
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
	dragTo,
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
}

export interface StageEditorOverlayProps {
	children: React.ReactNode;
	renderer?: DomRenderer;
	/** The stage as drawn, drag patch included. */
	stage: Stage;
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
}

/**
 * Every entity that can be clicked, ranked in global draw order.
 *
 * A prop in `front` must win over a character in `mid` however high that character's z is,
 * so the layer index outranks z rather than being folded in with it. The renderer writes
 * only a WITHIN-layer z-index to the DOM, which is why this cannot be read off the elements.
 */
export function hitTargets(
	stage: Stage,
	rectOf: (id: EntityId) => Rect | null | undefined
): HitTarget[] {
	const targets: HitTarget[] = [];
	const all = Object.values(stage?.entities ?? {}).filter(Boolean);

	for (const layer of LAYERS) {
		for (const entity of sortByZ(all.filter(e => e.layer === layer))) {
			const rect = rectOf(entity.id);

			if (rect) {
				targets.push({id: entity.id, rect, zIndex: targets.length});
			}
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
		onCameraPatch,
		onCancel,
		onCommit,
		onDropAsset,
		onDropFiles,
		onPatch,
		onSelect,
		onToggleFullScreen,
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
	const [dragging, setDragging] = React.useState(false);
	const [dropActive, setDropActive] = React.useState(false);
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
		onCameraPatch,
		onCommit,
		onPatch,
		stage
	});

	latest.current = {box, editable, onCameraPatch, onCommit, onPatch, stage};

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
		setDragging(false);
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
				}

				return;
			}

			if (!gesture.moved) {
				gesture.moved = true;
				setDragging(true);
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
					// Rounded here and not only on write, so the optimistic patch holds
					// exactly the value the text will get and the two can be compared for
					// equality when the parse catches up.
					const at = {x: roundCoord(result.at.x), y: roundCoord(result.at.y)};

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
		// them, so a click on one is a click on the link, not on the stage.
		if (
			(event.button !== 0 && event.button !== 1) ||
			(event.target as HTMLElement).closest?.('a')
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
		if ((event.target as HTMLElement).closest?.('a')) {
			return;
		}

		onToggleFullScreen();
	}

	const single = selection.length === 1 ? selection[0] : undefined;
	const singleRect = single === undefined ? undefined : rects.get(single);

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
									className="stage-editor-origin"
									style={{left: origin.x, top: origin.y}}
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
