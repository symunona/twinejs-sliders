/**
 * Selecting, dragging and resizing the speech bubble on stage.
 *
 * The bubble itself is the renderer's — `DialogueLayer` builds it and decides where it
 * goes. This draws a frame around whatever it produced and turns a drag into two numbers:
 * `at`, the bubble's centre as a fraction of the stage box, and `w`, its width as a
 * fraction of the box's width. Both are written onto the BEAT, because the same character
 * can speak twice in a scene and want the bubble somewhere else each time.
 *
 * A gesture paints through the real renderer rather than moving a copy: the draft style
 * goes back up to the preview, down into the dialogue layer, and the bubble the author is
 * dragging is the one the reader will see, wrapping and all.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {BubbleGeometry} from '@sliders/scene-edit';
import type {BubbleStyle} from '@sliders/scene-types';
import './bubble-editor.css';

export interface BubbleEditorProps {
	/** Index into `scene.beats` — the scrubber position minus one. */
	beat?: number;
	editable: boolean;
	/** The beat's style as parsed, before any draft. */
	style?: BubbleStyle;
	/** Live geometry during a gesture. `undefined` clears it. */
	onDraft: (style: BubbleStyle | undefined) => void;
	onCommit: (beat: number, geometry: BubbleGeometry) => void;
}

interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface Measured {
	/** The bubble, in frame pixels. */
	bubble: Rect;
	/** The letterboxed stage box, in frame pixels. */
	box: Rect;
}

type Mode = 'move' | 'west' | 'east';

interface Gesture {
	mode: Mode;
	pointerId: number;
	/** Pointer position when the gesture started, in CLIENT pixels. */
	start: {x: number; y: number};
	/** The frame's own client offset, sampled once so a scroll mid-drag cannot skew it. */
	frame: {left: number; top: number};
	/** The bubble's centre when the gesture started, in frame pixels. */
	centre: {x: number; y: number};
	startWidth: number;
	measured: Measured;
	moved: boolean;
}

/**
 * The style to paint with mid-gesture.
 *
 * `null` in a geometry means "remove this key when it is written", which as a live style
 * means "fall back to whatever the beat had" — so it is dropped rather than passed on.
 */
function draftStyle(
	style: BubbleStyle | undefined,
	geometry: BubbleGeometry
): BubbleStyle {
	return {
		...style,
		...(geometry.at === undefined ? {} : {at: geometry.at ?? undefined}),
		...(geometry.w === undefined ? {} : {w: geometry.w ?? undefined})
	};
}

/** Below this a bubble is a sliver with one word per line. */
const MIN_WIDTH_FRACTION = 0.08;

/** How far the pointer travels before a click becomes a drag. */
const DRAG_THRESHOLD_PX = 3;

/** The `[[link]]` under a point, if the pointer is over one. */
function linkAt(x: number, y: number): HTMLElement | undefined {
	for (const el of document.elementsFromPoint(x, y)) {
		const link = (el as HTMLElement).closest?.('[data-sliders-link]') as
			| HTMLElement
			| undefined;

		if (link) {
			return link;
		}
	}

	return undefined;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function rectIn(frame: DOMRect, el: Element): Rect {
	const rect = el.getBoundingClientRect();

	return {
		height: rect.height,
		left: rect.left - frame.left,
		top: rect.top - frame.top,
		width: rect.width
	};
}

/**
 * Where the bubble and the stage box are right now.
 *
 * Read out of the DOM rather than tracked in state: the dialogue layer positions the
 * bubble with a transform, after its own text has wrapped, and nothing short of measuring
 * the result knows how tall that made it.
 */
function measure(frameEl: HTMLElement): Measured | undefined {
	const bubbleEl = frameEl.querySelector('.sliders-bubble, .sliders-box');
	const boxEl = frameEl.querySelector('.sliders-stage-box');

	if (!bubbleEl || !boxEl) {
		return undefined;
	}

	const frame = frameEl.getBoundingClientRect();
	const box = rectIn(frame, boxEl);

	if (box.width === 0 || box.height === 0) {
		return undefined;
	}

	return {box, bubble: rectIn(frame, bubbleEl)};
}

export const BubbleEditor: React.FC<BubbleEditorProps> = ({
	beat,
	editable,
	onCommit,
	onDraft,
	style
}) => {
	const {t} = useTranslation();
	const ref = React.useRef<HTMLDivElement>(null);
	const gestureRef = React.useRef<Gesture>();
	const [selected, setSelected] = React.useState(false);
	const [measured, setMeasured] = React.useState<Measured>();
	const active = editable && beat !== undefined;

	// A different line is a different bubble, so the selection does not carry over.
	React.useEffect(() => setSelected(false), [beat]);

	/**
	 * Re-measure on every animation frame while the bubble is on screen.
	 *
	 * The dialogue layer does not announce a reposition, and everything can move it: a
	 * transition sliding the speaker, the panel being resized, text being typed. A rAF loop
	 * is cheap next to what it replaces (a MutationObserver plus a ResizeObserver plus a
	 * subscription) and it cannot go stale.
	 */
	React.useEffect(() => {
		if (!active) {
			setMeasured(undefined);

			return;
		}

		let frame = 0;
		let last = '';

		const tick = () => {
			const el = ref.current?.parentElement;
			const next = el ? measure(el) : undefined;
			const key = JSON.stringify(next ?? null);

			// Only re-render when something actually moved: this runs 60 times a second.
			if (key !== last) {
				last = key;
				setMeasured(next);
			}

			frame = window.requestAnimationFrame(tick);
		};

		tick();

		return () => window.cancelAnimationFrame(frame);
	}, [active]);

	const endGesture = React.useCallback(() => {
		gestureRef.current = undefined;
	}, []);

	const geometryFor = React.useCallback(
		(gesture: Gesture, event: PointerEvent): BubbleGeometry => {
			const pointer = {
				x: event.clientX - gesture.frame.left,
				y: event.clientY - gesture.frame.top
			};
			const {box} = gesture.measured;

			if (gesture.mode === 'move') {
				const centre = {
					x: gesture.centre.x + (event.clientX - gesture.start.x),
					y: gesture.centre.y + (event.clientY - gesture.start.y)
				};

				// Clamped to the box: the renderer keeps an out-of-range bubble on screen
				// anyway, so a stray `at: [1.4, -0.3]` in the file would say something the
				// player never does.
				return {
					at: {
						x: clamp01((centre.x - box.left) / box.width),
						y: clamp01((centre.y - box.top) / box.height)
					}
				};
			}

			// A side handle grows the bubble about its own centre, so the text does not slide
			// out from under the pointer as it widens.
			const half = Math.abs(pointer.x - gesture.centre.x);
			const width = Math.max(
				MIN_WIDTH_FRACTION,
				Math.min(1, (half * 2) / box.width)
			);

			return {w: width};
		},
		[]
	);

	React.useEffect(() => {
		const handleMove = (event: PointerEvent) => {
			const gesture = gestureRef.current;

			if (!gesture || event.pointerId !== gesture.pointerId) {
				return;
			}

			if (
				!gesture.moved &&
				Math.hypot(
					event.clientX - gesture.start.x,
					event.clientY - gesture.start.y
				) < DRAG_THRESHOLD_PX
			) {
				return;
			}

			gesture.moved = true;
			onDraft(draftStyle(style, geometryFor(gesture, event)));
		};

		const handleUp = (event: PointerEvent) => {
			const gesture = gestureRef.current;

			if (!gesture || event.pointerId !== gesture.pointerId) {
				return;
			}

			endGesture();

			if (!gesture.moved || beat === undefined) {
				// A press with no travel is a selection, not a move.
				onDraft(undefined);

				return;
			}

			const geometry = geometryFor(gesture, event);

			onDraft(undefined);
			onCommit(beat, geometry);
		};

		window.addEventListener('pointermove', handleMove);
		window.addEventListener('pointerup', handleUp);
		window.addEventListener('pointercancel', handleUp);

		return () => {
			window.removeEventListener('pointermove', handleMove);
			window.removeEventListener('pointerup', handleUp);
			window.removeEventListener('pointercancel', handleUp);
		};
	}, [beat, endGesture, geometryFor, onCommit, onDraft, style]);

	const begin = (event: React.PointerEvent, mode: Mode) => {
		if (!measured) {
			return;
		}

		// A `[[link]]` in the bubble keeps its click — ctrl-clicking one opens the passage
		// it names, and the frame lies directly over the words. The link is under the
		// pointer, not under the frame, so the point is what has to be asked.
		const link = linkAt(event.clientX, event.clientY);

		if (link) {
			link.dispatchEvent(
				new MouseEvent('click', {
					bubbles: true,
					cancelable: true,
					ctrlKey: event.ctrlKey,
					metaKey: event.metaKey
				})
			);

			return;
		}

		// The stage editor under this treats a press as "select nothing, maybe pan".
		event.stopPropagation();
		event.preventDefault();
		setSelected(true);

		const rect = ref.current?.parentElement?.getBoundingClientRect();
		const {bubble} = measured;

		gestureRef.current = {
			centre: {
				x: bubble.left + bubble.width / 2,
				y: bubble.top + bubble.height / 2
			},
			frame: {left: rect?.left ?? 0, top: rect?.top ?? 0},
			measured,
			mode,
			moved: false,
			pointerId: event.pointerId,
			start: {x: event.clientX, y: event.clientY},
			startWidth: bubble.width
		};
	};

	const bubble = measured?.bubble;

	// The root is always in the tree, even with nothing to frame: it is what holds the ref,
	// and a ref that only attaches once something has been measured can never measure
	// anything in the first place.
	return (
		<div className="scene-bubble-editor-root" ref={ref}>
			{active && bubble && (
				<div
					className={`scene-bubble-editor${selected ? ' selected' : ''}`}
					data-testid="scene-bubble-editor"
					style={{
						height: bubble.height,
						left: bubble.left,
						top: bubble.top,
						width: bubble.width
					}}
				>
					<div
						aria-label={t('dialogs.passageEdit.scenePreview.moveBubble')}
						className="scene-bubble-editor-body"
						onPointerDown={event => begin(event, 'move')}
						role="button"
						tabIndex={-1}
					/>
					{selected &&
						(['west', 'east'] as const).map(side => (
							<div
								className={`scene-bubble-editor-handle ${side}`}
								data-handle={side}
								key={side}
								onPointerDown={event => begin(event, side)}
							/>
						))}
				</div>
			)}
		</div>
	);
};
