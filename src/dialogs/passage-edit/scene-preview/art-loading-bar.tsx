import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useArtLoading} from '../../../store/asset-library/library-provider';
import {useAssetScope} from '../../sliders-assets/asset-store-context';
import './art-loading-bar.css';

/**
 * Over the stage while the story's art is still on its way down. A story just pulled
 * from a link has every record but no bytes yet, so the stage draws placeholders until
 * then; this says why, and how far along it is.
 */
export const ArtLoadingBar: React.FC = () => {
	const {t} = useTranslation();
	const progress = useArtLoading(useAssetScope());

	if (!progress) {
		return null;
	}

	return (
		<div
			className="art-loading-bar"
			data-testid="art-loading-bar"
			role="status"
		>
			<span>
				{t('dialogs.passageEdit.scenePreview.loadingArt', {
					done: progress.done,
					total: progress.total
				})}
			</span>
			<progress max={progress.total} value={progress.done} />
		</div>
	);
};
