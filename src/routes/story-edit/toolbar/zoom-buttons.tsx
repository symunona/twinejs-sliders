import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconZoomIn, IconZoomOut} from '@tabler/icons';
import {IconButton} from '../../../components/control/icon-button';
import {
	maxZoom,
	minZoom,
	steppedZoom,
	updateStory,
	useStoriesContext,
	Story
} from '../../../store/stories';
import './zoom-buttons.css';

export interface ZoomButtonsProps {
	story: Story;
}

export const ZoomButtons: React.FC<ZoomButtonsProps> = React.memo(({story}) => {
	const {dispatch, stories} = useStoriesContext();
	const {t} = useTranslation();

	const handleZoomChange = React.useCallback(
		(zoom: number) => {
			if (zoom !== story.zoom) {
				dispatch(updateStory(stories, story, {zoom}));
			}
		},
		[dispatch, stories, story]
	);

	return (
		<div className="zoom-buttons">
			<span className="legend">{t('routes.storyEdit.zoomButtons.legend')}</span>
			<IconButton
				disabled={story.zoom <= minZoom}
				icon={<IconZoomOut />}
				iconOnly
				label={t('routes.storyEdit.zoomButtons.zoomOut')}
				onClick={() => handleZoomChange(steppedZoom(story.zoom, -1))}
			/>
			<button
				className="zoom-percent"
				onClick={() => handleZoomChange(1)}
				title={t('routes.storyEdit.zoomButtons.zoomReset')}
			>
				{Math.round(story.zoom * 100)}%
			</button>
			<IconButton
				disabled={story.zoom >= maxZoom}
				icon={<IconZoomIn />}
				iconOnly
				label={t('routes.storyEdit.zoomButtons.zoomIn')}
				onClick={() => handleZoomChange(steppedZoom(story.zoom, 1))}
			/>
		</div>
	);
});

ZoomButtons.displayName = 'ZoomButtons';
