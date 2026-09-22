/**
 * The BidiGenerateContent wire format, as messages rather than as socket calls.
 *
 * Everything in this file is pure — a message in, an object out — so the protocol can be
 * tested without a key, a socket or a microphone, and so the adapter below has nothing in
 * it but plumbing. That split is the reason the one genuinely fiddly part (PCM framing)
 * has tests at all.
 */

import type {VoiceToolDecl} from '../voice.types';
import {INPUT_SAMPLE_RATE} from './models';

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

export interface SetupOptions {
	model: string;
	systemInstruction: string;
	tools: VoiceToolDecl[];
	/** One of the API's voice names. Undefined takes the default. */
	voice?: string;
}

/**
 * The first frame. Nothing else may be sent until `setupComplete` comes back.
 *
 * `responseModalities` takes exactly one entry — asking for AUDIO and TEXT together is
 * rejected, which is why the transcript below is built from the API's own transcription
 * fields rather than from a second modality.
 */
export function setupMessage(options: SetupOptions): Record<string, unknown> {
	return {
		setup: {
			generationConfig: {
				responseModalities: ['AUDIO'],
				...(options.voice
					? {
							speechConfig: {
								voiceConfig: {prebuiltVoiceConfig: {voiceName: options.voice}}
							}
						}
					: {})
			},
			// Both directions, because the panel's transcript is the audit trail and a row
			// that says only "the model spoke" records nothing.
			inputAudioTranscription: {},
			model: `models/${options.model}`,
			outputAudioTranscription: {},
			systemInstruction: {parts: [{text: options.systemInstruction}]},
			tools: [{functionDeclarations: options.tools.map(toFunctionDeclaration)}]
		}
	};
}

/** Our `VoiceToolDecl` in the API's spelling. The rename is the whole adapter. */
export function toFunctionDeclaration(
	tool: VoiceToolDecl
): Record<string, unknown> {
	return {
		description: tool.description,
		name: tool.name,
		parameters: tool.parameters
	};
}

/** A chunk of microphone audio. */
export function audioMessage(base64Pcm: string): Record<string, unknown> {
	return {
		realtimeInput: {
			mediaChunks: [
				{data: base64Pcm, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`}
			]
		}
	};
}

/** A typed turn, for the panel's text box and for anything the author types mid-session. */
export function textTurnMessage(text: string): Record<string, unknown> {
	return {
		clientContent: {
			turnComplete: true,
			turns: [{parts: [{text}], role: 'user'}]
		}
	};
}

/**
 * A picture, as a turn of its own.
 *
 * Sent as a user turn rather than as part of the tool response, because a
 * `functionResponse` carries JSON: an image there would have to be a base64 string the
 * model reads as text, which is not looking at anything.
 */
export function imageTurnMessage(
	base64: string,
	mime: string,
	caption: string
): Record<string, unknown> {
	return {
		clientContent: {
			turnComplete: true,
			turns: [
				{
					parts: [{text: caption}, {inlineData: {data: base64, mimeType: mime}}],
					role: 'user'
				}
			]
		}
	};
}

export function toolResponseMessage(
	responses: {id?: string; name: string; response: unknown}[]
): Record<string, unknown> {
	return {
		toolResponse: {
			functionResponses: responses.map(entry => ({
				id: entry.id,
				name: entry.name,
				// The API wants an object here, always. A bare value is rejected, and a
				// rejected tool response hangs the turn rather than erroring visibly.
				response:
					entry.response !== null && typeof entry.response === 'object'
						? entry.response
						: {result: entry.response}
			}))
		}
	};
}

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

export interface LiveFunctionCall {
	args: Record<string, unknown>;
	id?: string;
	name: string;
}

/** One inbound frame, reduced to what the adapter acts on. */
export interface LiveEvent {
	/** Base64 PCM16 at 24 kHz, in order. */
	audio: string[];
	/** Tool calls the model wants run. */
	calls: LiveFunctionCall[];
	/** Ids of calls it no longer wants — the author interrupted. */
	cancelled: string[];
	error?: string;
	/** The author's own words, as the API heard them. */
	inputText?: string;
	/** The model stopped because the author started talking. Drop queued audio. */
	interrupted: boolean;
	/** What the model said, as text. */
	outputText?: string;
	setupComplete: boolean;
	turnComplete: boolean;
}

const EMPTY: LiveEvent = {
	audio: [],
	calls: [],
	cancelled: [],
	interrupted: false,
	setupComplete: false,
	turnComplete: false
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Read one inbound frame.
 *
 * Tolerant on purpose: this protocol is in preview, fields come and go between model
 * versions, and a parser that threw on an unknown shape would take the session down over
 * a field nobody reads. Anything not recognised is simply absent from the event.
 */
export function parseLiveMessage(raw: string): LiveEvent {
	let message: unknown;

	try {
		message = JSON.parse(raw);
	} catch {
		return {...EMPTY, error: 'the server sent something that is not JSON'};
	}

	const root = asRecord(message);

	if (!root) {
		return {...EMPTY};
	}

	const event: LiveEvent = {
		audio: [],
		calls: [],
		cancelled: [],
		interrupted: false,
		setupComplete: root.setupComplete !== undefined,
		turnComplete: false
	};

	const serverContent = asRecord(root.serverContent);

	if (serverContent) {
		event.interrupted = serverContent.interrupted === true;
		event.turnComplete = serverContent.turnComplete === true;

		const modelTurn = asRecord(serverContent.modelTurn);
		const parts = Array.isArray(modelTurn?.parts) ? modelTurn!.parts : [];

		for (const part of parts) {
			const inline = asRecord(asRecord(part)?.inlineData);

			if (typeof inline?.data === 'string') {
				event.audio.push(inline.data);
			}
		}

		const input = asRecord(serverContent.inputTranscription);
		const output = asRecord(serverContent.outputTranscription);

		if (typeof input?.text === 'string') {
			event.inputText = input.text;
		}

		if (typeof output?.text === 'string') {
			event.outputText = output.text;
		}
	}

	const toolCall = asRecord(root.toolCall);

	if (toolCall && Array.isArray(toolCall.functionCalls)) {
		for (const entry of toolCall.functionCalls) {
			const call = asRecord(entry);

			if (typeof call?.name === 'string') {
				event.calls.push({
					args: asRecord(call.args) ?? {},
					id: typeof call.id === 'string' ? call.id : undefined,
					name: call.name
				});
			}
		}
	}

	const cancellation = asRecord(root.toolCallCancellation);

	if (cancellation && Array.isArray(cancellation.ids)) {
		event.cancelled = cancellation.ids.filter(
			(id): id is string => typeof id === 'string'
		);
	}

	// The API closes with a `goAway` before it drops the socket, which is the only warning
	// a long session gets that its window is up.
	const goAway = asRecord(root.goAway);

	if (goAway) {
		event.error = 'the server is about to close this session';
	}

	return event;
}

// ---------------------------------------------------------------------------
// PCM
// ---------------------------------------------------------------------------

/**
 * Float samples in [-1, 1] to base64 little-endian PCM16, the only format the input side
 * takes.
 *
 * Clamped before scaling: a sample at exactly 1.0 scaled by 32768 overflows to -32768,
 * which is a full-scale click on every loud syllable.
 */
export function floatToPcm16Base64(samples: Float32Array): string {
	const buffer = new ArrayBuffer(samples.length * 2);
	const view = new DataView(buffer);

	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));

		view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
	}

	return base64FromBytes(new Uint8Array(buffer));
}

/** Base64 PCM16 back to floats, for playback. */
export function pcm16Base64ToFloat(base64: string): Float32Array {
	const bytes = bytesFromBase64(base64);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const samples = new Float32Array(Math.floor(bytes.byteLength / 2));

	for (let i = 0; i < samples.length; i++) {
		samples[i] = view.getInt16(i * 2, true) / 0x8000;
	}

	return samples;
}

/**
 * Nearest-neighbour resample. Good enough for speech at these rates, and an order of
 * magnitude less code than an interpolating one — the browser hands us 48 kHz, the API
 * wants 16 kHz, and the ratio is an integer on every machine that matters.
 */
export function resample(
	samples: Float32Array,
	from: number,
	to: number
): Float32Array {
	if (from === to) {
		return samples;
	}

	const ratio = from / to;
	// `ceil`, not `floor`: a frame whose length is not a multiple of the ratio would
	// otherwise be dropped whole, and the last partial frame of every utterance is the
	// end of a word. The read below is guarded, so the tail is padded rather than lost.
	const out = new Float32Array(Math.ceil(samples.length / ratio));

	for (let i = 0; i < out.length; i++) {
		out[i] = samples[Math.floor(i * ratio)] ?? 0;
	}

	return out;
}

/** Chunked, because `String.fromCharCode(...bytes)` blows the stack past ~100k samples. */
export function base64FromBytes(bytes: Uint8Array): string {
	let binary = '';

	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}

	return btoa(binary);
}

export function bytesFromBase64(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	return bytes;
}
