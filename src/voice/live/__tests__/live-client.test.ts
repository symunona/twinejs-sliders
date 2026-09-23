/**
 * The adapter's wiring, driven by a fake socket.
 *
 * Audio and a real key are out of reach under jest, but the two things most likely to
 * break silently are not: a seed sent at the wrong moment, and usage that never arrives.
 * Both are ordering bugs, and neither shows up as an error — the session just opens
 * having forgotten the conversation, or the meter never moves.
 */

import {connectLive} from '../live-client';
import type {LiveClient, LiveState} from '../live-client';
import type {TranscriptRow} from '../../voice.types';

class FakeSocket {
	static last: FakeSocket;

	static readonly OPEN = 1;

	readyState = 1;
	sent: Record<string, any>[] = [];
	onopen?: () => void;
	onmessage?: (event: {data: string}) => void | Promise<void>;
	onerror?: () => void;
	onclose?: (event: {code: number; reason?: string}) => void;
	closedWith?: number;

	constructor(public url: string) {
		FakeSocket.last = this;
	}

	send(raw: string) {
		this.sent.push(JSON.parse(raw));
	}

	close(code?: number) {
		this.closedWith = code;
	}

	/** Deliver one server frame and let the adapter's async handler settle. */
	async deliver(message: Record<string, unknown>): Promise<void> {
		await this.onmessage?.({data: JSON.stringify(message)});
		await Promise.resolve();
	}

	/** What was sent, by its single top-level key. */
	keys(): string[] {
		return this.sent.map(message => Object.keys(message)[0]);
	}
}

function row(
	overrides: Partial<TranscriptRow> & Pick<TranscriptRow, 'kind' | 'text'>
): TranscriptRow {
	return {at: Date.now(), id: `row-${Math.random()}`, ...overrides};
}

interface Harness {
	client: LiveClient;
	socket: FakeSocket;
	states: LiveState[];
	usage: unknown[];
}

function open(options: Parameters<typeof connectLive>[0] extends infer T ? Partial<T> : never = {}): Harness {
	const states: LiveState[] = [];
	const usage: unknown[] = [];
	const client = connectLive({
		apiKey: 'test-key',
		onAudio: () => undefined,
		onCall: async () => ({ok: true}),
		onInterrupt: () => undefined,
		onState: next => states.push(next),
		onTranscript: () => undefined,
		onUsage: entry => usage.push(entry),
		systemInstruction: 'be brief',
		tools: [],
		...(options as object)
	});

	const socket = FakeSocket.last;

	socket.onopen?.();

	return {client, socket, states, usage};
}

beforeEach(() => {
	(globalThis as any).WebSocket = FakeSocket;
});

describe('setup', () => {
	it('asks for a sliding context window, so a long session compacts instead of dying', () => {
		const {socket} = open();

		expect(socket.sent[0].setup.contextWindowCompression).toEqual({
			slidingWindow: {}
		});
	});
});

describe('resuming a thread', () => {
	const seed = [row({kind: 'user', text: 'put Mira on the left'})];

	it('seeds the conversation before the author can talk into it', async () => {
		const {socket, states} = open({seed});

		await socket.deliver({setupComplete: {}});

		// The seed must be on the wire BEFORE the panel says it is listening: a frame sent
		// after that races the first thing the author says.
		expect(socket.keys()).toEqual(['setup', 'clientContent']);
		expect(socket.sent[1].clientContent.turnComplete).toBe(false);
		expect(states).toEqual(['connecting', 'listening']);
	});

	it('sends nothing when the thread is empty', async () => {
		const {socket} = open({seed: []});

		await socket.deliver({setupComplete: {}});

		expect(socket.keys()).toEqual(['setup']);
	});

	it('sends nothing when there is no thread at all', async () => {
		const {socket} = open();

		await socket.deliver({setupComplete: {}});

		expect(socket.keys()).toEqual(['setup']);
	});
});

describe('usage', () => {
	it('reports what the session is spending', async () => {
		const {socket, usage} = open();

		await socket.deliver({
			usageMetadata: {
				promptTokenCount: 12_400,
				responseTokenCount: 80,
				totalTokenCount: 12_480
			}
		});

		expect(usage).toEqual([{prompt: 12_400, response: 80, total: 12_480}]);
	});

	it('says nothing on a frame that carries none', async () => {
		const {socket, usage} = open();

		await socket.deliver({serverContent: {turnComplete: true}});

		expect(usage).toEqual([]);
	});
});

describe('tool calls', () => {
	it('answers them in the order they were asked for', async () => {
		const ran: string[] = [];
		const {socket} = open({
			onCall: async (call: {name: string}) => {
				ran.push(call.name);
				return {ok: true};
			}
		});

		await socket.deliver({setupComplete: {}});
		await socket.deliver({
			toolCall: {
				functionCalls: [
					{args: {}, id: 'a', name: 'map'},
					{args: {ref: 'Tavern'}, id: 'b', name: 'read_passage'}
				]
			}
		});

		expect(ran).toEqual(['map', 'read_passage']);
		expect(
			socket.sent[socket.sent.length - 1].toolResponse.functionResponses.map(
				(entry: {name: string}) => entry.name
			)
		).toEqual(['map', 'read_passage']);
	});
});
