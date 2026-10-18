/**
 * How a beat plays in time — the ONE schedule the player, the editor's play button, the
 * timeline strip and the timing overlay all read (spec 02, "Timing").
 *
 *   - `timeBeat`: a beat's derived transitions, each given the duration and curve of the
 *     entity it belongs to — its own `with:` part, else the beat's `dur:`/`ease:`.
 *   - `beatTiming`: what is animating, for how long, and how the beat ends: the reader's
 *     click, an auto-advance, a timer, or the end of its own animation.
 *   - `sceneTimeline`: the whole scene laid end to end on that schedule.
 *
 * Pure. Computed from the stages and the beat, never from `transitionend`, so a scrubber
 * and a player that never ran the animation still agree on how long it takes.
 */

import {DEFAULT_STEP_SECONDS, beatLines} from '@sliders/scene-types';
import type {
	Beat,
	BeatEase,
	BeatLine,
	EntityId,
	Stage,
	Transition,
	TransitionKind
} from '@sliders/scene-types';
import {diffStages, easeTransitions, timeTransitions} from './diff-stages';
import {resolveStage} from './resolve-stage';

/**
 * The part of a beat that owns entity `id`'s timing: its own `with:` part, else the part an
 * `of:` ancestor has — a candle rides on the table, so it glides on the table's clock.
 */
function partTiming(
	beat: Beat,
	id: EntityId | undefined,
	stage: Stage | undefined
): {dur?: number; ease?: BeatEase} | undefined {
	if (id === undefined || !beat.with) {
		return undefined;
	}

	const seen = new Set<EntityId>();
	let at: EntityId | undefined = id;

	while (at !== undefined && !seen.has(at)) {
		seen.add(at);

		const part = beat.with.find(one => one.who === at);

		if (part) {
			return part.dur !== undefined || part.ease !== undefined ? part : undefined;
		}

		// The primary entity is timed by the beat itself: stop there.
		if ('who' in beat && beat.who === at) {
			return undefined;
		}

		at = stage?.entities[at]?.of;
	}

	return undefined;
}

/**
 * A beat's transitions, timed and eased per entity.
 *
 * `after` is the beat's own (unresolved) stage, read only for `of:` chains; without it a
 * child keeps the beat's timing.
 */
export function timeBeat(
	transitions: Transition[],
	beat: Beat | undefined,
	sceneEase?: BeatEase,
	after?: Stage
): Transition[] {
	if (!beat) {
		return easeTransitions(transitions, undefined, sceneEase);
	}

	return transitions.map(transition => {
		const part = partTiming(beat, transition.entityId, after);
		const dur = part?.dur ?? beat.dur;
		const ease = part?.ease ?? beat.ease;

		return easeTransitions(timeTransitions([transition], dur), ease, sceneEase)[0];
	});
}

/** `diffStages` + `timeBeat` over the resolved stages: what a beat hands the renderer. */
export function beatTransitions(
	before: Stage,
	after: Stage,
	beat: Beat | undefined,
	sceneEase?: BeatEase
): Transition[] {
	return timeBeat(
		diffStages(resolveStage(before), resolveStage(after)),
		beat,
		sceneEase,
		after
	);
}

/** One row of a beat's animation: an entity's (or the stage's) change of one kind. */
export interface BeatTrack {
	/** Absent = the stage itself: backdrop, camera, fx, music. */
	entityId?: EntityId;
	/** A transition kind, or `steps` for a `pose:` list that plays once. */
	kind: TransitionKind | 'steps';
	/** Seconds from the beat's start. Always 0 today; here so a stagger needs no new shape. */
	start: number;
	duration: number;
}

/**
 * How a beat hands over to the next one.
 *
 * | | |
 * |---|---|
 * | `reader` | waits for a click — the last beat, or a line with no auto-advance |
 * | `auto` | a line, moved on by the scene's / reader's auto-advance |
 * | `timer` | its own `dur:`, or a `- wait:` |
 * | `anim` | nothing to read: on as soon as its animation has run |
 */
export type BeatAdvance = 'reader' | 'auto' | 'timer' | 'anim';

export interface BeatTiming {
	tracks: BeatTrack[];
	/** When the last track ends. Music is not counted: a fade is heard, not waited for. */
	animSec: number;
	lines: BeatLine[];
	advance: BeatAdvance;
	/** Seconds until the next beat. Absent for `reader`. */
	holdSec?: number;
}

export interface BeatTimingOptions {
	/** Seconds an untimed line holds. `0` (or absent) = wait for a click. */
	autoAdvanceSec?: number;
	/** The scene's last beat always waits for the reader if it says something. */
	last?: boolean;
}

/** Kinds that hold a beat. Music fades under it; a backdrop swap does hold. */
function holds(kind: BeatTrack['kind']): boolean {
	return kind !== 'music';
}

/**
 * What a beat animates and how it ends.
 *
 * `transitions` are the beat's TIMED transitions (`beatTransitions`); `after` is the stage it
 * produced, read for `pose:` lists that play once — a walk is a beat that ends when the
 * walker arrives, not 0.3s in.
 */
export function beatTiming(
	beat: Beat,
	transitions: Transition[],
	after: Stage | undefined,
	options: BeatTimingOptions = {}
): BeatTiming {
	const tracks: BeatTrack[] = transitions.map(transition => ({
		duration: Math.max(0, transition.duration),
		kind: transition.kind,
		start: 0,
		...(transition.entityId !== undefined ? {entityId: transition.entityId} : {})
	}));

	for (const transition of transitions) {
		const id = transition.entityId;
		const entity = id !== undefined ? after?.entities[id] : undefined;

		if (transition.kind !== 'pose' || !entity?.steps || entity.poseLoop !== 'once') {
			continue;
		}

		const total = entity.steps.reduce(
			(sum, step) => sum + (step.dur ?? DEFAULT_STEP_SECONDS),
			0
		);

		tracks.push({duration: total, entityId: id, kind: 'steps', start: 0});
	}

	const animSec = tracks.reduce(
		(max, track) => (holds(track.kind) ? Math.max(max, track.start + track.duration) : max),
		0
	);
	const lines = beatLines(beat);
	const base = {animSec, lines, tracks};

	if (lines.length > 0) {
		if (options.last) {
			return {...base, advance: 'reader'};
		}

		if (beat.dur !== undefined) {
			return {...base, advance: 'timer', holdSec: Math.max(beat.dur, animSec)};
		}

		const auto = options.autoAdvanceSec ?? 0;

		return auto > 0
			? {...base, advance: 'auto', holdSec: Math.max(auto, animSec)}
			: {...base, advance: 'reader'};
	}

	if (beat.kind === 'wait') {
		return {...base, advance: 'timer', holdSec: Math.max(beat.seconds, animSec)};
	}

	// `dur: 0` is a snap: every track is zero, so this is 0 too — straight on.
	if (beat.dur !== undefined && beat.dur > 0) {
		return {...base, advance: 'timer', holdSec: Math.max(beat.dur, animSec)};
	}

	return {...base, advance: 'anim', holdSec: animSec};
}

/** One beat placed on the scene's clock. */
export interface TimelineBeat {
	beat: Beat;
	/** Seconds from the scene's first beat. */
	start: number;
	/** Seconds this beat occupies on the strip; a `reader` wait takes `readerSec`. */
	length: number;
	timing: BeatTiming;
}

export interface SceneTimelineOptions extends BeatTimingOptions {
	sceneEase?: BeatEase;
	/** How wide a click wait is drawn, seconds. It has no length of its own. */
	readerSec?: number;
}

/**
 * Every beat of a scene on one clock. `states` is `runBeats` output (length beats + 1).
 * `last` is worked out here; `options.last` is ignored.
 */
export function sceneTimeline(
	states: Stage[],
	beats: Beat[],
	options: SceneTimelineOptions = {}
): {beats: TimelineBeat[]; total: number} {
	const out: TimelineBeat[] = [];
	const readerSec = options.readerSec ?? 1.5;
	let t = 0;

	beats.forEach((beat, i) => {
		const before = states[i] ?? states[states.length - 1];
		const after = states[i + 1] ?? before;
		const transitions = beatTransitions(before, after, beat, options.sceneEase);
		const timing = beatTiming(beat, transitions, after, {
			...options,
			last: i === beats.length - 1
		});
		const length =
			timing.advance === 'reader'
				? Math.max(readerSec, timing.animSec)
				: timing.holdSec ?? 0;

		out.push({beat, length, start: t, timing});
		t += length;
	});

	return {beats: out, total: t};
}
