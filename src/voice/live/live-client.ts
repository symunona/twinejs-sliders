/**
 * The Gemini Live socket. The ONLY file in this feature that knows Gemini exists.
 *
 * Everything above it speaks `VoiceToolDecl` and `ToolResult`; everything below it is
 * `protocol.ts`. Swapping providers is replacing this file and `protocol.ts`, and the
 * runner, the panel and the tests do not move — which is the reason the runner was
 * written to be driven by typed text first.
 */

import type {VoiceToolDecl} from '../voice.types';
import {defaultLiveModel, liveEndpoint} from './models';
import {
	audioMessage,
	imageTurnMessage,
	parseLiveMessage,
	setupMessage,
	textTurnMessage,
	toolResponseMessage
} from './protocol';
import type {LiveEvent, LiveFunctionCall} from './protocol';

export type LiveState =
	| 'off'
	| 'connecting'
	| 'listening'
	| 'speaking'
	| 'working'
	| 'error';

export interface LiveClientOptions {
	apiKey: string;
	model?: string;
	/** Run a tool. The adapter never decides what a tool means. */
	onCall: (call: LiveFunctionCall) => Promise<unknown>;
	/** Audio to play, base64 PCM16 at 24 kHz. */
	onAudio: (base64: string) => void;
	/** The author stopped the model mid-sentence. Drop queued audio. */
	onInterrupt: () => void;
	onState: (state: LiveState, detail?: string) => void;
	/** A turn, as text. `role` says whose. Both go in the transcript. */
	onTranscript: (role: 'user' | 'model', text: string) => void;
	systemInstruction: string;
	tools: VoiceToolDecl[];
}

export interface LiveClient {
	close(): void;
	/** A picture, as its own user turn. See `imageTurnMessage`. */
	sendImage(base64: string, mime: string, caption: string): void;
	sendAudio(base64: string): void;
	sendText(text: string): void;
	readonly state: LiveState;
}

export function connectLive(options: LiveClientOptions): LiveClient {
	const socket = new WebSocket(liveEndpoint(options.apiKey));
	let state: LiveState = 'connecting';
	let ready = false;
	/** Frames recorded before `setupComplete`. Dropped, not queued — see `sendAudio`. */
	let closed = false;

	const setState = (next: LiveState, detail?: string) => {
		state = next;
		options.onState(next, detail);
	};

	setState('connecting');

	const send = (message: Record<string, unknown>) => {
		if (socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(message));
		}
	};

	socket.onopen = () =>
		send(
			setupMessage({
				model: options.model ?? defaultLiveModel,
				systemInstruction: options.systemInstruction,
				tools: options.tools
			})
		);

	async function handle(event: LiveEvent): Promise<void> {
		if (event.setupComplete) {
			ready = true;
			setState('listening');
		}

		if (event.error) {
			setState('error', event.error);
		}

		if (event.interrupted) {
			options.onInterrupt();
			setState('listening');
		}

		for (const chunk of event.audio) {
			options.onAudio(chunk);
		}

		if (event.audio.length > 0 && state !== 'working') {
			setState('speaking');
		}

		if (event.inputText) {
			options.onTranscript('user', event.inputText);
		}

		if (event.outputText) {
			options.onTranscript('model', event.outputText);
		}

		if (event.turnComplete && state === 'speaking') {
			setState('listening');
		}

		if (event.calls.length === 0) {
			return;
		}

		setState('working');

		// Sequentially, not in parallel: two writes to the same passage race through the
		// stories reducer, and the second one's `story()` read would see the first's
		// dispatch only if React had flushed in between. The model asked for them in an
		// order; it gets that order.
		const responses: {id?: string; name: string; response: unknown}[] = [];

		for (const call of event.calls) {
			if (cancelled.has(call.id ?? '')) {
				cancelled.delete(call.id ?? '');
				continue;
			}

			try {
				responses.push({
					id: call.id,
					name: call.name,
					response: await options.onCall(call)
				});
			} catch (error) {
				responses.push({
					id: call.id,
					name: call.name,
					response: {error: (error as Error).message, ok: false}
				});
			}
		}

		if (responses.length > 0) {
			send(toolResponseMessage(responses));
		}

		if (!closed) {
			setState('listening');
		}
	}

	/** Calls the author interrupted before they ran. */
	const cancelled = new Set<string>();

	socket.onmessage = async message => {
		// The API sends Blobs, not strings, whatever the content actually is.
		const raw =
			typeof message.data === 'string'
				? message.data
				: await (message.data as Blob).text();
		const event = parseLiveMessage(raw);

		for (const id of event.cancelled) {
			cancelled.add(id);
		}

		await handle(event);
	};

	socket.onerror = () =>
		setState('error', 'the connection failed — check the API key and the network');

	socket.onclose = event => {
		if (closed) {
			return;
		}

		closed = true;
		setState(
			event.code === 1000 ? 'off' : 'error',
			event.code === 1000 ? undefined : event.reason || `closed (${event.code})`
		);
	};

	return {
		close() {
			closed = true;
			state = 'off';
			socket.close(1000);
		},
		sendAudio(base64) {
			// Dropped rather than queued: audio recorded before the socket was ready is
			// the author clearing their throat, and replaying it once setup lands makes
			// the model answer a sentence that finished seconds ago.
			if (ready) {
				send(audioMessage(base64));
			}
		},
		sendImage(base64, mime, caption) {
			send(imageTurnMessage(base64, mime, caption));
		},
		sendText(text) {
			send(textTurnMessage(text));
		},
		get state() {
			return state;
		}
	};
}
