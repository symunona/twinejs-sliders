import {useTranslation} from 'react-i18next';
import {useCommand} from '../../hotkeys';
import {
	steppedZoom,
	Story,
	updateStory,
	useStoriesContext
} from '../../store/stories';

/**
 * Registers the zoom commands for the story map. The keys they're bound to are
 * set in `src/hotkeys/default-keymap.ts`.
 */
export function useZoomShortcuts(story: Story) {
	const {dispatch, stories} = useStoriesContext();
	const {t} = useTranslation();

	function setZoom(zoom: number) {
		if (zoom !== story.zoom) {
			dispatch(updateStory(stories, story, {zoom}));
		}
	}

	useCommand({
		id: 'view.zoomOut',
		label: t('hotkeys.commands.view.zoomOut'),
		run: () => setZoom(steppedZoom(story.zoom, -1)),
		scope: 'story-map'
	});
	useCommand({
		id: 'view.zoomIn',
		label: t('hotkeys.commands.view.zoomIn'),
		run: () => setZoom(steppedZoom(story.zoom, 1)),
		scope: 'story-map'
	});
	useCommand({
		id: 'view.zoomReset',
		label: t('hotkeys.commands.view.zoomReset'),
		run: () => setZoom(1),
		scope: 'story-map'
	});
}
