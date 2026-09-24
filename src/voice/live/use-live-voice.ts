/**
 * Mic, socket and runner — TWO switches, not one.
 *
 * The socket is what the author is talking to; the microphone is only one of the two ways
 * to reach it. Typing is the other, and it works with the microphone off, so `connect`
 * and `startMic` are separate: a typed session opens a socket and never touches the
 * recording light.
 *
 * Off still means OFF for the microphone: `stopMic` stops the TRACK, so the operating
 * system's indicator goes out. There is no muted-but-open mic, because an author cannot
 * verify a flag and will not trust a microphone they cannot verify is off. The socket
 * outliving it is visible in the panel and costs no privacy — nothing is being recorded.
 */

import * as React from 'react';
import {openMic, SpeechPlayer} from './audio';
import {connectLive} from './live-client';
import type {LiveClient, LiveState} from './live-client';
import type {MicStream} from './audio';
import {systemInstruction} from './system-instruction';
import {voiceTools} from '../tools';
import type {ToolResult, TranscriptRow, VoiceUsage} from '../voice.types';

export interface UseLiveVoiceOptions {
	apiKey: string;
	model?: string;
	/** Runs a tool and records it in the transcript. `VoiceSession.call`. */
	onCall: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
	/** Anything worth a transcript row that is not a tool call. */
	onSay: (kind: 'user' | 'model' | 'system', text: string) => void;
	/** The model's turn ended. Re-arms the runner's per-turn caps. */
	onTurnComplete: () => void;
	sceneNames: string[];
	/**
	 * The rows the session should open already knowing — a restored thread. Read when the
	 * socket opens, not when the panel renders, so restoring a thread and then talking
	 * seeds the right conversation.
	 */
	seed?: () => TranscriptRow[];
	storyName: string;
}

export interface LiveVoice {
	/** Open the socket without the microphone, for an author who would rather type. */
	connect: () => Promise<void>;
	/** Is there a session to talk to at all? True while it is still connecting. */
	connected: boolean;
	detail?: string;
	/** Is the microphone TRACK open? Not a mute flag — see the file comment. */
	micOn: boolean;
	/** Reset when the socket closes: it is the SOCKET's context, not the thread's. */
	usage?: VoiceUsage;
	/** Type at the model. Queued if the socket is still opening. */
	sendText: (text: string) => void;
	/** Connect if needed, then open the microphone. */
	startMic: () => Promise<void>;
	state: LiveState;
	/** Close the socket and the microphone both. */
	stop: () => void;
	/** Stop the microphone track and keep the session. */
	stopMic: () => void;
}

export function useLiveVoice(options: UseLiveVoiceOptions): LiveVoice {
	const [state, setState] = React.useState<LiveState>('off');
	const [detail, setDetail] = React.useState<string>();
	const [usage, setUsage] = React.useState<VoiceUsage>();
	const [micOn, setMicOn] = React.useState(false);
	const client = React.useRef<LiveClient>();
	const mic = React.useRef<MicStream>();
	const player = React.useRef<SpeechPlayer>();
	// Mirror, so `start` can be memoised on nothing: rebuilding it would tear the socket
	// down on every keystroke in the transcript.
	const optionsRef = React.useRef(options);

	optionsRef.current = options;

	const stopMic = React.useCallback(() => {
		mic.current?.stop();
		mic.current = undefined;
		setMicOn(false);
	}, []);

	const stop = React.useCallback(() => {
		mic.current?.stop();
		mic.current = undefined;
		setMicOn(false);
		player.current?.close();
		player.current = undefined;
		client.current?.close();
		client.current = undefined;
		setState('off');
		setDetail(undefined);
		setUsage(undefined);
	}, []);

	/**
	 * Open the socket, or do nothing if it is already open. Returns whether there is a
	 * session to send to — a caller that is about to send a turn has to know.
	 */
	const connect = React.useCallback(async (): Promise<boolean> => {
		if (client.current) {
			return true;
		}

		const current = optionsRef.current;

		if (current.apiKey.trim() === '') {
			setState('error');
			setDetail('no API key');
			return false;
		}

		const speech = new SpeechPlayer();

		player.current = speech;

		const live = connectLive({
			apiKey: current.apiKey.trim(),
			model: current.model,
			onAudio: chunk => speech.push(chunk),
			onCall: async call => optionsRef.current.onCall(call.name, call.args),
			onInterrupt: () => speech.interrupt(),
			onState: (next, why) => {
				setState(next);
				setDetail(why);

				if (why) {
					optionsRef.current.onSay('system', why);
				}
			},
			onTranscript: (role, text) => optionsRef.current.onSay(role, text),
			onTurnComplete: () => optionsRef.current.onTurnComplete(),
			onUsage: setUsage,
			seed: optionsRef.current.seed?.(),
			systemInstruction: systemInstruction({
				sceneNames: current.sceneNames,
				storyName: current.storyName
			}),
			tools: voiceTools
		});

		client.current = live;
		return true;
	}, []);

	const startMic = React.useCallback(async () => {
		// Whether this call opened the socket decides what a failed microphone leaves
		// behind: a session the author was already typing into stays, one opened purely
		// to talk into does not sit there billing.
		const wasOpen = client.current !== undefined;

		if (!(await connect())) {
			return;
		}

		const live = client.current!;

		if (mic.current) {
			return;
		}

		try {
			mic.current = await openMic(frame => live.sendAudio(frame));
			setMicOn(true);
		} catch (error) {
			// Denied permission, no device, or an insecure origin. All three are the same
			// thing to the author: the microphone did not open.
			if (!wasOpen) {
				stop();
				setState('error');
			}

			setDetail((error as Error).message);
			optionsRef.current.onSay('system', `microphone: ${(error as Error).message}`);
		}
	}, [connect, stop]);

	// A route change or a closed panel must not leave the microphone live.
	React.useEffect(() => stop, [stop]);

	return {
		connect: React.useCallback(async () => {
			await connect();
		}, [connect]),
		connected: state !== 'off' && state !== 'error',
		detail,
		micOn,
		sendText: React.useCallback(text => client.current?.sendText(text), []),
		startMic,
		state,
		stop,
		stopMic,
		usage
	};
}
