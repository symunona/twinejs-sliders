/**
 * What an autosave DID, in a few words, for the History dialog.
 *
 * # Why the client says it
 *
 * `History…` lists `when / who / passages / bytes`, and every row looks alike. Finding
 * "the one before I broke the tavern" means restoring rows until one reads right. A
 * sentence per row fixes that, and the client is the only side that can write one cheaply:
 * it already holds both sides of the comparison (`diffFromSnapshot`, `story-diff.ts`),
 * where the server holds an incoming body and would have to diff 100 KB of story on every
 * five-second autosave to say the same thing.
 *
 * It also knows things the bytes do not. A drag is a move, a find & replace is a find &
 * replace, a voice tool call is its own tool name — see `sync-reason.ts`, which carries
 * that half. This file is only the derived half.
 *
 * # Pure
 *
 * No network, no React, no store. It reads the patch the client is already sending plus
 * the story that patch was computed against, and returns a string. The three existing
 * `story-diff.ts` callers are untouched: a summary must never change the patch.
 *
 * # Precedence — one patch, several kinds of change
 *
 * A five-second window can hold a deletion, two new passages and a typed sentence. One
 * row gets one sentence, so the kinds are ranked:
 *
 *     deleted > created > renamed > edited > moved > story settings
 *
 * Rarity and consequence, in that order. A History row is scanned to find the save before
 * something went wrong, and what goes wrong is structural: a passage that is gone, a
 * passage that appeared, a name that changed under the links pointing at it. A text edit
 * is what happens every five seconds, and a pure drag is furniture. So the rarest thing in
 * the patch is the thing worth naming.
 *
 * The LEADER is the first passage of the winning kind, in patch order. `+N more` counts
 * every OTHER passage the patch touched, whatever kind it was — so the number says how big
 * the save was, not how big the winning kind was. `moved` is the one shape with no leader:
 * it wins only when every touched passage merely moved, and then a count is the whole
 * sentence.
 *
 * A passage whose name AND position changed reads as a rename. A move is never the news
 * when something else happened in the same passage.
 *
 * # Clamp
 *
 * 200 bytes, UTF-8, cut on a code point and marked with an ellipsis; control characters
 * collapse to spaces. `server/store` clamps too — this is not a trust boundary — but a
 * passage named with a pasted paragraph should not cost every History row its width.
 */

import {i18n} from '../../../util/i18n';
import type {Passage, Story} from '../../stories';
import type {StoryPatch} from './server.types';
import type {SyncReason} from './sync-reason';

/** Matches the server's clamp. Bytes, not characters: the wire counts bytes. */
export const SUMMARY_MAX_BYTES = 200;

const ELLIPSIS = '…';

/**
 * Ranked, most newsworthy first. The array IS the precedence rule — see the header.
 */
const KIND_ORDER = [
	'deleted',
	'created',
	'renamed',
	'edited',
	'moved'
] as const;

type PassageKind = typeof KIND_ORDER[number];

/**
 * Props that are this browser's view of a passage rather than the passage.
 *
 * Same list `persistable-changes.ts` calls trivial, plus the two that never move. A
 * selection riding along in a patch must not read as an edit.
 */
const IGNORED_PROPS = new Set<string>(['highlighted', 'id', 'selected', 'story']);

const POSITION_PROPS = new Set<string>(['left', 'top']);

interface Touched {
	kind: PassageKind;
	name: string;
	/** The old name, for a rename. */
	from?: string;
}

/** UTF-8 length without a `TextEncoder`, which the jsdom test environment lacks. */
function byteLength(text: string): number {
	let bytes = 0;

	for (const char of text) {
		const code = char.codePointAt(0) as number;

		bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
	}

	return bytes;
}

/**
 * One line, no control characters, at most `SUMMARY_MAX_BYTES` bytes.
 *
 * Exported because a `reason` goes through the same gate: it reaches here from an action
 * creator, and `voice:<tool>` names a tool nobody in this file chose.
 */
export function clampSummary(text: string): string {
	const clean = text
		// eslint-disable-next-line no-control-regex
		.replace(/[\x00-\x1f\x7f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (byteLength(clean) <= SUMMARY_MAX_BYTES) {
		return clean;
	}

	const budget = SUMMARY_MAX_BYTES - byteLength(ELLIPSIS);
	let out = '';
	let bytes = 0;

	for (const char of clean) {
		const size = byteLength(char);

		if (bytes + size > budget) {
			break;
		}

		out += char;
		bytes += size;
	}

	return `${out.trimEnd()}${ELLIPSIS}`;
}

function same(left: unknown, right: unknown): boolean {
	return left === right || JSON.stringify(left) === JSON.stringify(right);
}

/**
 * What kind of change this is, or `undefined` when nothing a person would notice moved.
 *
 * A passage can be in `patch.passages.changed` for a property this does not care about —
 * the snapshot hashes passages WHOLE, deliberately (see `StorySnapshot`), so a `selected`
 * flag is a legitimate reason to resend one. It is not a legitimate reason to say
 * something happened.
 */
function classify(before: Passage, after: Passage): PassageKind | undefined {
	const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
	let moved = false;
	let renamed = false;
	let edited = false;

	for (const key of keys) {
		if (IGNORED_PROPS.has(key)) {
			continue;
		}

		const left = (before as unknown as Record<string, unknown>)[key];
		const right = (after as unknown as Record<string, unknown>)[key];

		if (same(left, right)) {
			continue;
		}

		if (POSITION_PROPS.has(key)) {
			moved = true;
		} else if (key === 'name') {
			renamed = true;
		} else {
			edited = true;
		}
	}

	if (edited) {
		return 'edited';
	}

	if (renamed) {
		return 'renamed';
	}

	return moved ? 'moved' : undefined;
}

function touchedBy(patch: StoryPatch, base: Story): Touched[] {
	const byId = new Map(base.passages.map(passage => [passage.id, passage]));
	const touched: Touched[] = [];

	for (const passage of patch.passages?.changed ?? []) {
		const before = byId.get(passage.id);

		if (!before) {
			touched.push({kind: 'created', name: passage.name});
			continue;
		}

		const kind = classify(before, passage);

		if (!kind) {
			continue;
		}

		touched.push({
			from: kind === 'renamed' ? before.name : undefined,
			kind,
			name: passage.name
		});
	}

	for (const id of patch.passages?.removed ?? []) {
		const before = byId.get(id);

		// A removal the base never held cannot be named, and an id is not a sentence.
		// Silently dropped rather than guessed at: the count below would lie either way.
		if (before) {
			touched.push({kind: 'deleted', name: before.name});
		}
	}

	return touched;
}

/**
 * A sentence for this patch, or `''` when the patch asks for nothing.
 *
 * `base` is the story the patch was computed against — the one the server is holding.
 * Nothing else can say whether a changed passage is new, what a renamed one used to be
 * called, or the name behind a removed id.
 */
export function patchSummary(patch: StoryPatch, base: Story): string {
	const touched = touchedBy(patch, base);
	const kind = KIND_ORDER.find(candidate =>
		touched.some(entry => entry.kind === candidate)
	);

	if (!kind) {
		return Object.keys(patch.story ?? {}).length > 0
			? clampSummary(i18n.t('store.patchSummary.storySettings'))
			: '';
	}

	if (kind === 'moved') {
		// Only reachable when EVERY touched passage merely moved: `moved` is last in
		// `KIND_ORDER`, so anything else in the patch would have won.
		return clampSummary(
			i18n.t('store.patchSummary.moved', {count: touched.length})
		);
	}

	const lead = touched.find(entry => entry.kind === kind) as Touched;
	const headline =
		kind === 'renamed'
			? i18n.t('store.patchSummary.renamed', {from: lead.from, to: lead.name})
			: i18n.t(`store.patchSummary.${kind}`, {name: lead.name});
	const rest = touched.length - 1;

	return clampSummary(
		rest > 0
			? i18n.t('store.patchSummary.more', {count: rest, summary: headline})
			: headline
	);
}

/**
 * A `reason` as words.
 *
 * The reason itself is a wire-ish token — `find-replace`, `voice:patch_scene` — and a
 * History row is read by a person, so it does not travel raw. Known reasons get a locale
 * key; a voice tool keeps its own name, because the tool names belong to voice mode and
 * nothing here can enumerate them.
 */
export function reasonSummary(reason: SyncReason): string {
	if (reason.startsWith('voice:')) {
		return clampSummary(
			i18n.t('store.patchSummary.reason.voice', {tool: reason.slice(6)})
		);
	}

	switch (reason) {
		case 'find-replace':
			return clampSummary(i18n.t('store.patchSummary.reason.findReplace'));
		case 'import':
			return clampSummary(i18n.t('store.patchSummary.reason.import'));
		case 'restore':
			return clampSummary(i18n.t('store.patchSummary.reason.restore'));
		default:
			// Unreachable while `SyncReason` is closed, and harmless if it opens.
			return clampSummary(reason);
	}
}
