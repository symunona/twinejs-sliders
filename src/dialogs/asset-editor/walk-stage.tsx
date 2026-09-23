import {Frac2, WalkArea, WalkShape} from '@sliders/scene-types';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useArtRect} from '../../components/anchor/use-art-rect';
import {STAGE_ASPECT} from '@sliders/render-dom';
import {DepthGizmo} from './depth-gizmo';
import {shapePath} from './mask-shapes';
import {ShapeOverlay} from './shape-overlay';
import {WalkEditor} from './use-walk-editor';
import {WalkGhost} from './walk-ghost';
import {stageHeightOfSource, WalkFrame} from './walk-shapes';

export interface WalkStageProps {
	art: React.RefObject<HTMLElement>;
	container: React.RefObject<HTMLElement>;
	/** Source pixels, for the viewBox. */
	width: number;
	height: number;
	/** SOURCE fractions. */
	walk: WalkArea;
	onChange: (walk: WalkArea) => void;
	editor: WalkEditor;
	frame: WalkFrame;
	disabled?: boolean;
}

function points(list: Frac2[], width: number, height: number): string {
	return list.map(p => `${p.x * width},${p.y * height}`).join(' ');
}

/**
 * Everything the walk tool draws over the art: the floor and its holes (the shared shape
 * overlay), the depth lines, the ghost, and the last walk-here's path.
 *
 * One pointer, four claimants. Drawing is the overlay's unless walk-here is on; the ghost
 * and the depth handles take their own presses and stop them there; walk-here lays a
 * catch-all sheet over the art that turns any click into a walk.
 */
export const WalkStage: React.FC<WalkStageProps> = props => {
	const {container, disabled, editor, frame, height, onChange, walk, width} = props;
	const {t} = useTranslation();
	const rect = useArtRect(props.art, container);
	const [dragging, setDragging] = React.useState(false);
	const stageHeight = stageHeightOfSource(frame, STAGE_ASPECT);

	const fracFrom = React.useCallback(
		(event: {clientX: number; clientY: number}): Frac2 | undefined => {
			const box = container.current?.getBoundingClientRect();

			if (!box || !rect || !rect.width || !rect.height) {
				return undefined;
			}

			return {
				x: (event.clientX - box.left - rect.left) / rect.width,
				y: (event.clientY - box.top - rect.top) / rect.height
			};
		},
		[container, rect]
	);

	// The ghost drag follows the pointer anywhere in the window and ends wherever it is
	// released, so it is on the window, not on the sprite that moves out from under it.
	React.useEffect(() => {
		if (!dragging) {
			return;
		}

		function move(event: PointerEvent) {
			const at = fracFrom(event);

			if (at) {
				editor.setGhostAt({
					x: Math.round(at.x * 1000) / 1000,
					y: Math.round(at.y * 1000) / 1000
				});
			}
		}

		function up() {
			setDragging(false);
			editor.dropGhost();
		}

		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);

		return () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
	});

	const walkRings = walk.shapes.filter(
		shape => shape.op === 'walk' && shape.points.length >= 3
	);
	/** Everything but the floor, dimmed: the picture's rect with each floor ring cut out. */
	const outside = [
		`M0 0 H${width} V${height} H0 Z`,
		...walkRings.map(shape => shapePath(shape, width, height))
	].join(' ');
	const path = editor.path;
	const last = path?.points[path.points.length - 1];

	return (
		<>
			<ShapeOverlay<WalkShape>
				art={props.art}
				container={container}
				createShape={(ring, id) => ({id, op: editor.op, points: ring})}
				draftClass={editor.op}
				height={height}
				live={!disabled && !editor.walkHere}
				onChange={shapes => onChange({...walk, shapes})}
				onSelect={editor.setSelected}
				overlay={
					path && (
						<g data-testid="walk-path">
							<polyline
								className="walk-path"
								points={points(path.points, width, height)}
								vectorEffect="non-scaling-stroke"
							/>
							{last &&
								(!path.reached ||
									Math.hypot(last.x - path.click.x, last.y - path.click.y) >
										0.004) && (
									<polyline
										className="walk-path-miss"
										data-testid="walk-path-miss"
										points={points([last, path.click], width, height)}
										vectorEffect="non-scaling-stroke"
									/>
								)}
						</g>
					)
				}
				prefix="walk"
				selected={editor.selected}
				shapeClass={shape => shape.op}
				shapeData={shape => ({op: shape.op})}
				shapes={walk.shapes}
				tool={editor.tool}
				underlay={
					<>
						<defs>
							<pattern
								height={8}
								id="walk-block-hatch"
								patternTransform="rotate(45)"
								patternUnits="userSpaceOnUse"
								width={8}
							>
								<line className="walk-hatch" x1={0} x2={0} y1={0} y2={8} />
							</pattern>
						</defs>
						{walkRings.length > 0 && (
							<path className="walk-outside" d={outside} fillRule="evenodd" />
						)}
					</>
				}
				width={width}
			/>
			{rect && walk.depth && (
				<DepthGizmo
					character={editor.ghost}
					container={container}
					depth={walk.depth}
					disabled={disabled || editor.walkHere}
					onChange={depth => onChange({...walk, depth})}
					rect={rect}
					stageHeight={stageHeight}
					urls={editor.urls}
				/>
			)}
			{rect && editor.walkHere && (
				<div
					aria-label={t('dialogs.assetEditor.walk.walkHereSheet')}
					className="walk-here-sheet"
					data-testid="walk-here-sheet"
					onPointerDown={event => {
						// A walk is a click, not the start of a crop or a polygon.
						event.stopPropagation();

						if (disabled || event.button !== 0) {
							return;
						}

						const at = fracFrom(event);

						if (at) {
							editor.walkTo(at);
						}
					}}
					style={{
						height: rect.height,
						left: rect.left,
						top: rect.top,
						width: rect.width
					}}
				/>
			)}
			{rect && (
				<WalkGhost
					at={editor.ghostAt}
					character={editor.ghost}
					flip={editor.ghostFlip}
					invalid={editor.ghostOff}
					onPointerDown={
						disabled
							? undefined
							: event => {
									if (event.button !== 0) {
										return;
									}

									event.stopPropagation();
									event.preventDefault();
									editor.endWalk();
									setDragging(true);
							  }
					}
					onWalkEnd={editor.endWalk}
					pose={editor.ghostPose}
					rect={rect}
					scale={editor.ghostScale}
					stageHeight={stageHeight}
					urls={editor.urls}
					walk={editor.walking}
				/>
			)}
		</>
	);
};
