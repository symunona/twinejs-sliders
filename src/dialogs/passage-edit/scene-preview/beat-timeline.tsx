/**
 * The scene's beats as a strip of time rather than a count.
 *
 * `n / m` says where the scrubber is; it cannot say that beat 3 is a held breath and beat 4
 * is a snap. Once beats carry `dur:` the spacing IS information, so the markers sit at the
 * times the scene actually plays at — the same schedule the play button runs.
 *
 * Laid out with flexbox rather than by computing percentages: each gap grows in proportion
 * to how long it lasts, and `min-width` on the gap is what keeps a run of instant beats
 * clickable. Percentages would need the pixel width to apply that floor, which means
 * measuring, which means a resize observer for a strip that flexbox can do on its own.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {Beat} from '@sliders/scene-types';
import {beatHoldMs} from './beat-hold';
import './beat-timeline.css';

export interface BeatTimelineProps {
	/** The scene's beats, in order. `beats.length + 1` states hang off them. */
	beats: Beat[];
	/** Scrubber position: 0 is the stage before any beat ran. */
	beat: number;
	onBeatChange: (beat: number) => void;
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
	onBeatChange
}) => {
	const {t} = useTranslation();
	const holds = React.useMemo(() => holdTimes(beats), [beats]);

	// One beat and there is nothing to compare: the chevrons already say everything a strip
	// of two markers would.
	if (beats.length < 2) {
		return null;
	}

	return (
		<div className="scene-preview-timeline" data-testid="scene-preview-timeline">
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
						aria-label={label(t, state, beats[state - 1])}
						className="scene-preview-timeline-mark"
						data-current={state === beat || undefined}
						onClick={() => onBeatChange(state)}
						title={label(t, state, beats[state - 1])}
						type="button"
					/>
				</React.Fragment>
			))}
		</div>
	);
};

/** "Beat 3 — mira, 0.8s". The one place the author sees a beat's timing without the YAML. */
function label(
	t: (key: string, options?: Record<string, unknown>) => string,
	state: number,
	beat: Beat | undefined
): string {
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
