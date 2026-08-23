/**
 * The receipt (spec 12 §3): front matter stamped onto a passage as it is handed out, read
 * back when it comes home.
 *
 * The receipt is the whole of the CLI's state. There is no `.twine/` directory and no sync
 * record, so deleting the file loses nothing and copying it somewhere else keeps working.
 * Two consequences shape this module:
 *
 *   - everything below the closing `---` is passage text *verbatim*, trailing newlines and
 *     all. `parse(stamp(x)) === x` has to hold byte for byte or a round trip through the CLI
 *     silently rewrites the author's file.
 *   - `hash` is the full sha256 of the text as handed out, not a short prefix. It is
 *     compared, not read, and a truncated hash would trade a real check for a pretty one.
 */

import {createHash, randomUUID} from 'node:crypto';
import {parse as parseYaml} from 'yaml';
import {CliError, EXIT} from './types';
import type {PassageObject, Receipt, StoryBody} from './types';

const FENCE = '---';

/** sha256 of a passage's text, hex. The comparison `put` and `check` are built on. */
export function hashText(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Short form for humans. Never written to a file — see the header comment. */
export function shortHash(hash: string): string {
	return hash.slice(0, 8);
}

/**
 * YAML plain scalars swallow far too much (`no` is false, `1.0` is a number, a leading `-` is
 * a list). Anything that is not obviously a bare word gets double quoted, which is why the
 * writer is by hand and only the reader is the YAML library's problem.
 */
function scalar(value: string): string {
	const bare = /^[A-Za-z0-9][A-Za-z0-9 _./-]*$/.test(value);
	const reserved = /^(y|n|yes|no|true|false|on|off|null|~)$/i.test(value);
	const numeric = /^[-+]?[0-9]/.test(value) && Number.isFinite(Number(value));

	return bare && !reserved && !numeric ? value : JSON.stringify(value);
}

/**
 * Stamp the front matter and hand back the file `cat` writes.
 *
 * `story` is the story id rather than the ref the user typed: the ref may stop being
 * unambiguous by the time the file is put back, the id never does, and ref resolution tries
 * exact id first so pasting it back into a command still works.
 */
export function stamp(body: StoryBody, passage: PassageObject, rev: number): string {
	const lines = [
		FENCE,
		`story: ${scalar(body.id)}`,
		`passage: ${scalar(passage.name)}`,
		`rev: ${rev}`,
		`hash: ${hashText(passage.text)}`,
		`name: ${scalar(passage.name)}`,
		`tags: [${(passage.tags ?? []).map(scalar).join(', ')}]`,
		`at: [${passage.left ?? 0}, ${passage.top ?? 0}]`,
		FENCE,
		''
	];

	return lines.join('\n') + passage.text;
}

function asTags(value: unknown): string[] | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (Array.isArray(value)) {
		return value.map(entry => String(entry));
	}

	// `tags: combat, night` is what a human types when they edit the file by hand.
	return String(value)
		.split(',')
		.map(tag => tag.trim())
		.filter(tag => tag !== '');
}

function asAt(value: unknown): [number, number] | undefined {
	if (!Array.isArray(value) || value.length < 2) {
		return undefined;
	}

	const left = Number(value[0]);
	const top = Number(value[1]);

	return Number.isFinite(left) && Number.isFinite(top) ? [left, top] : undefined;
}

/** Split a stamped file back into its receipt and the untouched passage text. */
export function parse(fileText: string): {receipt: Receipt; text: string} {
	const lines = fileText.split('\n');

	if (lines[0]?.trimEnd() !== FENCE) {
		throw new CliError('not a `cat` receipt: file does not start with `---`', EXIT.usage);
	}

	let end = -1;

	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trimEnd() === FENCE) {
			end = i;
			break;
		}
	}

	if (end === -1) {
		throw new CliError('not a `cat` receipt: front matter is never closed', EXIT.usage);
	}

	// Rebuild the split rather than joining the tail: the file may end without a newline, and
	// join() would not be able to tell that from a file that ends with one.
	const headerLength = lines.slice(0, end + 1).reduce((sum, line) => sum + line.length + 1, 0);
	const text = fileText.slice(headerLength);

	let front: Record<string, unknown>;

	try {
		front = (parseYaml(lines.slice(1, end).join('\n')) ?? {}) as Record<string, unknown>;
	} catch (error) {
		throw new CliError(`front matter is not valid YAML: ${(error as Error).message}`, EXIT.usage);
	}

	const story = front.story === undefined ? '' : String(front.story);
	const passage = front.passage === undefined ? '' : String(front.passage);
	const hash = front.hash === undefined ? '' : String(front.hash);
	const rev = Number(front.rev);

	if (story === '' || passage === '' || hash === '' || !Number.isFinite(rev)) {
		throw new CliError(
			'receipt is missing one of story, passage, rev, hash',
			EXIT.usage
		);
	}

	const receipt: Receipt = {hash, passage, rev, story};
	const name = front.name === undefined ? undefined : String(front.name);
	const tags = asTags(front.tags);
	const at = asAt(front.at);

	if (name !== undefined) {
		receipt.name = name;
	}

	if (tags !== undefined) {
		receipt.tags = tags;
	}

	if (at !== undefined) {
		receipt.at = at;
	}

	return {receipt, text};
}

/** The editable half of a receipt: change these and `put` renames, retags or moves. */
export type PassageEdits = Pick<Receipt, 'name' | 'tags' | 'at'>;

/**
 * A new body with exactly one passage changed.
 *
 * Everything else — passage order, unknown fields on this passage and on every other, story
 * level keys — is carried through untouched. Reassembling a whole story from files on disk
 * is what deletes the passage a colleague added two minutes ago; splicing cannot.
 */
export function splice(
	body: StoryBody,
	passageName: string,
	newText: string,
	frontMatter?: PassageEdits
): StoryBody {
	const passages = body.passages ?? [];
	const index = passages.findIndex(passage => passage.name === passageName);

	if (index === -1) {
		throw new CliError(
			`passage "${passageName}" is not in "${body.name}" any more`,
			EXIT.notFound
		);
	}

	const current = passages[index];
	const updated: PassageObject = {...current, text: newText};

	if (frontMatter?.name !== undefined && frontMatter.name !== '') {
		updated.name = frontMatter.name;
	}

	if (frontMatter?.tags !== undefined) {
		updated.tags = [...frontMatter.tags];
	}

	if (frontMatter?.at !== undefined) {
		updated.left = frontMatter.at[0];
		updated.top = frontMatter.at[1];
	}

	const next = passages.slice();

	next[index] = updated;

	return {...body, passages: next};
}

/**
 * A body with one passage added. `put --new` is the only caller (spec 12 §3).
 *
 * Creation is explicit for the same reason deletion is: a mistyped ref should be a "no such
 * passage", not a second passage with a typo for a name. The position continues the grid
 * rather than landing at the origin, so a story built entirely by the CLI opens in the
 * editor as a readable row instead of one stack of overlapping cards.
 */
export function addPassage(
	body: StoryBody,
	passageName: string,
	text: string,
	frontMatter?: PassageEdits
): StoryBody {
	const passages = body.passages ?? [];

	if (passages.some(passage => passage.name === passageName)) {
		throw new CliError(`"${passageName}" is already in "${body.name}"`, EXIT.usage);
	}

	const index = passages.length;
	const at = frontMatter?.at ?? [100 + (index % 5) * 150, 100 + Math.floor(index / 5) * 150];

	const passage: PassageObject = {
		id: randomUUID(),
		story: body.id,
		name: frontMatter?.name ?? passageName,
		tags: frontMatter?.tags ?? [],
		text,
		left: at[0],
		top: at[1],
		width: 100,
		height: 100,
		highlighted: false,
		selected: false
	};

	return {...body, passages: [...passages, passage]};
}

/** A body with one passage gone. `put --delete` is the only caller (spec 12 §3). */
export function removePassage(body: StoryBody, passageName: string): StoryBody {
	const passages = body.passages ?? [];
	const next = passages.filter(passage => passage.name !== passageName);

	if (next.length === passages.length) {
		throw new CliError(`passage "${passageName}" is not in "${body.name}"`, EXIT.notFound);
	}

	return {...body, passages: next};
}

export type ThreeWay = 'fresh' | 'stale-elsewhere' | 'conflict';

/**
 * The test `put` and `check` share (spec 12 §3).
 *
 * The story rev is story-wide, so `If-Match` alone calls a conflict every time somebody
 * touches a different passage. The hash of *this* passage is what decides; the rev only
 * separates "nothing moved" from "something moved, but not here".
 *
 * `revNow` is a parameter because a body does not carry its own rev — it comes from the ETag
 * or from `meta.json`, and guessing it from the body would be a lie the caller cannot see.
 */
export function threeWay(bodyNow: StoryBody, receipt: Receipt, revNow: number): ThreeWay {
	const passage = (bodyNow.passages ?? []).find(entry => entry.name === receipt.passage);

	if (!passage) {
		// Renamed or deleted under us. Nothing to splice into, and absence must never be
		// resolved by writing the passage back.
		return 'conflict';
	}

	if (hashText(passage.text) !== receipt.hash) {
		return 'conflict';
	}

	return revNow === receipt.rev ? 'fresh' : 'stale-elsewhere';
}

/** Who last touched the passage, for the conflict report. */
export function passageOf(body: StoryBody, name: string): PassageObject | undefined {
	return (body.passages ?? []).find(passage => passage.name === name);
}
