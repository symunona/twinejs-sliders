/**
 * `applyMusic` — one `music:` (scene top or beat) laid over what is playing.
 *
 * One function for both places, so `- music: {wind: {volume: 0.2}}` on a beat can never
 * mean something different from the same line at the top of a `from:` patch.
 */

import {MUSIC_DEFAULT_FADE} from '@sliders/scene-types';
import type {
	MusicLoop,
	MusicSpec,
	MusicTrack,
	StageMusic
} from '@sliders/scene-types';

/**
 * `take` is WHO is asking: 0 for the scene top, `i + 1` for beat `i`. It only lands on a
 * track when the entry says `restart: true` — that difference is what tells the deck to
 * start the file over instead of playing on. Absent `restart`, a same-id redefinition keeps
 * the take it already had, so re-declaring a bed never restarts it.
 *
 * Returns `undefined` for silence rather than `{}`, so an emptied stage compares equal to
 * one that never had music.
 */
export function applyMusic(
	current: StageMusic | undefined,
	spec: MusicSpec | null | undefined,
	take: number
): StageMusic | undefined {
	if (spec === undefined) {
		return current;
	}

	if (spec === null) {
		return undefined;
	}

	const out: StageMusic = cloneMusic(current) ?? {};
	const {stopOthers, tracks} = spec;

	if (stopOthers === 'all') {
		for (const key of Object.keys(out)) {
			if (!(key in tracks)) {
				delete out[key];
			}
		}
	} else if (stopOthers) {
		for (const key of stopOthers) {
			if (!(key in tracks)) {
				delete out[key];
			}
		}
	}

	for (const key of Object.keys(tracks)) {
		const entry = tracks[key];
		const running = out[key];

		if (entry === null) {
			delete out[key];
			continue;
		}

		if (entry.id !== undefined) {
			// A redefinition states the track in full: anything it leaves out is the
			// default, not whatever the old track had. Only the take survives, and only
			// for the same file — it is "this recording, still playing", not a setting.
			const kept = entry.restart
				? take
				: running && running.id === entry.id
				? running.take
				: undefined;

			out[key] = {
				amount: entry.amount ?? 1,
				fade: entry.fade ?? MUSIC_DEFAULT_FADE,
				id: entry.id,
				loop: cloneLoop(entry.loop ?? false),
				...(entry.start !== undefined ? {start: entry.start} : {}),
				...(kept !== undefined ? {take: kept} : {})
			};
			continue;
		}

		// A patch without a running track has nothing to turn down. Not conjured: there
		// is no id to play, and the parser cannot know what will be running by then.
		if (!running) {
			continue;
		}

		const next: MusicTrack = {...running};

		if (entry.amount !== undefined) {
			next.amount = entry.amount;
		}

		if (entry.loop !== undefined) {
			next.loop = cloneLoop(entry.loop);
		}

		if (entry.fade !== undefined) {
			next.fade = entry.fade;
		}

		if (entry.start !== undefined) {
			next.start = entry.start;
		}

		if (entry.restart) {
			next.take = take;
		}

		out[key] = next;
	}

	return Object.keys(out).length > 0 ? out : undefined;
}

export function cloneLoop(loop: MusicLoop): MusicLoop {
	return typeof loop === 'object' ? {...loop} : loop;
}

export function cloneMusic(music: StageMusic | undefined): StageMusic | undefined {
	if (!music) {
		return undefined;
	}

	const out: StageMusic = {};

	for (const key of Object.keys(music)) {
		out[key] = {...music[key], loop: cloneLoop(music[key].loop)};
	}

	return out;
}

/**
 * Same tracks, same everything — by key. Key ORDER is ignored: two passages naming the
 * same tracks in a different order sound identical, and `data-music` order is the
 * renderer's concern.
 */
export function sameMusic(
	a: StageMusic | undefined,
	b: StageMusic | undefined
): boolean {
	const aKeys = a ? Object.keys(a) : [];
	const bKeys = b ? Object.keys(b) : [];

	if (aKeys.length !== bKeys.length) {
		return false;
	}

	return aKeys.every(key => {
		const x = a![key];
		const y = b?.[key];

		return (
			y !== undefined &&
			x.id === y.id &&
			x.amount === y.amount &&
			x.fade === y.fade &&
			x.start === y.start &&
			x.take === y.take &&
			sameLoop(x.loop, y.loop)
		);
	});
}

function sameLoop(a: MusicLoop, b: MusicLoop): boolean {
	if (typeof a === 'object' && typeof b === 'object') {
		return a.from === b.from && a.to === b.to;
	}

	return a === b;
}
