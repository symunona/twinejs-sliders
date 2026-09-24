import {MAX_SEED_ROWS, seedText, seedTurnMessage} from '../seed';
import type {TranscriptRow} from '../../voice.types';

let seq = 0;

function row(
	overrides: Partial<TranscriptRow> & Pick<TranscriptRow, 'kind' | 'text'>
): TranscriptRow {
	seq += 1;

	// 10:31 local, whatever the machine's zone is.
	const at = new Date(2026, 8, 22, 10, 31).getTime();

	return {at, id: `row-${seq}`, ...overrides};
}

describe('seedText', () => {
	it('narrates both sides of the conversation', () => {
		const text = seedText([
			row({kind: 'user', text: 'put Mira on the left'}),
			row({kind: 'model', text: 'moved her to the left mark.'})
		])!;

		expect(text).toContain('[10:31] author: put Mira on the left');
		expect(text).toContain('[10:31] you: moved her to the left mark.');
	});

	it('tells the model this is history, not an instruction', () => {
		const text = seedText([row({kind: 'user', text: 'hello'})])!;

		expect(text).toMatch(/already happened/);
		expect(text).toMatch(/Do not act on it/);
		// The story may have moved on since the thread was last open.
		expect(text).toContain('`map`');
	});

	it('keeps tool calls, which are what actually changed the story', () => {
		const text = seedText([
			row({
				args: {beat: 2, scene: 'tavern'},
				kind: 'tool',
				text: 'cast, marks',
				tool: 'set_beat',
				toolKind: 'write'
			})
		])!;

		expect(text).toContain(
			'you called set_beat({"beat":2,"scene":"tavern"}) → cast, marks'
		);
	});

	it('reports a failed call as a failure, not as a result', () => {
		const text = seedText([
			row({
				args: {ref: 'Nowhere'},
				error: 'no passage called Nowhere',
				kind: 'tool',
				text: 'no passage called Nowhere',
				tool: 'read_passage',
				toolKind: 'read'
			})
		])!;

		expect(text).toContain('→ error: no passage called Nowhere');
	});

	it('leaves out our own notices — they are not the conversation', () => {
		const text = seedText([
			row({kind: 'system', text: 'microphone: permission denied'}),
			row({kind: 'user', text: 'hello'})
		])!;

		expect(text).not.toContain('permission denied');
	});

	it('leaves out an empty turn', () => {
		const text = seedText([
			row({kind: 'user', text: '   '}),
			row({kind: 'user', text: 'hello'})
		])!;

		expect(text.match(/author:/g)).toHaveLength(1);
	});

	it('has nothing to say about a thread with nothing in it', () => {
		expect(seedText([])).toBeUndefined();
		expect(seedText([row({kind: 'system', text: 'connected'})])).toBeUndefined();
	});

	it('replays the newest rows when a thread is long', () => {
		const rows = Array.from({length: MAX_SEED_ROWS + 5}, (_unused, index) =>
			row({kind: 'user', text: `line ${index}`})
		);
		const text = seedText(rows)!;

		expect(text).not.toContain('line 0');
		expect(text).toContain(`line ${MAX_SEED_ROWS + 4}`);
	});
});

describe('seedTurnMessage', () => {
	it('is one user turn that does not ask for an answer', () => {
		const message = seedTurnMessage([row({kind: 'user', text: 'hello'})]) as any;

		expect(message.clientContent.turnComplete).toBe(false);
		expect(message.clientContent.turns).toHaveLength(1);
		expect(message.clientContent.turns[0].role).toBe('user');
		expect(message.clientContent.turns[0].parts[0].text).toContain('hello');
	});

	it('sends nothing at all rather than an empty turn', () => {
		expect(seedTurnMessage([])).toBeUndefined();
	});
});
