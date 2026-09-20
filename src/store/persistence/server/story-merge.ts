/**
 * Two people editing DIFFERENT passages of one story, resolved without asking anybody.
 *
 * # The problem
 *
 * `If-Match` is on the STORY rev, so it is whole-story even once uploads are per-passage.
 * A edits passage 1, B edits passage 2, B's push gets a 412, B parks in `conflict` and
 * stops syncing until a person clicks something. That is not an edge case — it is the
 * NORMAL case for two people on one story, and today it costs one of them a dialog every
 * few minutes.
 *
 * # The rule
 *
 * A three-way merge on whole passages, with a base. Nothing here is clever:
 *
 *   - Take the ids each side TOUCHED since the base — changed, added, or removed.
 *   - If the two sets are disjoint, the merge is theirs plus my changes, and neither
 *     person is asked anything.
 *   - If they overlap, park. Two people edited one passage; only they can settle it.
 *
 * # Four things it refuses to do
 *
 * NO BASE, NO MERGE. Without a snapshot of the last agreed state there is no way to tell
 * "I added this passage" from "they deleted it", and the two call for opposite answers.
 * `reason: 'no base'` and the story parks exactly as it does today.
 *
 * NO TEXT MERGE. Passages are whole. Two edits to one passage is a conflict even when a
 * character-level merge would have worked, because a silently wrong merge of prose is
 * worse than a dialog.
 *
 * NO DUPLICATE NAMES. Two people adding a passage with the same name is disjoint BY ID
 * and broken in the result: passage names are what links resolve against, and
 * `matchPassageName` takes the first. Refused, so the author sees a conflict rather than
 * a story whose links quietly point at the wrong room.
 *
 * NO SCALAR GUESSING. Both sides renaming the story, or both editing the stylesheet, is a
 * conflict like any other. `lastUpdate` is the one exception and is not a decision: both
 * sides always move it, and the later of the two is the answer.
 */

import type {Passage, Story} from '../../stories';
import type {StorySnapshot} from './server.types';
import {applyPassageDiff, diffFromSnapshot, snapshotStory} from './story-diff';

export type MergeResult =
	| {merged: true; story: Story}
	| {merged: false; reason: string};

/**
 * `lastUpdate` moves on every edit on both sides, so comparing it would call every merge
 * a conflict. It is a timestamp, not an authored value: the later one wins and nobody
 * needs to be asked.
 */
const UNCONTESTED_KEYS = new Set(['lastUpdate']);

/**
 * What one side did to each id it touched: its hash, or `undefined` for a removal.
 *
 * A map rather than a set because "both sides touched this" is not the question — "both
 * sides touched it DIFFERENTLY" is. Two people deleting the same passage, or pasting the
 * same block into it, asked for one end state and get it.
 */
function touched(
	base: Record<string, string>,
	side: Record<string, string>
): Map<string, string | undefined> {
	const moved = new Map<string, string | undefined>();

	for (const [key, hash] of Object.entries(side)) {
		if (base[key] !== hash) {
			moved.set(key, hash);
		}
	}

	for (const key of Object.keys(base)) {
		if (!(key in side)) {
			moved.set(key, undefined);
		}
	}

	return moved;
}

/** Top-level keys, minus the ones nobody can disagree about. */
function contested(scalars: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};

	for (const [key, hash] of Object.entries(scalars)) {
		if (!UNCONTESTED_KEYS.has(key)) {
			out[key] = hash;
		}
	}

	return out;
}

/** The first thing both sides moved, to two different places. */
function firstDisagreement(
	a: Map<string, string | undefined>,
	b: Map<string, string | undefined>
): string | undefined {
	for (const [key, hash] of a) {
		if (b.has(key) && b.get(key) !== hash) {
			return key;
		}
	}

	return undefined;
}

/**
 * Passage names, folded the way `matchPassageName` folds them: case and surrounding
 * whitespace, nothing else.
 */
function nameKey(passage: Passage): string {
	return passage.name.trim().toLowerCase();
}

function duplicateName(passages: Passage[]): string | undefined {
	const seen = new Set<string>();

	for (const passage of passages) {
		const key = nameKey(passage);

		if (seen.has(key)) {
			return passage.name;
		}

		seen.add(key);
	}

	return undefined;
}

export interface MergeStoriesOptions {
	/** The last state both sides agreed on. Without it there is no merge. */
	base: StorySnapshot | undefined;
	/** This browser's copy. */
	mine: Story;
	/** The server's copy, as fetched. */
	theirs: Story;
}

/**
 * Theirs plus my changes, or a refusal saying why.
 *
 * The result carries MY view state — `zoom`, `snapToGrid`, `selected`, `sync` — because
 * it is going into this browser's store and how one person is looking at the map is not
 * part of the story. `incomingStory` has already put defaults in the server's copy; those
 * are right for a checkout and wrong here.
 */
export function mergeStories(options: MergeStoriesOptions): MergeResult {
	const {base, mine, theirs} = options;

	if (!base) {
		return {merged: false, reason: 'no base to merge against'};
	}

	const ours = snapshotStory(mine);
	const yours = snapshotStory(theirs);
	const clash = firstDisagreement(
		touched(base.passages, ours.passages),
		touched(base.passages, yours.passages)
	);

	if (clash !== undefined) {
		return {merged: false, reason: `both sides changed passage ${clash}`};
	}

	const keyClash = firstDisagreement(
		touched(contested(base.story), contested(ours.story)),
		touched(contested(base.story), contested(yours.story))
	);

	if (keyClash !== undefined) {
		return {merged: false, reason: `both sides changed ${keyClash}`};
	}

	const patch = diffFromSnapshot(base, mine);

	if (!patch) {
		return {merged: false, reason: 'my changes cannot be said as a patch'};
	}

	const merged = applyPassageDiff(theirs, patch);
	const duplicate = duplicateName(merged.passages);

	if (duplicate !== undefined) {
		return {
			merged: false,
			reason: `merging would leave two passages called "${duplicate}"`
		};
	}

	return {
		merged: true,
		story: {
			...merged,
			// A timestamp, not a decision — see UNCONTESTED_KEYS.
			lastUpdate:
				theirs.lastUpdate > mine.lastUpdate ? theirs.lastUpdate : mine.lastUpdate,
			selected: mine.selected,
			snapToGrid: mine.snapToGrid,
			sync: mine.sync,
			zoom: mine.zoom
		}
	};
}
