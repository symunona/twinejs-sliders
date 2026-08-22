/**
 * The websocket half of server sync (spec 11): the change bus, presence and soft locks.
 *
 * This socket is a *fast path*, never a requirement. `useServerSync` polls `GET /stories`
 * on its own timer and reconciles from that; everything here does is make the same news
 * arrive in a second instead of thirty, and add the ephemeral state — who is here, who has
 * which passage open — that polling cannot carry. So every failure mode below ends in the
 * same place: no socket, no presence, polling still works. A browser with no `WebSocket`
 * at all takes that path from the start.
 *
 * Nothing sent here can write to the server. The hub accepts exactly five messages and
 * ignores anything else; story and asset writes stay on HTTP where auth, size limits,
 * atomic writes and `If-Match` already live.
 */

import {apiBase} from './client';
import type {ClientMessage, ServerMessage} from './server.types';

/**
 * Reconnect delays, in order, in ms. The last one repeats forever.
 *
 * A socket that is refused instantly — server down, token rotated — would otherwise
 * reconnect as fast as the event loop allows and turn a restart into a denial of service
 * against the machine doing the restarting.
 */
export const RECONNECT_DELAYS = [1000, 2000, 5000, 15000];

/** How often to send `{"t":"ping"}`. The hub expires a client after 60 s of silence. */
export const PING_INTERVAL = 20000;

/**
 * The slice of `WebSocket` this module uses.
 *
 * Declared rather than imported so a test can hand in a fake with no `jsdom` websocket, no
 * timers of its own, and no network.
 */
export interface SocketLike {
	readyState: number;
	close(code?: number, reason?: string): void;
	send(data: string): void;
	onopen: ((event: unknown) => void) | null;
	onclose: ((event: unknown) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onmessage: ((event: {data: unknown}) => void) | null;
}

export type SocketFactory = (
	url: string,
	protocols: string[]
) => SocketLike | undefined;

export interface EventsSocketOptions {
	/** The backend URL pref, in any of the shapes `apiBase()` accepts. */
	url: string;
	token: string;
	clientId: string;
	clientName: string;
	/**
	 * Ids of the stories this browser has checked out, read fresh on every `hello`. A
	 * function rather than a value because a reconnect can happen long after construction.
	 */
	stories?: () => string[];
	/** Injected in tests. Defaults to `new WebSocket(...)`, or nothing if there is none. */
	socketFactory?: SocketFactory;
}

export interface EventsSocket {
	/** True only between `welcome` and the socket closing. */
	readonly connected: boolean;
	connect(): void;
	/** Closes and stops reconnecting. `connect()` starts over. */
	disconnect(): void;
	/** Returns false when there was no open socket to send on. */
	send(message: ClientMessage): boolean;
	onMessage(listener: (message: ServerMessage) => void): () => void;
	onStatus(listener: (connected: boolean) => void): () => void;
	dispose(): void;
}

/**
 * `https://host` / `https://host/api/v1` / `http://host` -> the events socket URL.
 *
 * The scheme swap is the only interesting part: a page served over TLS cannot open a
 * cleartext `ws://`, so getting this wrong shows up as a mixed-content error rather than
 * anything that mentions websockets.
 */
export function eventsUrl(url: string): string {
	let base = apiBase(url);

	if (!/^[a-z][a-z0-9+.-]*:/i.test(base)) {
		const origin =
			typeof location === 'undefined' ? 'http://localhost' : location.href;

		base = new URL(base, origin).href.replace(/\/+$/, '');
	}

	const full = `${base}/events`;

	if (/^https:/i.test(full)) {
		return `wss:${full.slice('https:'.length)}`;
	}

	if (/^http:/i.test(full)) {
		return `ws:${full.slice('http:'.length)}`;
	}

	return full;
}

function defaultSocketFactory(
	url: string,
	protocols: string[]
): SocketLike | undefined {
	if (typeof WebSocket === 'undefined') {
		return undefined;
	}

	return new WebSocket(url, protocols) as unknown as SocketLike;
}

const OPEN = 1;

export function createEventsSocket(options: EventsSocketOptions): EventsSocket {
	const factory = options.socketFactory ?? defaultSocketFactory;
	const target = eventsUrl(options.url);
	const messageListeners = new Set<(message: ServerMessage) => void>();
	const statusListeners = new Set<(connected: boolean) => void>();

	let socket: SocketLike | undefined;
	let wanted = false;
	let connected = false;
	let attempt = 0;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let pingTimer: ReturnType<typeof setInterval> | undefined;

	function setConnected(next: boolean) {
		if (connected === next) {
			return;
		}

		connected = next;

		for (const listener of statusListeners) {
			listener(next);
		}
	}

	function emit(message: ServerMessage) {
		for (const listener of messageListeners) {
			listener(message);
		}
	}

	function clearTimers() {
		if (reconnectTimer !== undefined) {
			clearTimeout(reconnectTimer);
			reconnectTimer = undefined;
		}

		if (pingTimer !== undefined) {
			clearInterval(pingTimer);
			pingTimer = undefined;
		}
	}

	function rawSend(message: ClientMessage): boolean {
		if (!socket || socket.readyState !== OPEN) {
			return false;
		}

		try {
			socket.send(JSON.stringify(message));
			return true;
		} catch {
			// A send that throws means the socket died between the readyState check and
			// here. The close handler is about to run and schedule a reconnect.
			return false;
		}
	}

	function scheduleReconnect() {
		if (!wanted || reconnectTimer !== undefined) {
			return;
		}

		const delay =
			RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];

		attempt += 1;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = undefined;
			open();
		}, delay);
	}

	function teardown() {
		if (!socket) {
			return;
		}

		socket.onopen = null;
		socket.onclose = null;
		socket.onerror = null;
		socket.onmessage = null;

		try {
			socket.close();
		} catch {
			// Closing an already-dead socket is not news.
		}

		socket = undefined;
	}

	function handleClose() {
		if (pingTimer !== undefined) {
			clearInterval(pingTimer);
			pingTimer = undefined;
		}

		teardown();
		setConnected(false);
		scheduleReconnect();
	}

	function handleMessage(data: unknown) {
		if (typeof data !== 'string') {
			return;
		}

		let message: ServerMessage;

		try {
			message = JSON.parse(data) as ServerMessage;
		} catch {
			// The hub ignores frames it cannot read and so do we: one bad frame costs its
			// sender its message and nothing else.
			return;
		}

		if (!message || typeof message.t !== 'string') {
			return;
		}

		if (message.t === 'welcome') {
			// The backoff resets here rather than in `onopen`. A socket that opens and is
			// hung up on a moment later — a token the server no longer likes, a proxy
			// that closes idle upgrades — would otherwise reset the delay every time and
			// reconnect forever at one second. `welcome` only arrives after the server
			// has accepted our `hello`, so it is the first proof the connection works.
			attempt = 0;
			setConnected(true);
		}

		emit(message);
	}

	function open() {
		if (!wanted || socket) {
			return;
		}

		let next: SocketLike | undefined;

		try {
			// Browsers cannot set headers on a websocket handshake, so the bearer token
			// rides the subprotocol list: we offer `bearer, <token>` and the server echoes
			// back `bearer` alone. That also means the token must be a legal header token,
			// which the server's generated one is.
			next = factory(target, ['bearer', options.token]);
		} catch {
			next = undefined;
		}

		if (!next) {
			// No `WebSocket` in this browser, or the constructor refused the URL. Stop
			// trying: polling is already covering us and a retry loop would not help.
			wanted = false;
			setConnected(false);
			return;
		}

		socket = next;

		next.onopen = () => {
			rawSend({
				client: options.clientId,
				name: options.clientName,
				stories: options.stories?.() ?? [],
				t: 'hello'
			});

			pingTimer = setInterval(() => rawSend({t: 'ping'}), PING_INTERVAL);
		};
		next.onmessage = event => handleMessage(event?.data);
		next.onerror = () => {
			// `onerror` is always followed by `onclose`, so there is nothing to do here
			// that `handleClose` does not already do.
		};
		next.onclose = () => {
			if (socket === next) {
				handleClose();
			}
		};
	}

	return {
		connect() {
			if (wanted) {
				return;
			}

			wanted = true;
			attempt = 0;
			open();
		},
		get connected() {
			return connected;
		},
		disconnect() {
			wanted = false;
			clearTimers();
			teardown();
			setConnected(false);
		},
		dispose() {
			wanted = false;
			clearTimers();
			teardown();
			connected = false;
			messageListeners.clear();
			statusListeners.clear();
		},
		onMessage(listener) {
			messageListeners.add(listener);

			return () => {
				messageListeners.delete(listener);
			};
		},
		onStatus(listener) {
			statusListeners.add(listener);

			return () => {
				statusListeners.delete(listener);
			};
		},
		send: rawSend
	};
}
