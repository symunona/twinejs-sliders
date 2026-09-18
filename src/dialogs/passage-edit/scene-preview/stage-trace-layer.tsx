/**
 * The measuring overlay: what the grid draws on top of the stage besides lines.
 *
 * Three jobs, all of them read-only until the last one:
 *
 *  1. Every entity gets a bounding box and its origin cross, not just the selected one. The
 *     grid is a ruler, and a ruler that only measures the thing you already have hold of is
 *     no use for lining two characters up against each other.
 *  2. Anything that has moved since the scene opened gets dashed ghosts of where it was —
 *     `orig` (the `cast:` block) and `prev` (whatever the beat before left behind).
 *  3. For the SELECTED entity those ghosts get a panel of numbers, and each row of numbers
 *     is a button that puts the entity back there.
 *
 * Ghost outlines are drawn for every moved entity but the numbers only for the selection:
 * three rows of coordinates per character is a readable panel; four characters' worth is a
 * wall of digits over the scene it is describing.
 *
 * Split out of `stage-editor-overlay` because none of it touches a pointer gesture — it is
 * a pure function of the traces, and the overlay is already the longest file here.
 */

import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {Rect} from '@sliders/render-dom';
import type {EntityId, Vec2} from '@sliders/scene-types';
import {roundCoord} from './stage-geometry';
import {hasGhosts} from './stage-history';
import type {EntityTrace, TraceKind, TracePoint} from './stage-history';
import './stage-trace-layer.css';

/** One row of numbers, in MOUNT px. Enough to estimate the panel before it is laid out. */
const ROW_HEIGHT_PX = 21;

/** Gap between the sprite rect and the panel pinned to it, in MOUNT px. */
const PANEL_GAP_PX = 8;

/**
 * Where the numbers go: above the sprite if they fit, below if they do not, and CLAMPED
 * into the stage either way.
 *
 * The clamp is the part that matters. A character stands on the floor, so its rect reaches
 * the bottom of the stage and "below" is off the edge — which is exactly the case the
 * gesture readout never hits, because it is pinned to a sprite the pointer is holding
 * somewhere in the middle of the frame. Without the clamp the panel is drawn under the beat
 * toolbar and the author sees the top two pixels of it.
 */
function panelTop(rect: Rect, rows: number, bounds?: Rect): number {
	const height = rows * ROW_HEIGHT_PX + 2;
	const above = rect.top - PANEL_GAP_PX - height;
	const top = above >= (bounds?.top ?? 0) ? above : rect.top + rect.height + PANEL_GAP_PX;

	if (!bounds) {
		return Math.max(0, top);
	}

	return Math.min(
		Math.max(bounds.top, top),
		Math.max(bounds.top, bounds.top + bounds.height - height)
	);
}

/** A past position the pointer is resting on, for the stage to draw a copy of the art at. */
export interface TracePreview {
	id: EntityId;
	at: Vec2;
	scale: number;
}

export interface StageTraceLayerProps {
	traces: EntityTrace[];
	selection: EntityId[];
	/** The letterboxed stage box in MOUNT px. The numbers panel is kept inside it. */
	bounds?: Rect;
	/** Absent = the numbers are not clickable. See `StageEditorOverlayProps.onJumpTo`. */
	onJumpTo?: (id: EntityId, at: Vec2, scale: number) => void;
	/**
	 * A row is under the pointer, so the stage may fill that ghost box in with the real
	 * art. `null` on leave. Absent = no preview, which is what an unclickable panel gets:
	 * a row that cannot move the entity has no business showing what moving it would look
	 * like.
	 */
	onPreview?: (preview: TracePreview | null) => void;
	/**
	 * What clicking a row will do beyond moving the entity — today: splice a new beat in,
	 * because the scrubber is parked on a beat this entity has no line in. Replaces the
	 * row's own tooltip, since it is the more surprising half of the answer.
	 */
	beatNote?: string;
	/** A gesture is running: the gesture's own readout owns the numbers for its duration. */
	quiet?: boolean;
}

/** `x 0.3 y -0.82` — the coordinate as it is written in the YAML. */
function sceneText(at: Vec2): string {
	return `x ${roundCoord(at.x)} y ${roundCoord(at.y)}`;
}

const TraceRow: React.FC<{
	beatNote?: string;
	id: EntityId;
	label: string;
	onHover?: (point: TracePoint | null) => void;
	onJumpTo?: (id: EntityId, at: Vec2, scale: number) => void;
	point: TracePoint;
}> = ({beatNote, id, label, onHover, onJumpTo, point}) => {
	const {t} = useTranslation();
	const numbers = (
		<>
			<span className="stage-editor-trace-swatch" />
			<span className="stage-editor-trace-when">{label}</span>
			<span className="stage-editor-trace-at">{sceneText(point.at)}</span>
			{/* Design pixels, not screen pixels — see `DESIGN_WIDTH`. Bracketed so the two
			    coordinate systems cannot be read as one six-number row. */}
			<span className="stage-editor-trace-pixel">
				[{point.pixel.x}, {point.pixel.y}]
			</span>
			{roundCoord(point.scale) !== 1 && (
				<span className="stage-editor-trace-scale">
					&times;{roundCoord(point.scale)}
				</span>
			)}
		</>
	);
	const className = classNames('stage-editor-trace-row', point.kind);

	if (point.kind === 'now' || !onJumpTo) {
		return (
			<span
				className={className}
				data-kind={point.kind}
				title={point.kind === 'now' ? undefined : beatNote}
			>
				{numbers}
			</span>
		);
	}

	return (
		<button
			className={className}
			data-kind={point.kind}
			data-testid={`stage-editor-trace-${point.kind}`}
			onBlur={() => onHover?.(null)}
			onClick={() => onJumpTo(id, point.at, point.scale)}
			onFocus={() => onHover?.(point)}
			onPointerEnter={() => onHover?.(point)}
			onPointerLeave={() => onHover?.(null)}
			title={
				beatNote ??
				t('dialogs.passageEdit.scenePreview.traceRestore', {when: label})
			}
			type="button"
		>
			{numbers}
		</button>
	);
};

export const StageTraceLayer: React.FC<StageTraceLayerProps> = ({
	beatNote,
	bounds,
	onJumpTo,
	onPreview,
	quiet,
	selection,
	traces
}) => {
	const {t} = useTranslation();
	const selected = React.useMemo(() => new Set(selection), [selection]);
	/** Which ghost box to thicken. The stage draws the art; this draws the frame round it. */
	const [hovered, setHovered] = React.useState<{
		id: EntityId;
		kind: TraceKind;
	} | null>(null);
	// Through a ref because the clear-up below must not re-run when the parent re-renders
	// with a fresh callback — it would clear a preview the pointer is still resting on.
	const previewRef = React.useRef(onPreview);

	previewRef.current = onPreview;

	const handleHover = React.useCallback(
		(id: EntityId, point: TracePoint | null) => {
			setHovered(point ? {id, kind: point.kind} : null);
			previewRef.current?.(
				point ? {at: point.at, id, scale: point.scale} : null
			);
		},
		[]
	);

	/**
	 * A row that is taken off screen never gets its own `pointerleave`, and the panel goes
	 * whenever a gesture starts or the selection changes. Without this the art stays drawn
	 * at a position nothing on screen is still pointing at.
	 */
	React.useEffect(() => {
		if (quiet) {
			setHovered(null);
			previewRef.current?.(null);
		}
	}, [quiet]);

	// Unmount only. No `setHovered` here: the state is going with the component, and setting
	// it on the way out is the classic "update on an unmounted component" warning.
	React.useEffect(() => () => previewRef.current?.(null), []);

	return (
		<>
			{traces.map(trace => {
				const isSelected = selected.has(trace.id);
				const ghosts = [trace.orig, trace.prev].filter(
					(point): point is TracePoint => !!point
				);
				return (
					<React.Fragment key={trace.id}>
						{/* The selected entity already wears `.stage-editor-selection`; a
						    second box on the same four pixels is just a thicker line. */}
						{!isSelected && (
							<div
								className="stage-editor-outline"
								data-entity-id={trace.id}
								style={{
									height: trace.now.rect.height,
									left: trace.now.rect.left,
									top: trace.now.rect.top,
									width: trace.now.rect.width
								}}
							/>
						)}
						{!isSelected && (
							<div
								className="stage-editor-origin"
								style={{left: trace.now.origin.x, top: trace.now.origin.y}}
							/>
						)}
						{ghosts.map(point => (
							<React.Fragment key={point.kind}>
								<div
									className={classNames(
										'stage-editor-ghost',
										point.kind,
										{
											hovered:
												hovered?.id === trace.id &&
												hovered.kind === point.kind
										}
									)}
									data-kind={point.kind}
									data-testid={`stage-editor-ghost-${point.kind}`}
									style={{
										height: point.rect.height,
										left: point.rect.left,
										top: point.rect.top,
										width: point.rect.width
									}}
								/>
								{/* The ghost's own origin, so a move that only changed the
								    anchor still has something to point at. */}
								<div
									className={`stage-editor-ghost-origin ${point.kind}`}
									style={{left: point.origin.x, top: point.origin.y}}
								/>
							</React.Fragment>
						))}
						{isSelected && hasGhosts(trace) && !quiet && (
							<div
								className="stage-editor-trace-readout"
								data-testid="stage-editor-trace-readout"
								style={{
									left: Math.max(bounds?.left ?? 0, trace.now.rect.left),
									top: panelTop(trace.now.rect, ghosts.length + 1, bounds)
								}}
							>
								{trace.orig && (
									<TraceRow
										beatNote={beatNote}
										id={trace.id}
										label={t('dialogs.passageEdit.scenePreview.traceOrig')}
										onHover={point => handleHover(trace.id, point)}
										onJumpTo={onJumpTo}
										point={trace.orig}
									/>
								)}
								{trace.prev && (
									<TraceRow
										beatNote={beatNote}
										id={trace.id}
										label={t('dialogs.passageEdit.scenePreview.tracePrev')}
										onHover={point => handleHover(trace.id, point)}
										onJumpTo={onJumpTo}
										point={trace.prev}
									/>
								)}
								<TraceRow
									id={trace.id}
									label={t('dialogs.passageEdit.scenePreview.traceNow')}
									point={trace.now}
								/>
							</div>
						)}
					</React.Fragment>
				);
			})}
		</>
	);
};
