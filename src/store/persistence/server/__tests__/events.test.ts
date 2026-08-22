import {
	PING_INTERVAL,
	RECONNECT_DELAYS,
	createEventsSocket,
	eventsUrl,
	type SocketLike
} from '../events';
import type {ServerMessage} from '../server.types';

/**
 * The smallest thing that behaves like a websocket.
 *
 * jsdom has no `WebSocket`, and even where one exists a test that used it would be testing
 * the network. Everything this suite cares about — when a reconnect is scheduled, what
 * goes out on `open`, what comes back in — is visible from here.
 */
class FakeSocket implements SocketLike {
	static instances: FakeSocket[] = [];

	readyState = 0;
	sent: string[] = [];
	closed = false;
	onopen: ((event: unknown) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	onmessage: ((event: {data: unknown}) => void) | null = null;

	constructor(
		readonly url: string,
		readonly protocols: string[]
	) {
		FakeSocket.instances.push(this);
	}

	close() {
		this.closed = true;
		this.readyState = 3;
	}

	send(data: string) {
		this.sent.push(data);
	}

	/** Drives the handshake the way a real socket would. */
	open() {
		this.readyState = 1;
		this.onopen?.({});
	}

	receive(message: ServerMessage | string) {
		this.onmessage?.({
			data: typeof message === 'string' ? message : JSON.stringify(message)
		});
	}

	hangUp() {
		this.readyState = 3;
		this.onclose?.({});
	}

	get messages(): unknown[] {
		return this.sent.map(item => JSON.parse(item));
	}
}

function makeSocket(overrides: {stories?: () => string[]} = {}) {
	return createEventsSocket({
		clientId: 'client-1',
		clientName: 'mira',
		socketFactory: (url, protocols) => new FakeSocket(url, protocols),
		token: 'sekrit',
		url: 'https://example.test',
		...overrides
	});
}

function welcome(socket: FakeSocket) {
	socket.open();
	socket.receive({clients: [], t: 'welcome'});
}

beforeEach(() => {
	FakeSocket.instances = [];
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

describe('eventsUrl', () => {
	it('swaps the scheme and appends the events path', () => {
		expect(eventsUrl('https://example.test')).toBe(
			'wss://example.test/api/v1/events'
		);
		expect(eventsUrl('http://localhost:8080/')).toBe(
			'ws://localhost:8080/api/v1/events'
		);
	});

	it('accepts a URL that already names the API', () => {
		expect(eventsUrl('https://example.test/api/v1')).toBe(
			'wss://example.test/api/v1/events'
		);
	});
});

describe('createEventsSocket', () => {
	it('offers the token as a subprotocol, since a browser cannot send a header', () => {
		makeSocket().connect();

		expect(FakeSocket.instances[0].url).toBe(
			'wss://example.test/api/v1/events'
		);
		expect(FakeSocket.instances[0].protocols).toEqual(['bearer', 'sekrit']);
	});

	it('sends hello with the checked-out story ids on open', () => {
		makeSocket({stories: () => ['story-1', 'story-2']}).connect();
		FakeSocket.instances[0].open();

		expect(FakeSocket.instances[0].messages).toEqual([
			{
				client: 'client-1',
				name: 'mira',
				stories: ['story-1', 'story-2'],
				t: 'hello'
			}
		]);
	});

	it('pings on a timer once open', () => {
		makeSocket().connect();
		FakeSocket.instances[0].open();
		jest.advanceTimersByTime(PING_INTERVAL * 2 + 1);

		expect(
			FakeSocket.instances[0].messages.filter(
				message => (message as {t: string}).t === 'ping'
			)
		).toHaveLength(2);
	});

	it('is not connected until the server says welcome', () => {
		const socket = makeSocket();
		const status = jest.fn();

		socket.onStatus(status);
		socket.connect();
		FakeSocket.instances[0].open();
		expect(socket.connected).toBe(false);

		FakeSocket.instances[0].receive({clients: [], t: 'welcome'});
		expect(socket.connected).toBe(true);
		expect(status).toHaveBeenCalledWith(true);
	});

	it('dispatches parsed messages to every listener', () => {
		const socket = makeSocket();
		const first = jest.fn();
		const second = jest.fn();

		socket.onMessage(first);
		const off = socket.onMessage(second);

		socket.connect();
		welcome(FakeSocket.instances[0]);
		off();
		FakeSocket.instances[0].receive({
			by: 'jules',
			id: 'story-1',
			rev: 4,
			t: 'story'
		});

		expect(first).toHaveBeenLastCalledWith({
			by: 'jules',
			id: 'story-1',
			rev: 4,
			t: 'story'
		});
		// Unsubscribed before the second message, so it only ever saw `welcome`.
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('survives a frame that is not JSON', () => {
		const socket = makeSocket();
		const listener = jest.fn();

		socket.onMessage(listener);
		socket.connect();
		welcome(FakeSocket.instances[0]);
		listener.mockClear();
		FakeSocket.instances[0].receive('} not json {');

		expect(listener).not.toHaveBeenCalled();
	});

	it('reconnects with a growing backoff and never in a tight loop', () => {
		makeSocket().connect();

		for (const [index, delay] of RECONNECT_DELAYS.entries()) {
			expect(FakeSocket.instances).toHaveLength(index + 1);
			FakeSocket.instances[index].hangUp();

			// One tick short of the delay: still nothing.
			jest.advanceTimersByTime(delay - 1);
			expect(FakeSocket.instances).toHaveLength(index + 1);

			jest.advanceTimersByTime(1);
			expect(FakeSocket.instances).toHaveLength(index + 2);
		}

		// Past the end of the table the last delay repeats rather than growing.
		const last = RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1];
		const before = FakeSocket.instances.length;

		FakeSocket.instances[before - 1].hangUp();
		jest.advanceTimersByTime(last - 1);
		expect(FakeSocket.instances).toHaveLength(before);
		jest.advanceTimersByTime(1);
		expect(FakeSocket.instances).toHaveLength(before + 1);
	});

	it('resets the backoff only once the server has said welcome', () => {
		makeSocket().connect();

		// Two failures with no welcome: the delay grows.
		FakeSocket.instances[0].hangUp();
		jest.advanceTimersByTime(RECONNECT_DELAYS[0]);
		FakeSocket.instances[1].hangUp();
		jest.advanceTimersByTime(RECONNECT_DELAYS[1]);
		expect(FakeSocket.instances).toHaveLength(3);

		// A connection that actually worked puts us back at the first delay.
		welcome(FakeSocket.instances[2]);
		FakeSocket.instances[2].hangUp();
		jest.advanceTimersByTime(RECONNECT_DELAYS[0]);
		expect(FakeSocket.instances).toHaveLength(4);
	});

	it('stops pinging a socket that has hung up', () => {
		makeSocket().connect();
		FakeSocket.instances[0].open();
		FakeSocket.instances[0].hangUp();

		const sentSoFar = FakeSocket.instances[0].sent.length;

		jest.advanceTimersByTime(PING_INTERVAL * 3);
		expect(FakeSocket.instances[0].sent).toHaveLength(sentSoFar);
	});

	it('does not reconnect after disconnect', () => {
		const socket = makeSocket();

		socket.connect();
		welcome(FakeSocket.instances[0]);
		socket.disconnect();
		jest.advanceTimersByTime(RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1] * 4);

		expect(FakeSocket.instances).toHaveLength(1);
		expect(socket.connected).toBe(false);
	});

	it('refuses to send when there is no open socket', () => {
		const socket = makeSocket();

		expect(socket.send({t: 'ping'})).toBe(false);

		socket.connect();
		expect(socket.send({t: 'ping'})).toBe(false);

		FakeSocket.instances[0].open();
		expect(socket.send({passage: 'p1', story: 's1', t: 'focus'})).toBe(true);
	});

	it('gives up quietly when the browser has no websocket at all', () => {
		const socket = createEventsSocket({
			clientId: 'client-1',
			clientName: 'mira',
			socketFactory: () => undefined,
			token: 'sekrit',
			url: 'https://example.test'
		});

		socket.connect();
		jest.advanceTimersByTime(RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1] * 4);

		expect(socket.connected).toBe(false);
		expect(socket.send({t: 'ping'})).toBe(false);
	});
});
