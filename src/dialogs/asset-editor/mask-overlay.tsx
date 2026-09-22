import {AssetMask, Frac2, MaskOp, MaskShape} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
// Straight from the file rather than the folder's barrel: the barrel also pulls in
// `anchor-select` and the preset list, and none of the mask's business is with those.
import {useArtRect} from '../../components/anchor/use-art-rect';
import {
	FREEHAND_MIN_STEP,
	MaskMode,
	MaskToolId,
	VERTEX_RADIUS,
	hitShape,
	hitVertex,
	liveShapes,
	newShapeId,
	roundPoint,
	shapePath,
	simplifyRing
} from './mask-shapes';

export interface MaskOverlayProps {
	/** The canvas the mask belongs to. Letterboxed; measured, never assumed. */
	art: React.RefObject<HTMLElement>;
	/** The positioned element the svg is drawn in. */
	container: React.RefObject<HTMLElement>;
	/** Source image pixels, for the viewBox. */
	width: number;
	height: number;
	mode: MaskMode;
	tool: MaskToolId;
	mask: AssetMask;
	/** The shape whose handles are shown and whose controls the pane is editing. */
	selected?: string;
	onSelect: (shapeId: string | undefined) => void;
	onChange: (mask: AssetMask) => void;
	/** Default op for a shape drawn now. */
	op: MaskOp;
	feather: number;
	disabled?: boolean;
}

/** The shape being drawn right now: the one piece of mask state the overlay owns. */
interface Draft {
	points: Frac2[];
	/** Which gesture opened it — a polygon closes on a click, a freehand on release. */
	tool: 'polygon' | 'freehand';
}

/** A vertex being dragged. */
interface VertexDrag {
	index: number;
	shapeId: string;
}

/**
 * One finished shape's outline.
 *
 * `shapePath` returns a `d`, not a `points` list -- the two are different grammars and
 * `<polygon>` will not take the one that starts with `M`. `vectorEffect` keeps the stroke
 * a constant screen width: the viewBox is in source pixels, so a 2048-wide image would
 * otherwise draw an outline several pixels thick and a 200-wide one a hairline.
 */
const ShapeOutline: React.FC<{className: string; path: string}> = ({
	className,
	path
}) => <path className={className} d={path} vectorEffect="non-scaling-stroke" />;

function pointsAttr(points: Frac2[], width: number, height: number): string {
	return points.map(p => `${p.x * width},${p.y * height}`).join(' ');
}

/**
 * The hand-drawing surface: one `<svg>` laid over the art, in source-image coordinates.
 *
 * The viewBox does every conversion there is. Points are fractions of the source image,
 * the svg is sized to the measured art rect, so a shape drawn at 1200px wide and re-opened
 * in a 300px dialog lands on the same pixels. The only hand conversion left is turning a
 * pointer's client coordinates back into a fraction.
 *
 * It holds no mask state. Every mutation leaves through `onChange`, so undo, dirty and
 * save all see the same single copy on the asset's meta.
 */
export const MaskOverlay: React.FC<MaskOverlayProps> = props => {
	const {
		art,
		container,
		disabled,
		feather,
		height,
		mask,
		mode,
		onChange,
		onSelect,
		op,
		selected,
		tool,
		width
	} = props;
	const rect = useArtRect(art, container);
	const svg = React.useRef<SVGSVGElement>(null);
	const [draft, setDraft] = React.useState<Draft>();
	const [drag, setDrag] = React.useState<VertexDrag>();
	/** Where the pointer is, for the polygon's rubber band. Never leaves the component. */
	const [cursor, setCursor] = React.useState<Frac2>();

	/**
	 * Whether this overlay is taking gestures at all.
	 *
	 * The stage is shared with the crop drag and the one-shot anchor pick, both of which
	 * start on the canvas underneath. A live sheet over the art swallows both, so
	 * `rendered` and `disabled` mean no handlers and `pointer-events: none`.
	 */
	const live = mode !== 'rendered' && !disabled;
	/** Feather, the freehand step and the vertex radius are all fractions of this. */
	const short = Math.min(width, height) || 1;
	const handleRadius = VERTEX_RADIUS * short;

	function fracFrom(event: {clientX: number; clientY: number}): Frac2 | undefined {
		const box = svg.current?.getBoundingClientRect();

		// Zero either way before layout, and dividing by it would put NaN on the meta.
		if (!box || !box.width || !box.height) {
			return undefined;
		}

		return roundPoint({
			x: (event.clientX - box.left) / box.width,
			y: (event.clientY - box.top) / box.height
		});
	}

	/**
	 * Distance between two fractions, in short-edge units.
	 *
	 * Plain `hypot` over the fractions is wrong on anything but a square image: on a
	 * 2000x500 sheet one x-fraction is four times the pixels of one y-fraction, and a
	 * freehand step would record four times as often going sideways.
	 */
	function apart(a: Frac2, b: Frac2): number {
		return Math.hypot(((a.x - b.x) * width) / short, ((a.y - b.y) * height) / short);
	}

	function endDraft() {
		setDraft(undefined);
		setCursor(undefined);
	}

	function commit(points: Frac2[]) {
		endDraft();

		// Two points are a line, and a line has no inside. Drop it rather than write a
		// shape that `liveShapes` would filter out anyway.
		if (points.length < 3) {
			return;
		}

		const shape: MaskShape = {
			feather,
			id: newShapeId(mask.shapes),
			op,
			points: points.map(roundPoint)
		};

		onChange({shapes: [...mask.shapes, shape]});
		// Pick it up straight away, so the pane's op and feather land on the shape that
		// was just drawn instead of on the next one.
		onSelect(shape.id);
	}

	/**
	 * Close a polygon.
	 *
	 * A double click has already added its second click as a point, on top of the first.
	 * Drop a tail that landed inside a vertex of the point before it.
	 */
	function closeDraft(points: Frac2[]) {
		const last = points.length - 1;

		commit(
			points.length > 3 && apart(points[last], points[last - 1]) < VERTEX_RADIUS
				? points.slice(0, last)
				: points
		);
	}

	function removeShape(shapeId: string) {
		onChange({shapes: mask.shapes.filter(shape => shape.id !== shapeId)});

		if (selected === shapeId) {
			onSelect(undefined);
		}
	}

	function moveVertex(at: VertexDrag, point: Frac2) {
		onChange({
			shapes: mask.shapes.map(shape =>
				shape.id === at.shapeId
					? {
							...shape,
							points: shape.points.map((existing, index) =>
								index === at.index ? point : existing
							)
					  }
					: shape
			)
		});
	}

	function handlePointerDown(event: React.PointerEvent) {
		const point = fracFrom(event);

		if (!point || event.button !== 0) {
			return;
		}

		if (tool === 'freehand') {
			// Capture, so a stroke that wanders off the art still finishes here rather than
			// on whatever element the pointer happens to be over when it is released.
			event.currentTarget.setPointerCapture(event.pointerId);
			setDraft({points: [point], tool: 'freehand'});
			return;
		}

		if (tool === 'edit') {
			const vertex = hitVertex(mask.shapes, point, VERTEX_RADIUS);

			if (vertex) {
				event.currentTarget.setPointerCapture(event.pointerId);
				setDrag(vertex);
				onSelect(vertex.shapeId);
				return;
			}

			// A press on a shape picks it, a press on empty ground drops the selection.
			onSelect(hitShape(mask.shapes, point));
		}

		// Polygon adds its points on click instead, so that the second click of a double
		// click can be taken back when the double click closes the shape.
	}

	function handlePointerMove(event: React.PointerEvent) {
		const point = fracFrom(event);

		if (!point) {
			return;
		}

		if (drag) {
			moveVertex(drag, point);
			return;
		}

		if (draft?.tool === 'freehand') {
			if (apart(point, draft.points[draft.points.length - 1]) >= FREEHAND_MIN_STEP) {
				setDraft({...draft, points: [...draft.points, point]});
			}

			return;
		}

		if (draft?.tool === 'polygon') {
			setCursor(point);
		}
	}

	// Nothing releases the capture: a pointerup releases it implicitly, and asking for it
	// again throws in a real browser.
	function handlePointerUp() {
		if (drag) {
			setDrag(undefined);
			return;
		}

		if (draft?.tool === 'freehand') {
			commit(
				draft.points.length >= 3
					? simplifyRing(draft.points, FREEHAND_MIN_STEP)
					: draft.points
			);
		}
	}

	function handleClick(event: React.MouseEvent) {
		if (tool !== 'polygon') {
			return;
		}

		const point = fracFrom(event);

		if (!point) {
			return;
		}

		// Back on the first vertex: that is the close gesture, not a fourth point.
		if (
			draft &&
			draft.points.length >= 3 &&
			apart(point, draft.points[0]) < VERTEX_RADIUS
		) {
			commit(draft.points);
			return;
		}

		setDraft(
			draft?.tool === 'polygon'
				? {...draft, points: [...draft.points, point]}
				: {points: [point], tool: 'polygon'}
		);
	}

	function handleDoubleClick(event: React.MouseEvent) {
		if (tool !== 'polygon' || !draft) {
			return;
		}

		event.preventDefault();
		closeDraft(draft.points);
	}

	// A half-drawn shape belongs to the gesture that started it. Switching tool or
	// leaving the drawing modes ends that gesture, so the draft goes with it rather than
	// reappearing, three points old, the next time the tool comes back.
	React.useEffect(() => {
		setDraft(undefined);
		setDrag(undefined);
		setCursor(undefined);
	}, [live, tool]);

	/**
	 * Keys are taken off the window rather than off a focusable svg.
	 *
	 * The two that matter most are pressed while the svg does not have focus: Delete
	 * after the shape was picked from the list in the right pane, Enter after a polygon
	 * click that moved focus nowhere. `tabIndex` would hear neither. Guarded on the way
	 * in instead — ignored while something is being typed into, and Escape is only
	 * swallowed when there is a shape in progress to cancel, so an idle overlay never
	 * steals the key that closes the dialog.
	 *
	 * No dependency list: the handler closes over the draft, the mask and the selection,
	 * and re-subscribing one listener per render is cheaper than a ref for each of them.
	 */
	React.useEffect(() => {
		if (!live) {
			return;
		}

		function handleKey(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;

			if (
				target &&
				(target.isContentEditable ||
					/^(input|select|textarea)$/i.test(target.tagName))
			) {
				return;
			}

			switch (event.key) {
				case 'Escape':
					if (!draft) {
						return;
					}

					event.preventDefault();
					event.stopPropagation();
					endDraft();
					return;

				case 'Enter':
					if (draft?.tool !== 'polygon') {
						return;
					}

					event.preventDefault();
					closeDraft(draft.points);
					return;

				case 'Backspace':
				case 'Delete':
					// A draft is cancelled with Escape; Delete is for a finished shape.
					if (draft || !selected) {
						return;
					}

					event.preventDefault();
					removeShape(selected);
			}
		}

		window.addEventListener('keydown', handleKey);

		return () => window.removeEventListener('keydown', handleKey);
	});

	if (mode === 'rendered') {
		return null;
	}

	// Measured on the tick after mount. Drawn but hidden until then, rather than stretched
	// over the whole container: the container includes the letterbox, and one frame of
	// shapes in the wrong place is worse than one frame of none.
	const box: React.CSSProperties = rect
		? {height: rect.height, left: rect.left, top: rect.top, width: rect.width}
		: {height: 0, left: 0, top: 0, visibility: 'hidden', width: 0};

	return (
		<svg
			className={classNames('mask-overlay', `tool-${tool}`, `mode-${mode}`, {live})}
			data-testid="mask-overlay"
			onClick={live ? handleClick : undefined}
			onDoubleClick={live ? handleDoubleClick : undefined}
			onPointerDown={live ? handlePointerDown : undefined}
			onPointerMove={live ? handlePointerMove : undefined}
			onPointerUp={live ? handlePointerUp : undefined}
			// The svg is sized to the measured art, which already carries the image's
			// aspect ratio, so `none` maps the viewBox onto it one to one. The default
			// `meet` would fit it again and re-introduce the very letterbox `useArtRect`
			// exists to measure away.
			preserveAspectRatio="none"
			ref={svg}
			style={{...box, pointerEvents: live ? 'auto' : 'none'}}
			viewBox={`0 0 ${width} ${height}`}
		>
			{liveShapes(mask).map(shape => (
				<g
					data-op={shape.op}
					data-shape-id={shape.id}
					data-testid="mask-shape"
					key={shape.id}
				>
					<ShapeOutline
						className={classNames('mask-shape', shape.op, {
							selected: shape.id === selected
						})}
						path={shapePath(shape, width, height)}
					/>
					{/* Handles only on the picked shape: every vertex of every shape at once
					    is a field of dots with no way to tell which drag does what. */}
					{shape.id === selected &&
						shape.points.map((point, index) => (
							<circle
								className="mask-vertex"
								cx={point.x * width}
								cy={point.y * height}
								data-testid="mask-vertex"
								key={index}
								r={handleRadius}
							/>
						))}
				</g>
			))}
			{draft && (
				<g data-testid="mask-draft">
					<polyline
						className={classNames('mask-draft', op)}
						points={pointsAttr(
							draft.tool === 'polygon' && cursor
								? [...draft.points, cursor]
								: draft.points,
							width,
							height
						)}
						vectorEffect="non-scaling-stroke"
					/>
					{/* The target for the click that closes it. */}
					{draft.tool === 'polygon' && (
						<circle
							className="mask-vertex start"
							cx={draft.points[0].x * width}
							cy={draft.points[0].y * height}
							data-testid="mask-draft-start"
							r={handleRadius}
						/>
					)}
				</g>
			)}
		</svg>
	);
};
