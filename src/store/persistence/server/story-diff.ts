/**
 * A story, as the difference from the last one the server agreed to.
 *
 * # Why
 *
 * Autosave PUTs the WHOLE story every five seconds. Story text today is 0.7-14 KB and
 * 20-100 KB is what the format is heading for, so one typed sentence is about to cost
 * 100 KB of upload on whatever the phone has. Worse, the tab-close save goes out with
 * Fetch `keepalive`, which the spec caps at 64 KB of request body: measured, an 89 KB
 * story is 90,550 B per PUT, over the cap, so THE LAST SAVE BEFORE A TAB CLOSES SILENTLY
 * DOES NOT HAPPEN. The same story as a one-passage patch is 1,219 B.
 *
 * # Three callers, one diff
 *
 * The same question — what changed between these two stories — is asked in three places:
 * the PATCH body here, the per-passage conflict merge (`story-merge.ts`), and a future
 * `GET ?since=rev`. Written once, pure, no network, so the three cannot drift into three
 * answers.
 *
 * # Passages are whole, never text-diffed
 *
 * Sending one whole 8 KB passage instead of a whole 100 KB story is already the win, and
 * a text diff would mean the client and the Go server agreeing on a diff algorithm
 * forever. `server/store/patch.go` says the same thing from the other side.
 *
 * # The base is a SNAPSHOT, not a story
 *
 * A patch is only meaningful against the base it was computed from, so the client has to
 * remember what the server is holding — as a hash per passage, not a second copy of every
 * story. `StorySnapshot` in `server.types.ts` says what that costs and how it is
 * invalidated; `usableSnapshot` below is the one check that enforces it.
 */

import type {Passage, Story} from '../../stories';
import {outgoingStory} from './client';
import type {StoryPatch, StorySnapshot} from './server.types';
import {fnv1a, storyHash} from './sync-record';

/**
 * JSON with object keys in a fixed order and `Date` spelled as the wire spells it.
 *
 * `sync-record.ts` has a sibling of this and deliberately does not export it: that one
 * feeds `storyHash`, whose input is an allowlist with no `Date` in it, and teaching it
 * about `Date` there would change every stored hash for no reason. Here `lastUpdate` is a
 * real field that travels, so it has to hash as something other than `{}`.
 */
function stableStringify(value: unknown): string {
	if (value instanceof Date) {
		return JSON.stringify(value.toISOString());
	}

	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}

	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

	return `{${entries
		.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
		.join(',')}}`;
}

function hashOf(value: unknown): string {
	return fnv1a(stableStringify(value));
}

/**
 * The top-level fields a patch may carry, taken from `outgoingStory` rather than from a
 * list here.
 *
 * One list of "what this browser sends", in the one place that already had to know. A
 * second copy would go stale the first time a `Story` field is added or stripped, and the
 * failure mode is a field that syncs by PUT and stops syncing by PATCH — visible only to
 * whoever is on the other end.
 */
function storyScalars(story: Story): Record<string, unknown> {
	const out = outgoingStory(story) as unknown as Record<string, unknown>;
	const scalars: Record<string, unknown> = {...out};

	delete scalars.passages;

	return scalars;
}

/** What the server holds after this story was pushed or pulled whole. */
export function snapshotStory(story: Story): StorySnapshot {
	const passages: Record<string, string> = {};
	const scalars: Record<string, string> = {};

	for (const passage of story.passages) {
		passages[passage.id] = hashOf(passage);
	}

	for (const [key, value] of Object.entries(storyScalars(story))) {
		scalars[key] = hashOf(value);
	}

	return {hash: storyHash(story), passages, story: scalars};
}

/**
 * What changed between the snapshot and this story, or `undefined` when the change
 * cannot be said as a patch.
 *
 * The one inexpressible change is a top-level key DISAPPEARING: the wire format has no
 * "unset this", and `server/store/patch.go` folds keys in rather than replacing the
 * object. No required `Story` field can vanish, so this is a guard against a future
 * optional one rather than a case that happens today — and the answer is `undefined`,
 * which puts the caller back on a whole PUT. Guessing would silently leave the server's
 * old value in place forever.
 *
 * A passage disappearing is expressible and is `removed`.
 */
export function diffFromSnapshot(
	base: StorySnapshot,
	next: Story
): StoryPatch | undefined {
	const scalars = storyScalars(next);
	const story: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(scalars)) {
		if (base.story[key] !== hashOf(value)) {
			story[key] = value;
		}
	}

	for (const key of Object.keys(base.story)) {
		if (!(key in scalars)) {
			return undefined;
		}
	}

	const changed: Passage[] = [];
	const present = new Set<string>();

	for (const passage of next.passages) {
		present.add(passage.id);

		if (base.passages[passage.id] !== hashOf(passage)) {
			changed.push(passage);
		}
	}

	const removed = Object.keys(base.passages).filter(id => !present.has(id));
	const patch: StoryPatch = {};

	if (changed.length > 0 || removed.length > 0) {
		patch.passages = {
			...(changed.length > 0 ? {changed} : {}),
			...(removed.length > 0 ? {removed} : {})
		};
	}

	if (Object.keys(story).length > 0) {
		patch.story = story as StoryPatch['story'];
	}

	return patch;
}

/**
 * The snapshot, but only while it still describes what the record claims to have pushed.
 *
 * One guard in one place. Every path that writes a `pushedHash` without also writing a
 * snapshot — a pull, a checkout, a publish, a resolve — invalidates the base for free,
 * and the cost of being wrong here is a passage silently removed on the server, so the
 * check is a comparison rather than a convention anybody has to remember.
 */
export function usableSnapshot(
	snapshot: StorySnapshot | undefined,
	pushedHash: string
): StorySnapshot | undefined {
	return snapshot && snapshot.hash === pushedHash ? snapshot : undefined;
}

/** The story-to-story form. `undefined` for the same reason as `diffFromSnapshot`. */
export function diffPassages(
	base: Story,
	next: Story
): StoryPatch | undefined {
	return diffFromSnapshot(snapshotStory(base), next);
}

/** Does this patch ask for anything? An empty one is a legal write that bumps the rev. */
export function patchIsEmpty(patch: StoryPatch): boolean {
	const {changed = [], removed = []} = patch.passages ?? {};

	return (
		changed.length === 0 &&
		removed.length === 0 &&
		Object.keys(patch.story ?? {}).length === 0
	);
}

/**
 * Fold a patch into a story. The client-side mirror of `applyStoryPatch` /
 * `patchPassages` in `server/store/patch.go`, rule for rule:
 *
 *   - `patch.story` keys are folded in; `passages` there is refused, because it would be
 *     two answers to one question settled by whichever branch ran last.
 *   - removals happen FIRST, and naming a passage that is already gone is not an error —
 *     two clients deleting the same passage is an ordinary race and the end state both
 *     asked for is the one that happens.
 *   - a changed passage is replaced WHERE IT STANDS and a new one is appended. Array
 *     order is not meaningful to the player, but it is what a revision-history diff
 *     compares, and reordering on every autosave would make every patch look like a
 *     change to every passage.
 *
 * Pure: `base` is not mutated, and neither are the passage objects in it.
 */
export function applyPassageDiff(base: Story, patch: StoryPatch): Story {
	const story: Story = {...base};

	for (const [key, value] of Object.entries(patch.story ?? {})) {
		if (key === 'passages') {
			throw new Error(
				'patch.story may not carry `passages` — use patch.passages'
			);
		}

		(story as unknown as Record<string, unknown>)[key] = value;
	}

	const {changed = [], removed = []} = patch.passages ?? {};

	if (changed.length === 0 && removed.length === 0) {
		story.passages = [...base.passages];

		return story;
	}

	const gone = new Set(removed);
	const passages = base.passages.filter(passage => !gone.has(passage.id));
	const at = new Map<string, number>();

	passages.forEach((passage, index) => at.set(passage.id, index));

	for (const passage of changed) {
		const index = at.get(passage.id);

		if (index === undefined) {
			at.set(passage.id, passages.length);
			passages.push(passage);
		} else {
			passages[index] = passage;
		}
	}

	story.passages = passages;

	return story;
}
