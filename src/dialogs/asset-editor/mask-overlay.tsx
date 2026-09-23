import {AssetMask, Frac2, MaskOp, MaskShape} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {MaskMode, MaskToolId, drawnInverted} from './mask-shapes';
import {ShapeOverlay} from './shape-overlay';

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

/**
 * The mask's drawing surface: `ShapeOverlay` with mask shapes in it, over the source image.
 *
 * Only live in the two transparency previews. The stage is shared with the crop drag and
 * the one-shot anchor pick, both of which start on the canvas underneath; a live sheet
 * over the art would swallow both, so `rendered` draws nothing at all and `disabled`
 * takes no gestures.
 */
export const MaskOverlay: React.FC<MaskOverlayProps> = props => {
	const {feather, mask, mode, onChange, op} = props;

	if (mode === 'rendered') {
		return null;
	}

	return (
		<ShapeOverlay<MaskShape>
			art={props.art}
			className={`mode-${mode}`}
			container={props.container}
			createShape={(points: Frac2[], id: string) => {
				// Which way round the gesture went is the only place `invert` is ever decided
				// from geometry. After this it is a stored flag the pane owns, so dragging a
				// vertex back across the shape does not turn the mask inside out.
				const invert = drawnInverted(points);

				return {feather, id, op, points, ...(invert ? {invert: true} : {})};
			}}
			draftClass={op}
			height={props.height}
			live={!props.disabled}
			onChange={shapes => onChange({shapes})}
			onSelect={props.onSelect}
			prefix="mask"
			renderShapeExtra={(shape, selected) =>
				// An inverted shape acts on the band between its ring and the edge of the
				// picture, and a lone outline says nothing about which of the two sides that
				// is. Drawing the far edge as well makes the band a band.
				shape.invert && (
					<rect
						className={classNames('mask-shape', 'frame', shape.op, {selected})}
						data-testid="mask-invert-frame"
						height={props.height}
						vectorEffect="non-scaling-stroke"
						width={props.width}
						x={0}
						y={0}
					/>
				)
			}
			selected={props.selected}
			shapeClass={shape => classNames(shape.op, {invert: shape.invert})}
			shapeData={shape => ({
				invert: shape.invert ? 'true' : undefined,
				op: shape.op
			})}
			shapes={mask.shapes}
			tool={props.tool}
			width={props.width}
		/>
	);
};
