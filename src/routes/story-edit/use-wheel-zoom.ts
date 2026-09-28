import * as React from 'react';
import {
	clampZoom,
	Story,
	updateStory,
	useStoriesContext
} from '../../store/stories';
import {Point} from '../../util/geometry';

/**
 * How far one pixel of wheel delta zooms. A mouse notch (~100px) is about 18%.
 */
const wheelSensitivity = 0.002;

/**
 * How long the wheel has to rest before the zoom is saved to the story. Saving
 * on every wheel event would write the story dozens of times a gesture.
 */
const commitDelay = 150;

/**
 * Ctrl- or Cmd-wheel zooms the story map around the pointer. A trackpad pinch
 * arrives as a ctrl-wheel too. A plain wheel still scrolls.
 */
export function useWheelZoom(
	story: Story,
	container: React.RefObject<HTMLElement>,
	visibleZoom: number,
	jump: (zoom: number, focus: Point) => void
) {
	const {dispatch, stories} = useStoriesContext();
	const commit = React.useCallback(
		(zoom: number) => {
			if (zoom !== story.zoom) {
				dispatch(updateStory(stories, story, {zoom}));
			}
		},
		[dispatch, stories, story]
	);
	// The listener is attached once; these carry what it needs from the latest
	// render.
	const latest = React.useRef({commit, jump, visibleZoom});

	latest.current = {commit, jump, visibleZoom};

	React.useEffect(() => {
		const element = container.current;

		if (!element) {
			return;
		}

		// Unrounded, so slow trackpad deltas add up instead of rounding away.
		let gestureZoom: number | undefined;
		let commitTimeout: number | undefined;

		function handleWheel(event: WheelEvent) {
			if (!event.ctrlKey && !event.metaKey) {
				return;
			}

			// Otherwise the browser zooms the whole page.
			event.preventDefault();

			const lines = event.deltaMode === 1 ? 16 : 1;
			const pages = event.deltaMode === 2 ? element!.clientHeight : 1;
			const delta = event.deltaY * lines * pages;
			const from = gestureZoom ?? latest.current.visibleZoom;

			gestureZoom = clampZoom(from * Math.exp(-delta * wheelSensitivity));

			const zoom = Math.round(gestureZoom * 100) / 100;

			if (zoom === latest.current.visibleZoom) {
				return;
			}

			const bounds = element!.getBoundingClientRect();

			latest.current.jump(zoom, {
				left: event.clientX - bounds.left,
				top: event.clientY - bounds.top
			});
			window.clearTimeout(commitTimeout);
			commitTimeout = window.setTimeout(() => {
				gestureZoom = undefined;
				latest.current.commit(zoom);
			}, commitDelay);
		}

		element.addEventListener('wheel', handleWheel, {passive: false});

		return () => {
			element.removeEventListener('wheel', handleWheel);
			window.clearTimeout(commitTimeout);
		};
	}, [container]);
}
