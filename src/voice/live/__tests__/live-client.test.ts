/**
 * The adapter's wiring, driven by a fake socket.
 *
 * Audio and a real key are out of reach under jest, but the two things most likely to
 * break silently are not: a seed sent at the wrong moment, and usage that never arrives.
 * Both are ordering bugs, and neither shows up as an error — the session just opens
 * having forgotten the conversation, or the meter never moves.
 */

import {closeReason, connectLive} from '../live-client';
import {liveModels} from '../models';
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

describe('model', () => {
	it('opens on a model the API still lists — the retired default closed 1008', () => {
		const {socket} = open();

		expect(socket.sent[0].setup.model).toBe(`models/${liveModels[0].id}`);
		expect(socket.sent[0].setup.model).not.toBe(
			'models/gemini-live-2.5-flash-preview'
		);
	});

	it('falls back to the default when the saved choice is no longer listed', () => {
		const {socket} = open({model: 'gemini-live-2.5-flash-preview'});

		expect(socket.sent[0].setup.model).toBe(`models/${liveModels[0].id}`);
	});

	it('sends the chosen model with its own thinking level', () => {
		const {socket} = open({model: 'gemini-3.8-live-extended-thinking'});

		expect(socket.sent[0].setup.model).toBe(
			'models/gemini-3.8-live-extended-thinking'
		);
		expect(socket.sent[0].setup.generationConfig.thinkingConfig).toEqual({
			thinkingLevel: 'low'
		});
	});

	it('names the model when the server says it is not found', () => {
		expect(
			closeReason(
				1008,
				'models/x is not found for API version v1beta, or is not supported for bidiGenerateContent.',
				'x'
			)
		).toMatch(/model x is not available/);
		expect(closeReason(1011, 'internal', 'x')).toBe('internal');
		expect(closeReason(1006, '', 'x')).toBe('closed (1006)');
	});

	it('shows the close reason as an error state', () => {
		const details: (string | undefined)[] = [];
		const states: LiveState[] = [];
		const {socket} = open({
			onState: (next: LiveState, detail?: string) => {
				details.push(detail);
				states.push(next);
			}
		});

		socket.onclose?.({code: 1008, reason: 'models/x is not found'});

		expect(states[states.length - 1]).toBe('error');
		expect(details[details.length - 1]).toMatch(/not available/);
	});
});

describe('state', () => {
	it('stays working through the turnComplete that trails a tool call', async () => {
		let release!: () => void;
		const {socket, states} = open({
			onCall: () => new Promise(resolve => (release = () => resolve({ok: true})))
		});

		await socket.deliver({setupComplete: {}});
		const call = socket.deliver({
			toolCall: {functionCalls: [{args: {}, id: 'a', name: 'map'}]}
		});

		await socket.deliver({serverContent: {turnComplete: true}});
		expect(states[states.length - 1]).toBe('working');

		release();
		await call;
		expect(states[states.length - 1]).toBe('listening');
	});

	it('reads as working while an extended-thinking model reasons past its turn', async () => {
		const {socket, states} = open();

		await socket.deliver({setupComplete: {}});
		await socket.deliver({
			serverContent: {interactionStatus: 'IN_PROGRESS', turnComplete: true}
		});
		expect(states[states.length - 1]).toBe('working');

		await socket.deliver({serverContent: {interactionStatus: 'IDLE', turnComplete: true}});
		expect(states[states.length - 1]).toBe('listening');
	});
});

describe('typed turns', () => {
	it('holds a sentence typed before setup and sends it once, in order', async () => {
		const {client, socket} = open();

		client.sendText('rename the tavern');
		expect(socket.keys()).toEqual(['setup']);

		await socket.deliver({setupComplete: {}});
		expect(socket.keys()).toEqual(['setup', 'clientContent']);
		expect(socket.sent[1].clientContent.turns[0].parts[0].text).toBe(
			'rename the tavern'
		);

		client.sendText('and the cellar');
		expect(socket.keys()).toEqual(['setup', 'clientContent', 'clientContent']);
	});

	it('sends the restored thread before the sentence typed while it opened', async () => {
		const {client, socket} = open({
			seed: [row({kind: 'model', text: 'we renamed the tavern'})]
		});

		client.sendText('carry on');
		await socket.deliver({setupComplete: {}});

		const texts = socket.sent
			.slice(1)
			.map((message: any) => message.clientContent.turns[0].parts[0].text);

		expect(texts[0]).toContain('we renamed the tavern');
		expect(texts[1]).toBe('carry on');
	});
});

describe('transcript', () => {
	function openHearing() {
		const said: [string, string][] = [];
		const harness = open({
			onTranscript: (role: 'user' | 'model', text: string) => said.push([role, text])
		});

		return {...harness, said};
	}

	it('joins streamed fragments into one row per side per turn', async () => {
		const {said, socket} = openHearing();

		await socket.deliver({setupComplete: {}});
		await socket.deliver({serverContent: {inputTranscription: {text: 'how many'}}});
		await socket.deliver({serverContent: {inputTranscription: {text: ' passages?'}}});
		await socket.deliver({serverContent: {outputTranscription: {text: 'The story'}}});
		await socket.deliver({
			serverContent: {outputTranscription: {text: ' has one passage.'}}
		});
		expect(said).toEqual([['user', 'how many passages?']]);

		await socket.deliver({serverContent: {turnComplete: true}});
		expect(said).toEqual([
			['user', 'how many passages?'],
			['model', 'The story has one passage.']
		]);
	});

	it('ends the model row at a tool call, so the card lands after what was said', async () => {
		const {said, socket} = openHearing();

		await socket.deliver({setupComplete: {}});
		await socket.deliver({serverContent: {outputTranscription: {text: 'Looking.'}}});
		await socket.deliver({
			toolCall: {functionCalls: [{args: {}, id: 'a', name: 'map'}]}
		});

		expect(said).toEqual([['model', 'Looking.']]);
	});

	it('keeps what was heard when the socket closes mid-turn', async () => {
		const {client, said, socket} = openHearing();

		await socket.deliver({setupComplete: {}});
		await socket.deliver({serverContent: {outputTranscription: {text: 'Half a'}}});
		client.close();

		expect(said).toEqual([['model', 'Half a']]);
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
