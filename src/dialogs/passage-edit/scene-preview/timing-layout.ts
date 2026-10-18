/**
 * The timing overlay's rows, from the scene's own clock (`sceneTimeline`).
 *
 * One GROUP per thing that moves — the stage itself, each entity, the narration box — and
 * inside it one ROW per kind of change (`move`, `scale`, `pose`, …) plus `say` for the lines
 * the entity speaks. A bar is one beat's share of that row. Pure, so the overlay draws and
 * the tests read the same layout.
 */

import type {BeatAdvance, TimelineBeat} from '@sliders/scene-core';
import type {EntityId} from '@sliders/scene-types';

export interface TimingBar {
	/** Beat index, 0-based. */
	beat: number;
	/** Seconds from the scene's first beat. */
	start: number;
	duration: number;
	/** Words, on a `say` bar. */
	text?: string;
}

export interface TimingRow {
	/** `say`, a transition kind, or `steps`. */
	kind: string;
	bars: TimingBar[];
}

export interface TimingGroup {
	/** `stage`, `box`, or an entity id. */
	id: string;
	/** Absent for an entity: its id is its name. */
	special?: 'stage' | 'box';
	rows: TimingRow[];
}

export interface TimingColumn {
	beat: number;
	start: number;
	length: number;
	/** How the beat hands over at its END: the line drawn there. */
	advance: BeatAdvance;
}

export interface TimingLayout {
	total: number;
	columns: TimingColumn[];
	groups: TimingGroup[];
}

/** Row order inside a group: words first, then what a reader notices soonest. */
const ROW_ORDER = [
	'say',
	'enter',
	'exit',
	'move',
	'scale',
	'rot',
	'pose',
	'steps',
	'flip',
	'grade',
	'bg',
	'camera',
	'fx',
	'music'
];

function rank(kind: string): number {
	const at = ROW_ORDER.indexOf(kind);

	return at === -1 ? ROW_ORDER.length : at;
}

/**
 * `order` is the entity ids as the author wrote them; groups follow it, so the overlay reads
 * like the cast list rather than in the differ's alphabetical order. Ids not in it go last.
 */
export function timingLayout(
	timeline: {beats: TimelineBeat[]; total: number},
	order: string[] = []
): TimingLayout {
	const groups = new Map<string, TimingGroup>();
	const group = (id: string, special?: TimingGroup['special']) => {
		let found = groups.get(special ?? `e:${id}`);

		if (!found) {
			found = {id, rows: [], ...(special ? {special} : {})};
			groups.set(special ?? `e:${id}`, found);
		}

		return found;
	};
	const push = (into: TimingGroup, kind: string, bar: TimingBar) => {
		let row = into.rows.find(each => each.kind === kind);

		if (!row) {
			row = {bars: [], kind};
			into.rows.push(row);
		}

		row.bars.push(bar);
	};

	// The stage first, so it sits on top whatever moves later.
	group('stage', 'stage');

	timeline.beats.forEach(({length, start, timing}, beat) => {
		for (const line of timing.lines) {
			const into = line.who === undefined ? group('box', 'box') : group(line.who);

			push(into, 'say', {beat, duration: length, start, text: line.text});
		}

		for (const track of timing.tracks) {
			const into =
				track.entityId === undefined
					? group('stage', 'stage')
					: group(track.entityId as EntityId);

			push(into, track.kind, {
				beat,
				duration: track.duration,
				start: start + track.start
			});
		}
	});

	for (const each of groups.values()) {
		each.rows.sort((a, b) => rank(a.kind) - rank(b.kind));
	}

	const place = (each: TimingGroup) => {
		if (each.special === 'stage') {
			return -1;
		}

		if (each.special === 'box') {
			return Number.MAX_SAFE_INTEGER;
		}

		const at = order.indexOf(each.id);

		return at === -1 ? order.length : at;
	};

	return {
		columns: timeline.beats.map(({length, start, timing}, beat) => ({
			advance: timing.advance,
			beat,
			length,
			start
		})),
		groups: [...groups.values()]
			.filter(each => each.rows.length > 0)
			.sort((a, b) => place(a) - place(b)),
		total: timeline.total
	};
}
