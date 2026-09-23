/**
 * Restoring a thread: hand the model the conversation it is being dropped into.
 *
 * The Live API has `sessionResumption`, and it is the wrong tool here. A handle resumes a
 * session that already existed, expires two hours after that session ended, and is the
 * server's own state — none of which survives the author closing the laptop and picking a
 * thread back up on Tuesday. Replay does.
 *
 * ONE user turn, not a replay of each role in order. The API is strict about turn
 * sequences and a rejected `clientContent` does not error — it hangs the turn, silently,
 * which is the worst failure this feature could have. A single narrated block has no
 * sequence to get wrong.
 *
 * `turnComplete: false`, so the model reads the history and waits, rather than answering a
 * question the author asked yesterday.
 */

import type {TranscriptRow} from '../voice.types';

/** Rows replayed. Older than this and the seed costs more context than it is worth. */
export const MAX_SEED_ROWS = 120;

function clock(at: number): string {
	const date = new Date(at);

	return `${String(date.getHours()).padStart(2, '0')}:${String(
		date.getMinutes()
	).padStart(2, '0')}`;
}

/** One row, as the model should read it. `undefined` for a row it should not see. */
function line(row: TranscriptRow): string | undefined {
	const text = row.text.trim();

	switch (row.kind) {
		case 'user':
			return text === '' ? undefined : `[${clock(row.at)}] author: ${text}`;
		case 'model':
			return text === '' ? undefined : `[${clock(row.at)}] you: ${text}`;
		case 'tool':
			// Tool rows are the ones worth the tokens: they are what actually changed in
			// the story, and the author will refer back to them ("undo that bit where…").
			return `[${clock(row.at)}] you called ${row.tool}(${JSON.stringify(
				row.args ?? {}
			)}) → ${row.error ? `error: ${row.error}` : text}`;
		case 'system':
			// Connection notices, microphone errors, checkpoint labels. Ours, not the
			// conversation's.
			return undefined;
	}
}

/** The seed block as plain text, or `undefined` when there is nothing to say. */
export function seedText(rows: TranscriptRow[]): string | undefined {
	const lines = rows
		.slice(-MAX_SEED_ROWS)
		.map(line)
		.filter((entry): entry is string => entry !== undefined);

	if (lines.length === 0) {
		return undefined;
	}

	return [
		'This conversation is being resumed. Everything below already happened — it is ' +
			'context, not a new instruction. Do not act on it and do not reply to it. Wait ' +
			'for the author to speak.',
		'',
		'The story may have changed since. Call `map` before you act on anything here.',
		'',
		...lines
	].join('\n');
}

/**
 * The wire message. `undefined` when the thread has nothing in it worth replaying, so the
 * caller sends nothing at all rather than an empty turn.
 */
export function seedTurnMessage(
	rows: TranscriptRow[]
): Record<string, unknown> | undefined {
	const text = seedText(rows);

	if (text === undefined) {
		return undefined;
	}

	return {
		clientContent: {
			turnComplete: false,
			turns: [{parts: [{text}], role: 'user'}]
		}
	};
}
