/**
 * Replacing a local story with the server's copy — and knowing whether that worked.
 *
 * # The bug this exists to kill
 *
 * `applyPull` used to dispatch `updateStory` and then write `rev`, `pushedHash`,
 * `lastPulledAt` and fire `notifyStoryPulled`, unconditionally. But the stories reducer is
 * allowed to REFUSE an update, and it refuses silently: `reducer/update-story.ts` returns
 * the state it was handed and `console.warn`s when the incoming `name` already belongs to
 * a different local story. That collision is not hypothetical — `checkoutStory` creates it
 * deliberately, renaming an incoming story so it can sit beside a local one of the same
 * name.
 *
 * So the text never landed, the record said it had, and from then on
 * `server.rev > local.rev` was false forever: no poll and no socket message ever tried
 * again. The story card showed a green "Synced HH:MM" that the failed pull had just
 * refreshed. Nothing anywhere said a word.
 *
 * # How this knows
 *
 * By running the REAL reducer as a dry run over the stories it is about to dispatch
 * against. `updateStory` returns the state array unchanged, by identity, when it refuses,
 * and a fresh array from `state.map` whenever it takes the update — so one identity
 * comparison is an exact answer, taken from the very code that will decide.
 *
 * This is deliberately not a copy of the reducer's conditions. A mirror of a rule in an
 * upstream file is a rule that drifts, and the drift would put back exactly the failure
 * mode above. The dry run costs one `map` over the library.
 *
 * Checking BEFORE dispatching, rather than looking at the store afterwards, is not a
 * shortcut: a React dispatch is not observable on the line after it, and "the store still
 * holds the old text" and "the store has not re-rendered yet" are the same observation.
 *
 * # Renaming
 *
 * A collision is resolved the way `checkoutStory` resolves it, with `unusedName`: the
 * incoming copy takes a free name and the story already wearing that name is untouched.
 * Landing somebody else's text under a suffixed name beats not landing it at all, which
 * is what the bug did.
 *
 * Two things to know about that. The author is told by the name on the card changing —
 * this app has no notification channel, and inventing one for a rare event is not worth
 * the surface. And because `name` is part of `storyHash`, the renamed copy is the one
 * this browser will push next time the author edits it, so the rename eventually reaches
 * the server. That is already true of every checkout; it is noted here because a pull is
 * the quieter of the two.
 */

import {unusedName} from '../../../util/unused-name';
import {reducer as storiesReducer} from '../../stories/reducer';
import type {
	StoriesDispatch,
	Story,
	UpdateStoryAction
} from '../../stories/stories.types';
import type {SyncRecord} from './server.types';
import {logSync} from './sync-log';
import {storyHash, type SyncRecordStore} from './sync-record';

export interface ApplyPulledStoryOptions {
	dispatch: StoriesDispatch;
	/**
	 * Every story this browser holds, read fresh. A thunk rather than an array because the
	 * caller's copy is a ref that a render may have moved since the fetch went out.
	 */
	stories: () => Story[];
	records: SyncRecordStore;
	/** The rev the server answered with. */
	rev: number;
	/** The server's copy of the story. */
	story: Story;
	/** `notifyStoryPulled` — undo for this story is dropped, but only if it landed. */
	onPulled?: (storyId: string) => void;
}

export type PullOutcome =
	| {landed: true; story: Story; renamedFrom?: string}
	| {landed: false; reason: string};

/**
 * Would the stories reducer take this update, or quietly drop it?
 *
 * The reducer itself answers, over a throwaway state. Pure: the only thing `updateStory`
 * touches beyond the array it returns is a `new Date()` for `lastUpdate`, which goes in
 * the bin with the rest of the dry run.
 */
function wouldLand(stories: Story[], action: UpdateStoryAction): boolean {
	return storiesReducer(stories, action) !== stories;
}

/**
 * Best-effort wording for a refusal.
 *
 * The DECISION is the reducer's, taken above; this only puts it into words for the log
 * and the story card's error tooltip. If it ever disagrees with the real reason, the pull
 * is still correctly refused — the message is the part that goes stale, not the
 * behaviour.
 */
function refusalReason(stories: Story[], story: Story, name: string): string {
	if (!stories.some(local => local.id === story.id)) {
		return 'no local copy of this story to update';
	}

	if (stories.some(local => local.id !== story.id && local.name === name)) {
		return `another story here is already called "${name}"`;
	}

	return 'the story store refused the update';
}

/**
 * Should the automatic path (poll, socket) attempt a pull at this server rev?
 *
 * A refusal blocks re-asking at the SAME rev, and only at the same rev. Retrying every
 * sweep would be worse than the bug it replaces: a landed pull clears the story's undo
 * stack (`onStoryPulled`), so a 30 second loop would throw the author's undo history away
 * twice a minute, and a loop that only spends requests still spends one per story per
 * sweep forever. A rev that moves means there is new text to try, so it tries.
 *
 * A server rev BELOW the blocked one is not a fresh chance either — same state, lower
 * number, or a store rebuilt from scratch. An author who wants that story regardless has
 * Checkout, which goes nowhere near this.
 */
export function pullAllowed(record: SyncRecord, serverRev: number): boolean {
	return (
		record.pullBlockedRev === undefined || serverRev > record.pullBlockedRev
	);
}

/**
 * Put the server's copy of a story into the local store, and record it ONLY if it landed.
 */
export function applyPulledStory(
	options: ApplyPulledStoryOptions
): PullOutcome {
	const {dispatch, onPulled, records, rev, story} = options;
	const stories = options.stories();
	const name = unusedName(
		story.name,
		stories.filter(local => local.id !== story.id).map(local => local.name)
	);
	const local: Story = {...story, name, sync: true};
	const action: UpdateStoryAction = {
		props: {...local},
		storyId: story.id,
		type: 'updateStory'
	};

	if (!wouldLand(stories, action)) {
		const reason = refusalReason(stories, story, name);

		logSync('pull', 'refused', story.id, () => ({reason, rev}));
		// No rev, no hash, no `lastPulledAt`: the badge must not read as freshly synced
		// over text that never arrived. `pullBlockedRev` is what stops the retry loop.
		records.update(story.id, {
			lastError: `Could not take the server's copy: ${reason}.`,
			pullBlockedRev: rev,
			state: 'error'
		});

		return {landed: false, reason};
	}

	dispatch(action);
	records.update(story.id, {
		conflictClient: undefined,
		conflictRev: undefined,
		lastError: undefined,
		lastPulledAt: Date.now(),
		pullBlockedRev: undefined,
		pushedHash: storyHash(local),
		rev,
		state: 'idle'
	});
	onPulled?.(story.id);

	const renamedFrom = name === story.name ? undefined : story.name;

	logSync(
		'pull',
		renamedFrom ? 'landed: renamed' : 'landed',
		story.id,
		() => ({rev, ...(renamedFrom ? {from: renamedFrom, to: name} : {})})
	);

	return {landed: true, story: local, ...(renamedFrom ? {renamedFrom} : {})};
}
