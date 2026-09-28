import * as React from 'react';
import {quadOut} from 'eases';
import {Point} from '../../util/geometry';

/**
 * Information about a single zoom transition.
 */
interface ZoomTransition {
	/**
	 * How much time has elapsed, in seconds.
	 */
	elapsed: number;
	/**
	 * The last timestamp an update was done, in seconds.
	 */
	lastTimestamp?: number;
	/**
	 * The point the scrollTarget was centered on when the transition began,
	 * normalized for zoom level. e.g. if it was centered on (100, 100) but the
	 * story zoom was 0.5, this is (200, 200).
	 */
	scrollNormalizedCenter: Point;
	/**
	 * The current point the scrollTarget is centered on.
	 */
	scrollCenter: {
		height: number;
		width: number;
	};
	/**
	 * The element whose scroll position is being maintained.
	 */
	scrollTarget: HTMLElement;
	/**
	 * How the zoom is changing during this transition.
	 */
	zoom: {
		start: number;
		change: number;
	};
}

/**
 * Runs a single step of the zoom transition. This is outside the effect to
 * avoid dependencies.
 * @param setter Setter function for the zoom value
 * @param start Value of the zoom when the transition began
 * @param change Change in zoom value for the entire transition
 * @param time Elapsed time in seconds--assumes total time is 1 second
 * 
 * @return transitioned value of zoom
 */
function transitionStep(
	setter: React.Dispatch<React.SetStateAction<number>>,
	start: number,
	change: number,
	time: number
) {
	let value: number;

	if (time < 1) {
		// Step toward the change.

		value = start + change * quadOut(time);
		setter(value);
		return value;
	}

	// We're done.

	setter(start + change);
}

/**
 * Manages transitioning zoom level of a story while maintaining the scroll
 * position's focus. This is meant to be called repeatedly with different
 * values, and returns the _visible_ zoom--what the user should see as zoom
 * value, which gradually changes over time.
 *
 * @param target Zoom value to transition towrds
 * @param scrollTarget DOM element whose scroll position should be manipulated
 * to match the returned value
 * @return the visible zoom, and `jump` to show a zoom immediately
 */
export function useZoomTransition(
	target: number,
	scrollTarget: HTMLElement | null
) {
	const [current, setCurrent] = React.useState(target);
	const transition = React.useRef<ZoomTransition>();
	const currentRef = React.useRef(current);
	// A zoom set by `jump` that the story hasn't caught up to yet. Until it has,
	// the gap between `target` and `current` is not a transition to run.
	const jumpedTo = React.useRef<number>();
	// Where to scroll once the DOM is drawn at the jumped-to zoom.
	const pendingScroll = React.useRef<Point>();

	currentRef.current = current;

	// This queues a single transition step using requestAnimationFrame. It's
	// crucial that this callback have no dependencies; otherwise things could get
	// confused in the middle of a transition.

	const step = React.useCallback(() => {
		if (!transition.current) {
			return;
		}

		window.requestAnimationFrame(timestamp => {
			const t = transition.current;

			// A jump cancelled the transition since this frame was queued.

			if (!t) {
				return;
			}

			if (t.lastTimestamp) {
				// Complete the transition in 0.5 seconds, not 1.
				t.elapsed += (timestamp - t.lastTimestamp) / 500;
				t.lastTimestamp = timestamp;

				const value = transitionStep(
					setCurrent,
					t.zoom.start,
					t.zoom.change,
					t.elapsed
				);

				if (value) {
					// Sync scroll position and request a new animation step.

					const newLeft =
						t.scrollNormalizedCenter.left * value - t.scrollCenter.width;
					const newTop =
						t.scrollNormalizedCenter.top * value - t.scrollCenter.height;

					if (newLeft >= 0 && newTop >= 0) {
						t.scrollTarget.scrollLeft = newLeft;
						t.scrollTarget.scrollTop = newTop;
					}

					step();
				} else {
					// We've reached the end.
					transition.current = undefined;
				}
			} else {
				// This is the first time we've been called in a transition. Record the
				// timestamp and try again.

				t.lastTimestamp = timestamp;
				step();
			}
		});
	}, []);

	// Start a new transition.

	React.useEffect(() => {
		if (jumpedTo.current !== undefined) {
			if (jumpedTo.current !== target) {
				return;
			}

			jumpedTo.current = undefined;
		}

		if (!transition.current && current !== target && scrollTarget) {
			transition.current = {
				scrollTarget,
				elapsed: 0,
				scrollNormalizedCenter: {
					left:
						(scrollTarget.scrollLeft + scrollTarget.clientWidth / 2) / current,
					top:
						(scrollTarget.scrollTop + scrollTarget.clientHeight / 2) / current
				},
				scrollCenter: {
					height: scrollTarget.clientHeight / 2,
					width: scrollTarget.clientWidth / 2
				},
				zoom: {
					start: current,
					change: target - current
				}
			};
			window.requestAnimationFrame(step);
		}
	}, [current, scrollTarget, step, target]);

	React.useLayoutEffect(() => {
		if (pendingScroll.current && scrollTarget) {
			scrollTarget.scrollLeft = pendingScroll.current.left;
			scrollTarget.scrollTop = pendingScroll.current.top;
			pendingScroll.current = undefined;
		}
	}, [current, scrollTarget]);

	/**
	 * Shows a zoom right away, with no transition, keeping the content under
	 * `focus` (a point in the scroll target's viewport) where it is. The story's
	 * zoom should be set to the same value afterward; until it is, a difference
	 * between the two is left alone.
	 */
	const jump = React.useCallback(
		(zoom: number, focus: Point) => {
			if (!scrollTarget) {
				return;
			}

			const from = currentRef.current;
			const base = pendingScroll.current ?? {
				left: scrollTarget.scrollLeft,
				top: scrollTarget.scrollTop
			};

			transition.current = undefined;
			jumpedTo.current = zoom;
			pendingScroll.current = {
				left: ((base.left + focus.left) / from) * zoom - focus.left,
				top: ((base.top + focus.top) / from) * zoom - focus.top
			};
			currentRef.current = zoom;
			setCurrent(zoom);
		},
		[scrollTarget]
	);

	return {jump, visibleZoom: current};
}
