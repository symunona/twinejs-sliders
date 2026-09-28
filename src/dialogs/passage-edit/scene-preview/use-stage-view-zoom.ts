import * as React from 'react';
import {steppedZoom} from '../../../store/stories';
import {Point} from '../../../util/geometry';

/**
 * The view zoom levels. 100% is the stage fitted to the panel, not the stage's own
 * pixels: the stage has no pixel size of its own, it letterboxes into whatever box
 * it is given.
 */
export const stageZoomSteps = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const minZoom = stageZoomSteps[0];
const maxZoom = stageZoomSteps[stageZoomSteps.length - 1];

/**
 * How far one pixel of wheel delta zooms. A mouse notch (~100px) is about 18%.
 */
const wheelSensitivity = 0.002;

interface Size {
	height: number;
	width: number;
}

/**
 * Zooms the VIEW of the stage -- how big it is drawn in the editor -- as opposed to
 * the scene's camera, which is what the reader sees and lives in the file.
 *
 * Zooming resizes the box the stage is drawn in rather than scaling it with a
 * transform. The renderer letterboxes into its host and the overlay measures
 * everything with client rects, so a bigger box is all either of them needs to
 * stay pixel-correct; a transform would put every hit test off by the scale.
 *
 * Ctrl/Cmd + wheel over the viewport zooms around the pointer, unless something
 * under it already took the wheel (the camera tool zooms the shot).
 *
 * @param viewport The scrolling element the stage sits in. State, not a ref: the
 * preview renders no stage at all until the passage has a scene.
 * @param enabled When false the view is held at 100%
 */
export function useStageViewZoom(
	viewport: HTMLElement | null,
	enabled: boolean
) {
	const [zoomState, setZoomState] = React.useState(1);
	const [size, setSize] = React.useState<Size>();
	const zoom = enabled ? zoomState : 1;
	const zoomRef = React.useRef(zoom);
	// Where to scroll once the stage is drawn at the new size.
	const pendingScroll = React.useRef<Point>();

	zoomRef.current = zoom;

	React.useLayoutEffect(() => {
		const element = viewport;

		if (!element) {
			return;
		}

		const measure = () =>
			setSize(size =>
				size?.width === element.clientWidth &&
				size?.height === element.clientHeight
					? size
					: {height: element.clientHeight, width: element.clientWidth}
			);

		measure();

		if (typeof ResizeObserver === 'undefined') {
			return;
		}

		const observer = new ResizeObserver(measure);

		observer.observe(element);

		return () => observer.disconnect();
	}, [viewport]);

	/**
	 * Zooms keeping the content under `focus` (a point in the viewport) where it is.
	 * The viewport's centre when there is no focus.
	 */
	const zoomTo = React.useCallback(
		(next: number, focus?: Point) => {
			const element = viewport;
			const from = zoomRef.current;
			const to = Math.min(Math.max(next, minZoom), maxZoom);

			if (!element || to === from) {
				return;
			}

			const at = focus ?? {
				left: element.clientWidth / 2,
				top: element.clientHeight / 2
			};
			const base = pendingScroll.current ?? {
				left: element.scrollLeft,
				top: element.scrollTop
			};

			pendingScroll.current = {
				left: ((base.left + at.left) / from) * to - at.left,
				top: ((base.top + at.top) / from) * to - at.top
			};
			zoomRef.current = to;
			setZoomState(to);
		},
		[viewport]
	);

	React.useLayoutEffect(() => {
		const element = viewport;

		if (element && pendingScroll.current) {
			element.scrollLeft = pendingScroll.current.left;
			element.scrollTop = pendingScroll.current.top;
		}

		pendingScroll.current = undefined;
	}, [size, viewport, zoom]);

	React.useEffect(() => {
		const element = viewport;

		if (!element || !enabled) {
			return;
		}

		// Unrounded, so slow trackpad deltas add up instead of rounding away.
		let gestureZoom: number | undefined;
		let gestureTimeout: number | undefined;

		function handleWheel(event: WheelEvent) {
			if ((!event.ctrlKey && !event.metaKey) || event.defaultPrevented) {
				return;
			}

			// Otherwise the browser zooms the whole page.
			event.preventDefault();

			const lines = event.deltaMode === 1 ? 16 : 1;
			const pages = event.deltaMode === 2 ? element!.clientHeight : 1;
			const from = gestureZoom ?? zoomRef.current;
			const bounds = element!.getBoundingClientRect();

			gestureZoom = Math.min(
				Math.max(
					from * Math.exp(-event.deltaY * lines * pages * wheelSensitivity),
					minZoom
				),
				maxZoom
			);
			zoomTo(Math.round(gestureZoom * 100) / 100, {
				left: event.clientX - bounds.left,
				top: event.clientY - bounds.top
			});
			window.clearTimeout(gestureTimeout);
			gestureTimeout = window.setTimeout(() => {
				gestureZoom = undefined;
			}, 150);
		}

		element.addEventListener('wheel', handleWheel, {passive: false});

		return () => {
			element.removeEventListener('wheel', handleWheel);
			window.clearTimeout(gestureTimeout);
		};
	}, [enabled, viewport, zoomTo]);

	const stepZoom = React.useCallback(
		(direction: 1 | -1) =>
			zoomTo(steppedZoom(zoomRef.current, direction, stageZoomSteps)),
		[zoomTo]
	);

	/**
	 * The stage's box at this zoom, or undefined at 100%, where it just fills the
	 * viewport.
	 */
	const canvasStyle: React.CSSProperties | undefined =
		zoom === 1 || !size
			? undefined
			: {
					flex: 'none',
					height: Math.round(size.height * zoom),
					margin: 'auto',
					width: Math.round(size.width * zoom)
			  };

	return {
		canvasStyle,
		maxZoom,
		minZoom,
		resetZoom: () => zoomTo(1),
		stepZoom,
		zoom
	};
}
