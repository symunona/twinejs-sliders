import {AssetId} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {useAssetUrl} from './asset-store-context';

export interface AssetPreviewProps {
	alt: string;
	assetId?: AssetId;
	className?: string;
}

/** Shows an asset's bytes. Animated files play, because they were never transcoded. */
export const AssetPreview: React.FC<AssetPreviewProps> = props => {
	const {alt, assetId, className} = props;
	const url = useAssetUrl(assetId);

	return (
		<span className={classNames('asset-preview', className)}>
			{url ? <img alt={alt} src={url} /> : <span className="asset-preview-empty" />}
		</span>
	);
};
