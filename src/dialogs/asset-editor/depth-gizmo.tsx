import {characterMetrics, STAGE_ASPECT} from '@sliders/render-dom';
import {AssetId, Character, WalkDepth} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ArtRect} from '../../components/anchor/use-art-rect';
import {stepImage} from './walk-ghost';

/** A depth scale an author can reach by dragging a chip. Past these nothing reads. */
export const DEPTH_SCALE_RANGE = {max: 4, min: 0.05};

/** Pixels of horizontal chip drag per 0.01 of scale. */
const CHIP_PX_PER_STEP = 2;

export function clampDepthScale(value: number): number {
	const clamped = Math.min(
		DEPTH_SCALE_RANGE.max,
		Math.max(DEPTH_SCALE_RANGE.min, Number.isFinite(value) ? value : 1)
	);

	return Math.round(clamped * 100) / 100;
}

type Line = 'far' | 'near';

interface Drag {
	line: Line;
	what: 'y' | 'scale';
	startX: number;
	startScale: number;
}

export interface DepthGizmoProps {
	rect: ArtRect;
	/** The positioned element `rect` is measured in. */
	container: React.RefObject<HTMLElement>;
	/** In SOURCE fractions, like everything else the editor draws. */
	depth: WalkDepth;
	onChange: (depth: WalkDepth) => void;
	/** The stage's height as a fraction of the art's, for the silhouettes' size. */
	stageHeight: number;
	/** Whose silhouette stands on each line. Absent: a plain figure. */
	character?: Character;
	urls: Record<AssetId, string>;
	disabled?: boolean;
}

/**
 * Two horizontal lines across the art: far and near. Drag a line to move it, drag its
 * `×scale` chip sideways to change how big a character is standing on it. A silhouette at
 * each line's left end is that size, so the numbers can be judged against a door frame
 * without reading them.
 */
export const DepthGizmo: React.FC<DepthGizmoProps> = props => {
	const {character, depth, disabled, onChange, rect, stageHeight, urls} = props;
	const {t} = useTranslation();
	const [drag, setDrag] = React.useState<Drag>();

	function start(event: React.PointerEvent, line: Line, what: Drag['what']) {
		if (disabled || event.button !== 0) {
			return;
		}

		// Its own gesture: the shape overlay underneath must not also start a polygon, and
		// the canvas must not start a crop.
		event.stopPropagation();
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		setDrag({line, startScale: depth[line].scale, startX: event.clientX, what});
	}

	function move(event: React.PointerEvent) {
		if (!drag) {
			return;
		}

		event.stopPropagation();

		if (drag.what === 'y') {
			// Against the container the art rect is measured in, never the line itself,
			// which moves under the pointer as it is dragged.
			const box = props.container.current?.getBoundingClientRect();
			const y =
				(event.clientY - (box?.top ?? 0) - rect.top) / (rect.height || 1);

			onChange({
				...depth,
				[drag.line]: {
					...depth[drag.line],
					y: Math.round(Math.min(1.5, Math.max(-0.5, y)) * 1000) / 1000
				}
			});
			return;
		}

		const steps = (event.clientX - drag.startX) / CHIP_PX_PER_STEP;

		onChange({
			...depth,
			[drag.line]: {
				...depth[drag.line],
				scale: clampDepthScale(drag.startScale + steps * 0.01)
			}
		});
	}

	function end(event: React.PointerEvent) {
		if (drag) {
			event.stopPropagation();
			setDrag(undefined);
		}
	}

	const stagePx = stageHeight * rect.height;
	const cover = character
		? stepImage(character, 'idle') ??
		  stepImage(character, Object.keys(character.poses ?? {})[0])
		: undefined;
	const url = cover ? urls[cover] : undefined;

	return (
		<>
			{(['far', 'near'] as Line[]).map(line => {
				const {scale, y} = depth[line];
				const top = rect.top + y * rect.height;
				const metrics = characterMetrics(
					{height: stagePx, left: 0, top: 0, width: stagePx * STAGE_ASPECT},
					character ?? {origin: {x: 0.5, y: 1}, size: {h: 1024, w: 400}},
					scale
				);
				const handlers = {
					onPointerCancel: end,
					onPointerMove: move,
					onPointerUp: end
				};

				return (
					<div
						className={classNames('depth-line', line, {
							dragging: drag?.line === line
						})}
						data-testid={`depth-line-${line}`}
						key={line}
						style={{left: rect.left, top, width: rect.width}}
					>
						<div
							aria-label={t(`dialogs.assetEditor.walk.depthLine.${line}`)}
							className="depth-line-grip"
							onPointerDown={event => start(event, line, 'y')}
							role="slider"
							aria-valuenow={y}
							{...handlers}
						/>
						<div
							className="depth-silhouette"
							style={{height: metrics.height, width: metrics.width}}
						>
							{url ? <img alt="" draggable={false} src={url} /> : null}
						</div>
						<span
							aria-label={t('dialogs.assetEditor.walk.depthChip', {
								line: t(`dialogs.assetEditor.walk.depthLine.${line}`),
								scale: scale.toFixed(2)
							})}
							className="depth-chip"
							data-testid={`depth-chip-${line}`}
							onPointerDown={event => start(event, line, 'scale')}
							role="slider"
							aria-valuenow={scale}
							{...handlers}
						>
							{t(`dialogs.assetEditor.walk.depthLine.${line}`)} y {y.toFixed(2)} ×
							{scale.toFixed(2)}
						</span>
					</div>
				);
			})}
		</>
	);
};
