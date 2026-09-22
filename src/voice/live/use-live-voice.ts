/**
 * Mic + socket + runner, as one switch.
 *
 * Off means OFF: the socket is closed and the microphone TRACK is stopped, so the
 * operating system's recording light goes out. There is no idle-but-connected state,
 * because an author cannot verify a flag and will not trust a microphone they cannot
 * verify is off.
 */

import * as React from 'react';
import {openMic, SpeechPlayer} from './audio';
import {connectLive} from './live-client';
import type {LiveClient, LiveState} from './live-client';
import type {MicStream} from './audio';
import {systemInstruction} from './system-instruction';
import {voiceTools} from '../tools';
import type {ToolResult} from '../voice.types';

export interface UseLiveVoiceOptions {
	apiKey: string;
	model?: string;
	/** Runs a tool and records it in the transcript. `VoiceSession.call`. */
	onCall: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
	/** Anything worth a transcript row that is not a tool call. */
	onSay: (kind: 'user' | 'model' | 'system', text: string) => void;
	sceneIds: string[];
	storyName: string;
}

export interface LiveVoice {
	detail?: string;
	on: boolean;
	/** Type at the model rather than talking, with the socket already up. */
	sendText: (text: string) => void;
	start: () => Promise<void>;
	state: LiveState;
	stop: () => void;
}

export function useLiveVoice(options: UseLiveVoiceOptions): LiveVoice {
	const [state, setState] = React.useState<LiveState>('off');
	const [detail, setDetail] = React.useState<string>();
	const client = React.useRef<LiveClient>();
	const mic = React.useRef<MicStream>();
	const player = React.useRef<SpeechPlayer>();
	// Mirror, so `start` can be memoised on nothing: rebuilding it would tear the socket
	// down on every keystroke in the transcript.
	const optionsRef = React.useRef(options);

	optionsRef.current = options;

	const stop = React.useCallback(() => {
		mic.current?.stop();
		mic.current = undefined;
		player.current?.close();
		player.current = undefined;
		client.current?.close();
		client.current = undefined;
		setState('off');
		setDetail(undefined);
	}, []);

	const start = React.useCallback(async () => {
		if (client.current) {
			return;
		}

		const current = optionsRef.current;

		if (current.apiKey.trim() === '') {
			setState('error');
			setDetail('no API key');
			return;
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
			systemInstruction: systemInstruction({
				sceneIds: current.sceneIds,
				storyName: current.storyName
			}),
			tools: voiceTools
		});

		client.current = live;

		try {
			mic.current = await openMic(frame => live.sendAudio(frame));
		} catch (error) {
			// Denied permission, no device, or an insecure origin. All three are the same
			// thing to the author — the microphone did not open — and all three leave a
			// socket behind that would otherwise sit there billing.
			stop();
			setState('error');
			setDetail((error as Error).message);
			optionsRef.current.onSay('system', `microphone: ${(error as Error).message}`);
		}
	}, [stop]);

	// A route change or a closed panel must not leave the microphone live.
	React.useEffect(() => stop, [stop]);

	return {
		detail,
		on: state !== 'off' && state !== 'error',
		sendText: React.useCallback(text => client.current?.sendText(text), []),
		start,
		state,
		stop
	};
}
