import {AssetId, Frac2} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {AnchorOverlay} from '../../components/anchor';
import {useAssetUrl} from './asset-store-context';

export interface AssetPreviewProps {
	alt: string;
	assetId?: AssetId;
	className?: string;
	/** Draws the anchor cross on the art. Omit for assets that have no anchor. */
	origin?: Frac2;
	/** Another story's library. Set only by the Import tab; defaults to this story's. */
	scope?: string;
}

/** Shows an asset's bytes. Animated files play, because they were never transcoded. */
export const AssetPreview: React.FC<AssetPreviewProps> = props => {
	const {alt, assetId, className, origin, scope} = props;
	const box = React.useRef<HTMLSpanElement>(null);
	const art = React.useRef<HTMLImageElement>(null);
	const url = useAssetUrl(assetId, scope);

	return (
		<span className={classNames('asset-preview', className)} ref={box}>
			{url ? (
				<img alt={alt} ref={art} src={url} />
			) : (
				<span className="asset-preview-empty" />
			)}
			{url && origin && (
				<AnchorOverlay art={art} container={box} origin={origin} small />
			)}
		</span>
	);
};
