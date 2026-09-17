/**
 * The scene's beats as a strip of time rather than a count.
 *
 * `n / m` says where the scrubber is; it cannot say that beat 3 is a held breath and beat 4
 * is a snap. Once beats carry `dur:` the spacing IS information, so the markers sit at the
 * times the scene actually plays at — the same schedule the play button runs.
 *
 * The marker row is laid out with flexbox rather than by computing percentages: each gap
 * grows in proportion to how long it lasts, and `min-width` on the gap is what keeps a run
 * of instant beats clickable. Percentages would need the pixel width to apply that floor,
 * which means measuring, which means a resize observer for something flexbox does alone.
 *
 * Labels cannot dodge the measuring — where they collide is a pixel question — so they are
 * an absolutely positioned layer UNDER the markers, which keeps them from pushing the row
 * they belong to around. See `beat-label-layout.ts` for the placement rules.
 */

import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {Beat} from '@sliders/scene-types';
import {beatHoldMs} from './beat-hold';
import {LabelLayout, LEADER_SLACK, placeLabels} from './beat-label-layout';
import './beat-timeline.css';

export interface BeatTimelineProps {
	/** Scrubber position: 0 is the stage before any beat ran. */
	beat: number;
	/** The scene's beats, in order. `beats.length + 1` states hang off them. */
	beats: Beat[];
	/** Expanded: the strip grows downward and names every beat it has room for. */
	labels: boolean;
	onBeatChange: (beat: number) => void;
}

/** Height of one label row, px. Must match `--sliders-timeline-row` in the CSS. */
const ROW_HEIGHT = 15;

/** Clear space between the marker row and the first label row, px. Leader lines cross it. */
const LEADER_GAP = 5;

/** What the measure pass found. One object, so a re-render never sees half of it. */
interface Metrics {
	/** Marker centre x, one per state. Also what the nearest-marker hover works off. */
	anchors: number[];
	layout: LabelLayout;
}

/**
 * How long the scrubber rests on each state, in the order it visits them.
 *
 * State 0 was produced by no beat and takes the default; state N by `beats[N - 1]`.
 */
export function holdTimes(beats: Beat[]): number[] {
	return [undefined, ...beats].map(beat => beatHoldMs(beat));
}

export const BeatTimeline: React.FC<BeatTimelineProps> = ({
	beat,
	beats,
	labels,
	onBeatChange
}) => {
	const {t} = useTranslation();
	const holds = React.useMemo(() => holdTimes(beats), [beats]);
	const inner = React.useRef<HTMLDivElement>(null);
	const markRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
	const labelRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
	const [metrics, setMetrics] = React.useState<Metrics>();
	const [width, setWidth] = React.useState(0);
	const [hovered, setHovered] = React.useState<number>();

	const texts = React.useMemo(
		() => [undefined, ...beats].map((each, state) => shortLabel(t, state, each)),
		[beats, t]
	);
	// A string, not the array: what the measure below cares about is whether the text
	// changed, and the memo that produces it re-runs whenever `t` gets a new identity.
	const textKey = texts.join('\u0000');
	const titles = React.useMemo(
		() => [undefined, ...beats].map((each, state) => fullLabel(t, state, each)),
		[beats, t]
	);

	// Width is its own state so the measure below depends on a number rather than on the
	// element: the label layer's own height changes as rows come and go, and re-running the
	// placement because the thing it produced got taller is how a layout loop starts.
	React.useEffect(() => {
		const el = inner.current;

		if (!el) {
			return;
		}

		setWidth(el.clientWidth);

		// Guarded the way `useArtRect` guards it: jsdom has no ResizeObserver, and a strip
		// that measures once is still a strip.
		if (!window.ResizeObserver) {
			return;
		}

		const observer = new ResizeObserver(() =>
			setWidth(current =>
				Math.abs(current - el.clientWidth) > 0.5 ? el.clientWidth : current
			)
		);

		observer.observe(el);

		return () => observer.disconnect();
	}, []);

	// Layout effect, not an effect: labels are rendered at their natural size first and
	// moved into place by this, and doing that after paint is a visible jump.
	React.useLayoutEffect(() => {
		// Refs are written by index and never cleared, so a scene that lost beats would
		// otherwise measure the markers it no longer has.
		markRefs.current.length = holds.length;
		labelRefs.current.length = holds.length;

		const anchors = markRefs.current.map(mark =>
			mark ? mark.offsetLeft + mark.offsetWidth / 2 : 0
		);
		// Measured from the elements rather than guessed from the text: a character id is
		// whatever the author typed, in whatever font the theme resolves to.
		const widths = labels
			? labelRefs.current.map(label => label?.offsetWidth ?? 0)
			: [];

		const next: Metrics = {
			anchors,
			layout: labels
				? placeLabels({anchors, current: beat, stripWidth: width, widths})
				: {boxes: [], hidden: [], rows: 0}
		};

		// Bail when the measure found what it found last time. The effect writes the state
		// that re-renders the elements it measures, so without this the only thing standing
		// between the strip and a render loop is every dependency being identity-stable --
		// and `t` out of `useTranslation` is not.
		setMetrics(current => (sameMetrics(current, next) ? current : next));
	}, [beat, holds.length, labels, textKey, width]);

	const nearest = React.useCallback(
		(clientX: number) => {
			const box = inner.current?.getBoundingClientRect();
			const anchors = metrics?.anchors;

			if (!box || !anchors?.length) {
				return undefined;
			}

			const x = clientX - box.left;

			// Nearest wins outright: an 8px dot is a hard thing to hit, and a strip that
			// highlights nothing between two markers reads as broken rather than as precise.
			return anchors.reduce(
				(best, anchor, state) =>
					Math.abs(anchor - x) < Math.abs(anchors[best] - x) ? state : best,
				0
			);
		},
		[metrics]
	);

	// One beat and there is nothing to compare: the chevrons already say everything a strip
	// of two markers would.
	if (beats.length < 2) {
		return null;
	}

	const boxes = metrics?.layout.boxes ?? [];
	const rows = metrics?.layout.rows ?? 0;

	return (
		<div
			className="scene-preview-timeline"
			data-expanded={labels || undefined}
			data-testid="scene-preview-timeline"
			onClick={event => {
				// A marker's own click bubbles to here, so the button stays a real button for
				// the keyboard while the pointer gets nearest-wins.
				const mark = (event.target as HTMLElement).closest?.('[data-state]');
				const state = mark
					? Number(mark.getAttribute('data-state'))
					: nearest(event.clientX);

				if (state !== undefined) {
					onBeatChange(state);
				}
			}}
			onPointerLeave={() => setHovered(undefined)}
			onPointerMove={event => setHovered(nearest(event.clientX))}
		>
			<div className="scene-preview-timeline-inner" ref={inner}>
				<div className="scene-preview-timeline-track">
					{holds.map((hold, state) => (
						<React.Fragment key={state}>
							{state > 0 && (
								<span
									className="scene-preview-timeline-gap"
									// The PREVIOUS state's hold is what separates it from this one.
									style={{flexGrow: Math.max(holds[state - 1], 1)}}
								/>
							)}
							<button
								aria-current={state === beat}
								aria-label={titles[state]}
								className="scene-preview-timeline-mark"
								data-current={state === beat || undefined}
								data-hovered={state === hovered || undefined}
								data-state={state}
								ref={el => (markRefs.current[state] = el)}
								title={titles[state]}
								type="button"
							/>
						</React.Fragment>
					))}
				</div>
				{labels && (
					<div
						className="scene-preview-timeline-labels"
						style={{height: LEADER_GAP + Math.max(rows, 1) * ROW_HEIGHT}}
					>
						{boxes.map(box => (
							<Leader
								anchor={metrics?.anchors[box.state] ?? 0}
								box={box}
								key={`leader-${box.state}`}
							/>
						))}
						{texts.map((text, state) => {
							const box = boxes.find(each => each.state === state);

							return (
								<span
									className={classNames('scene-preview-timeline-label', {
										placed: !!box
									})}
									data-current={state === beat || undefined}
									data-hovered={state === hovered || undefined}
									data-state={state}
									key={state}
									ref={el => (labelRefs.current[state] = el)}
									style={
										box
											? {left: box.left, top: LEADER_GAP + box.row * ROW_HEIGHT}
											: undefined
									}
									title={titles[state]}
								>
									{text}
								</span>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
};

/**
 * The line from a dot down to its label.
 *
 * Only drawn when it says something: a label sitting centred on its own dot on the top row
 * needs no line, and one line per label is noise rather than guidance.
 */
const Leader: React.FC<{anchor: number; box: LabelBoxProp}> = ({anchor, box}) => {
	const centre = box.left + box.width / 2;
	const top = LEADER_GAP + box.row * ROW_HEIGHT;
	const drift = centre - anchor;

	if (box.row === 0 && Math.abs(drift) <= LEADER_SLACK) {
		return null;
	}

	return (
		<>
			<span
				className="scene-preview-timeline-leader"
				style={{height: top, left: anchor}}
			/>
			{Math.abs(drift) > LEADER_SLACK && (
				<span
					className="scene-preview-timeline-leader-elbow"
					style={{
						left: Math.min(anchor, centre),
						top,
						width: Math.abs(drift)
					}}
				/>
			)}
		</>
	);
};

type LabelBoxProp = LabelLayout['boxes'][number];

/** Deep enough for the bail above: everything the render reads out of a `Metrics`. */
function sameMetrics(a: Metrics | undefined, b: Metrics): boolean {
	return (
		!!a &&
		a.anchors.length === b.anchors.length &&
		a.anchors.every((anchor, index) => anchor === b.anchors[index]) &&
		a.layout.rows === b.layout.rows &&
		a.layout.boxes.length === b.layout.boxes.length &&
		a.layout.boxes.every((box, index) => {
			const other = b.layout.boxes[index];

			return (
				box.state === other.state &&
				box.row === other.row &&
				box.left === other.left &&
				box.width === other.width
			);
		})
	);
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * What the label says: short enough to fit a crowded strip, and never two lengths.
 *
 * A label that swaps to a longer form when the scrubber reaches it would make the whole
 * strip twitch on every step, so the full sentence lives in `title` and only here.
 */
function shortLabel(t: Translate, state: number, beat: Beat | undefined): string {
	if (state === 0 || !beat) {
		return t('dialogs.passageEdit.scenePreview.timelineLabelStart');
	}

	const base = (() => {
		switch (beat.kind) {
			case 'say':
			case 'set':
				return beat.who;
			case 'wait':
				return t('dialogs.passageEdit.scenePreview.timelineLabelWait', {
					seconds: beat.seconds
				});
			case 'fx':
				return t('dialogs.passageEdit.scenePreview.timelineLabelFx', {
					name: beat.fx.id
				});
			case 'mark':
				return t('dialogs.passageEdit.scenePreview.timelineLabelMark', {
					name: beat.name
				});
			default:
				return t('dialogs.passageEdit.scenePreview.timelineLabelBox');
		}
	})();

	// The one number the strip exists to show, and the only thing worth the extra width.
	return beat.dur === undefined
		? base
		: t('dialogs.passageEdit.scenePreview.timelineLabelTimed', {
				dur: beat.dur,
				label: base
		  });
}

/** "Beat 3 — mira, 0.8s". The one place the author sees a beat's timing without the YAML. */
function fullLabel(t: Translate, state: number, beat: Beat | undefined): string {
	if (state === 0 || !beat) {
		return t('dialogs.passageEdit.scenePreview.timelineStart');
	}

	const who = beat.kind === 'say' || beat.kind === 'set' ? beat.who : beat.kind;

	return beat.dur === undefined
		? t('dialogs.passageEdit.scenePreview.timelineBeat', {beat: state, who})
		: t('dialogs.passageEdit.scenePreview.timelineBeatTimed', {
				beat: state,
				dur: beat.dur,
				who
		  });
}
