import {Frac2} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {ArtRect, useArtRect} from './use-art-rect';
import './anchor-marker.css';

export interface AnchorMarkerProps {
	/** Tooltip text. The cross is decorative, so it carries no other label. */
	label?: string;
	origin: Frac2;
	/** Where the art is inside the container. Percentages of the parent when absent. */
	rect?: ArtRect;
	/** Tile-sized: a shorter cross, for previews too small to draw a full one in. */
	small?: boolean;
}

function clamp(value: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/**
 * The cross that shows where an asset's anchor sits on its art.
 *
 * Everything anchor-shaped in the app draws this — asset editor, library tiles, character
 * tiles — in the same orange as the character editor's origin handle, so one anchor reads
 * the same wherever it turns up.
 */
export const AnchorMarker: React.FC<AnchorMarkerProps> = props => {
	const {label, origin, rect, small} = props;
	const x = clamp(origin.x);
	const y = clamp(origin.y);
	const style: React.CSSProperties = rect
		? {left: rect.left + x * rect.width, top: rect.top + y * rect.height}
		: {left: `${x * 100}%`, top: `${y * 100}%`};

	return (
		<span
			aria-hidden
			className={classNames('anchor-marker', {small})}
			data-testid="anchor-marker"
			data-x={x}
			data-y={y}
			style={style}
			title={label}
		/>
	);
};

export interface AnchorOverlayProps
	extends Omit<AnchorMarkerProps, 'rect'> {
	/** The image or canvas the anchor belongs to. */
	art: React.RefObject<HTMLElement>;
	/** The positioned element the marker is drawn in. */
	container: React.RefObject<HTMLElement>;
}

/** An anchor marker that follows its art as the art is letterboxed and resized. */
export const AnchorOverlay: React.FC<AnchorOverlayProps> = props => {
	const {art, container, ...markerProps} = props;
	const rect = useArtRect(art, container);

	return <AnchorMarker {...markerProps} rect={rect} />;
};
