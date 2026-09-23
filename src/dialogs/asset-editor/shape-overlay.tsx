import {Frac2} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
// Straight from the file rather than the folder's barrel: the barrel also pulls in
// `anchor-select` and the preset list, and none of the overlay's business is with those.
import {useArtRect} from '../../components/anchor/use-art-rect';
import {
	FREEHAND_MIN_STEP,
	MaskToolId,
	RingShape,
	VERTEX_RADIUS,
	hitShape,
	hitVertex,
	newShapeId,
	roundPoint,
	shapePath,
	simplifyRing
} from './mask-shapes';

/**
 * Hand-drawn rings over the art: polygon, freehand, drag a corner. Factored out of the
 * mask overlay so the walk tool draws its floor with the same gestures, the same keys and
 * the same hit tests. What differs between the two — what a finished ring becomes, and
 * how it is painted — comes in through props.
 */
export interface ShapeOverlayProps<S extends RingShape> {
	/** The canvas the shapes belong to. Letterboxed; measured, never assumed. */
	art: React.RefObject<HTMLElement>;
	/** The positioned element the svg is drawn in. */
	container: React.RefObject<HTMLElement>;
	/** Image pixels, for the viewBox. */
	width: number;
	height: number;
	tool: MaskToolId;
	shapes: S[];
	/** The shape whose handles are shown and whose controls the pane is editing. */
	selected?: string;
	onSelect: (shapeId: string | undefined) => void;
	onChange: (shapes: S[]) => void;
	/** A finished ring, rounded, as the shape this overlay stores. */
	createShape: (points: Frac2[], id: string) => S;
	/** Taking gestures. False = drawn only, `pointer-events: none`. */
	live: boolean;
	/** Class and test id prefix: `mask` → `mask-overlay`, `mask-shape`, `mask-vertex` … */
	prefix: string;
	className?: string;
	/** Extra classes on one shape's outline, after `<prefix>-shape`. */
	shapeClass: (shape: S) => string;
	/** `data-*` attributes on one shape's group. */
	shapeData?: (shape: S) => Record<string, string | undefined>;
	/** Anything a shape draws besides its outline and handles. */
	renderShapeExtra?: (shape: S, selected: boolean) => React.ReactNode;
	/** Extra class on the ring being drawn, so it is already the colour it will be. */
	draftClass: string;
	/** Drawn under the shapes, in the same viewBox. */
	underlay?: React.ReactNode;
	/** Drawn over the shapes, in the same viewBox. */
	overlay?: React.ReactNode;
}

/** The shape being drawn right now: the one piece of shape state the overlay owns. */
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

function pointsAttr(points: Frac2[], width: number, height: number): string {
	return points.map(p => `${p.x * width},${p.y * height}`).join(' ');
}

/**
 * The hand-drawing surface: one `<svg>` laid over the art, in image coordinates.
 *
 * The viewBox does every conversion there is. Points are fractions of the image, the svg
 * is sized to the measured art rect, so a shape drawn at 1200px wide and re-opened in a
 * 300px dialog lands on the same pixels. The only hand conversion left is turning a
 * pointer's client coordinates back into a fraction.
 *
 * It holds no shape state. Every mutation leaves through `onChange`, so undo, dirty and
 * save all see the same single copy.
 */
export function ShapeOverlay<S extends RingShape>(
	props: ShapeOverlayProps<S>
): React.ReactElement {
	const {
		art,
		className,
		container,
		createShape,
		draftClass,
		height,
		live,
		onChange,
		onSelect,
		overlay,
		prefix,
		renderShapeExtra,
		selected,
		shapeClass,
		shapeData,
		shapes,
		tool,
		underlay,
		width
	} = props;
	const rect = useArtRect(art, container);
	const svg = React.useRef<SVGSVGElement>(null);
	const [draft, setDraft] = React.useState<Draft>();
	const [drag, setDrag] = React.useState<VertexDrag>();
	/** Where the pointer is, for the polygon's rubber band. Never leaves the component. */
	const [cursor, setCursor] = React.useState<Frac2>();
	/** The freehand step and the vertex radius are fractions of this. */
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

		// Two points are a line, and a line has no inside.
		if (points.length < 3) {
			return;
		}

		const shape = createShape(points.map(roundPoint), newShapeId(shapes));

		onChange([...shapes, shape]);
		// Pick it up straight away, so the pane's controls land on the shape that was just
		// drawn instead of on the next one.
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
		onChange(shapes.filter(shape => shape.id !== shapeId));

		if (selected === shapeId) {
			onSelect(undefined);
		}
	}

	function moveVertex(at: VertexDrag, point: Frac2) {
		onChange(
			shapes.map(shape =>
				shape.id === at.shapeId
					? {
							...shape,
							points: shape.points.map((existing, index) =>
								index === at.index ? point : existing
							)
					  }
					: shape
			)
		);
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
			const vertex = hitVertex(shapes, point, VERTEX_RADIUS);

			if (vertex) {
				event.currentTarget.setPointerCapture(event.pointerId);
				setDrag(vertex);
				onSelect(vertex.shapeId);
				return;
			}

			// A press on a shape picks it, a press on empty ground drops the selection.
			onSelect(hitShape(shapes, point));
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
	 * No dependency list: the handler closes over the draft, the shapes and the selection,
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

	// Measured on the tick after mount. Drawn but hidden until then, rather than stretched
	// over the whole container: the container includes the letterbox, and one frame of
	// shapes in the wrong place is worse than one frame of none.
	const box: React.CSSProperties = rect
		? {height: rect.height, left: rect.left, top: rect.top, width: rect.width}
		: {height: 0, left: 0, top: 0, visibility: 'hidden', width: 0};

	return (
		<svg
			className={classNames(
				'shape-overlay',
				`${prefix}-overlay`,
				`tool-${tool}`,
				className,
				{live}
			)}
			data-testid={`${prefix}-overlay`}
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
			{underlay}
			{shapes
				.filter(shape => shape.points.length >= 3)
				.map(shape => (
					<g
						{...Object.fromEntries(
							Object.entries(shapeData?.(shape) ?? {}).map(([key, value]) => [
								`data-${key}`,
								value
							])
						)}
						data-shape-id={shape.id}
						data-testid={`${prefix}-shape`}
						key={shape.id}
					>
						{/* A `d`, not a `points` list: `shapePath` closes the ring with
						    an explicit Z. `vectorEffect` keeps the stroke a constant
						    screen width whatever the image's own size. */}
						<path
							className={classNames(`${prefix}-shape`, shapeClass(shape), {
								selected: shape.id === selected
							})}
							d={shapePath(shape, width, height)}
							vectorEffect="non-scaling-stroke"
						/>
						{renderShapeExtra?.(shape, shape.id === selected)}
						{/* Handles only on the picked shape: every vertex of every shape
						    at once is a field of dots with no way to tell which drag does
						    what. */}
						{shape.id === selected &&
							shape.points.map((point, index) => (
								<circle
									className={`${prefix}-vertex`}
									cx={point.x * width}
									cy={point.y * height}
									data-testid={`${prefix}-vertex`}
									key={index}
									r={handleRadius}
								/>
							))}
					</g>
				))}
			{draft && (
				<g data-testid={`${prefix}-draft`}>
					<polyline
						className={classNames(`${prefix}-draft`, draftClass)}
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
							className={`${prefix}-vertex start`}
							cx={draft.points[0].x * width}
							cy={draft.points[0].y * height}
							data-testid={`${prefix}-draft-start`}
							r={handleRadius}
						/>
					)}
				</g>
			)}
			{overlay}
		</svg>
	);
}
