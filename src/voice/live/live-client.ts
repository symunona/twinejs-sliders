/**
 * The Gemini Live socket. The ONLY file in this feature that knows Gemini exists.
 *
 * Everything above it speaks `VoiceToolDecl` and `ToolResult`; everything below it is
 * `protocol.ts`. Swapping providers is replacing this file and `protocol.ts`, and the
 * runner, the panel and the tests do not move — which is the reason the runner was
 * written to be driven by typed text first.
 */

import type {TranscriptRow, VoiceToolDecl, VoiceUsage} from '../voice.types';
import {liveEndpoint, pickLiveModel} from './models';
import {seedTurnMessage} from './seed';
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
	/** What the session has spent, each time the server says. */
	onUsage?: (usage: VoiceUsage) => void;
	/**
	 * A thread being resumed. Replayed as one user turn before the author can talk, so
	 * the model opens knowing what was already said. See `seed.ts`.
	 */
	seed?: TranscriptRow[];
	/** The model finished a turn. Re-arms per-turn caps. */
	onTurnComplete?: () => void;
	/**
	 * A turn, as text. `role` says whose. Both go in the transcript. The API streams
	 * transcription a few words per frame; the adapter joins them and calls this once per
	 * side per turn, or every fragment would be its own chat bubble.
	 */
	onTranscript: (role: 'user' | 'model', text: string) => void;
	systemInstruction: string;
	tools: VoiceToolDecl[];
}

export interface LiveClient {
	close(): void;
	/** Is the socket past `setupComplete`? Typed turns queue until it is. */
	readonly ready: boolean;
	/** A picture, as its own user turn. See `imageTurnMessage`. */
	sendImage(base64: string, mime: string, caption: string): void;
	sendAudio(base64: string): void;
	sendText(text: string): void;
	readonly state: LiveState;
}

/**
 * Pull an inline image off a tool result and REMOVE it, so the bytes travel once.
 *
 * Mutating the result is the point: leaving it in place would send the same picture twice
 * — once as unreadable base64 inside the function response, once as the turn the model can
 * actually see.
 */
function takePicture(
	result: unknown
): {data: string; mime: string} | undefined {
	if (result === null || typeof result !== 'object') {
		return undefined;
	}

	const record = result as Record<string, unknown>;
	const image = record.image;

	if (
		image === null ||
		typeof image !== 'object' ||
		typeof (image as Record<string, unknown>).data !== 'string'
	) {
		return undefined;
	}

	delete record.image;

	const {data, mime} = image as {data: string; mime?: string};

	return {data, mime: mime ?? 'image/png'};
}

/**
 * The server's close reason, with the one case it words badly spelled out. A retired
 * model id closes 1008 "…not found for API version v1beta…", which reads as a wrong
 * endpoint and is not: the path is fine, the id is gone.
 */
export function closeReason(code: number, reason: string, modelId: string): string {
	if (code === 1008 && /not found|not supported/i.test(reason)) {
		return `model ${modelId} is not available on this key — pick another model`;
	}

	return reason || `closed (${code})`;
}

export function connectLive(options: LiveClientOptions): LiveClient {
	const socket = new WebSocket(liveEndpoint(options.apiKey));
	let state: LiveState = 'connecting';
	let ready = false;
	/**
	 * Turns typed before `setupComplete`, in order.
	 *
	 * Audio is dropped rather than queued — see `sendAudio` — but a typed turn is not the
	 * author clearing their throat. Somebody typed a sentence and pressed send; replaying
	 * it a beat later is exactly right, and dropping it loses work.
	 */
	const pending: Record<string, unknown>[] = [];
	/** Frames recorded before `setupComplete`. Dropped, not queued — see `sendAudio`. */
	let closed = false;
	/** Transcription fragments not yet handed on. See `onTranscript`. */
	const heard = {model: '', user: ''};

	const flush = (role: 'user' | 'model') => {
		const text = heard[role].trim();

		heard[role] = '';

		if (text !== '') {
			options.onTranscript(role, text);
		}
	};

	/** `working` because the model is reasoning (`stillThinking`), not because a tool runs. */
	let thinking = false;

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

	/** A turn, held until the session is up. */
	const sendTurn = (message: Record<string, unknown>) => {
		if (ready) {
			send(message);
		} else {
			pending.push(message);
		}
	};

	const model = pickLiveModel(options.model);

	socket.onopen = () =>
		send(
			setupMessage({
				model: model.id,
				systemInstruction: options.systemInstruction,
				thinkingLevel: model.thinkingLevel,
				tools: options.tools
			})
		);

	async function handle(event: LiveEvent): Promise<void> {
		if (event.setupComplete) {
			ready = true;

			// Before `listening`, so there is no window in which the author can talk into
			// a session that does not yet know what thread it is in.
			const seed = options.seed && seedTurnMessage(options.seed);

			if (seed) {
				send(seed);
			}

			setState('listening');

			// After the seed, so a thread being resumed is history BEFORE the sentence
			// that was typed while the socket was still opening.
			for (const message of pending.splice(0)) {
				send(message);
			}
		}

		if (event.usage) {
			options.onUsage?.(event.usage);
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

		if (event.audio.length > 0 && (state !== 'working' || thinking)) {
			thinking = false;
			setState('speaking');
		}

		if (event.inputText) {
			heard.user += event.inputText;
		}

		// The model answering is the end of what the author said; theirs goes first.
		if (event.outputText || event.audio.length > 0 || event.calls.length > 0) {
			flush('user');
		}

		if (event.outputText) {
			heard.model += event.outputText;
		}

		// A tool card between two halves of a sentence would split it anyway, so the text
		// before a call is its own row, in the order it was said.
		if (event.turnComplete || event.interrupted || event.calls.length > 0) {
			flush('user');
			flush('model');
		}

		if (event.turnComplete) {
			options.onTurnComplete?.();

			// Not `working` from a tool: the server sends `turnComplete` right behind a
			// `toolCall`, while the call is still running here.
			if (event.stillThinking) {
				thinking = true;
				setState('working');
			} else if (state === 'speaking' || thinking) {
				thinking = false;
				setState('listening');
			}
		}

		if (event.calls.length === 0) {
			return;
		}

		thinking = false;
		setState('working');

		// Sequentially, not in parallel: two writes to the same passage race through the
		// stories reducer, and the second one's `story()` read would see the first's
		// dispatch only if React had flushed in between. The model asked for them in an
		// order; it gets that order.
		const responses: {id?: string; name: string; response: unknown}[] = [];
		const pictures: {caption: string; data: string; mime: string}[] = [];

		for (const call of event.calls) {
			if (cancelled.has(call.id ?? '')) {
				cancelled.delete(call.id ?? '');
				continue;
			}

			try {
				const result = await options.onCall(call);
				const picture = takePicture(result);

				if (picture) {
					pictures.push({
						caption: `The rendered scene for ${call.name}(${JSON.stringify(
							call.args
						)}).`,
						...picture
					});
				}

				responses.push({id: call.id, name: call.name, response: result});
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

		// AFTER the tool response, never instead of it: a `functionResponse` carries JSON,
		// so an image there is a base64 string the model reads as text, which is not
		// looking at anything. The picture is its own user turn.
		for (const picture of pictures) {
			send(imageTurnMessage(picture.data, picture.mime, picture.caption));
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
		flush('user');
		flush('model');
		setState(
			event.code === 1000 ? 'off' : 'error',
			event.code === 1000 ? undefined : closeReason(event.code, event.reason, model.id)
		);
	};

	return {
		close() {
			flush('user');
			flush('model');
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
		get ready() {
			return ready;
		},
		sendImage(base64, mime, caption) {
			sendTurn(imageTurnMessage(base64, mime, caption));
		},
		sendText(text) {
			sendTurn(textTurnMessage(text));
		},
		get state() {
			return state;
		}
	};
}
