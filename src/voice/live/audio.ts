/**
 * Microphone in, model out.
 *
 * Two rules shape this file, and both are about the author's experience rather than the
 * protocol:
 *
 * 1. Echo cancellation is not optional. Without it the model hears its own speech back
 *    through the speakers, treats it as a turn, and answers itself — a loop that reads as
 *    "the AI has gone mad" and is actually a missing constraint. We ask for AEC, and the
 *    panel still says to wear headphones, because AEC on a laptop's own speakers is a
 *    best effort and nothing more.
 *
 * 2. Stopping means the track stops. Not muted, not gain zero — `track.stop()`, so the
 *    operating system's recording indicator goes out. An author cannot verify a flag, and
 *    a microphone they cannot verify is off is a microphone they will not use.
 *
 * Nothing here is provable under jest: `jest-canvas-mock`'s equivalent for audio is that
 * `AudioContext` does not exist at all. The parts that CAN be wrong in an interesting way
 * — framing, resampling, PCM — live in `protocol.ts`, which is tested.
 */

import {
	floatToPcm16Base64,
	pcm16Base64ToFloat,
	resample
} from './protocol';
import {INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE} from './models';

/** ~64 ms of 16 kHz audio. Small enough for barge-in to feel immediate. */
const FRAME_SAMPLES = 1024;

export interface MicStream {
	stop(): void;
}

/**
 * Open the microphone and hand back base64 PCM16 frames at 16 kHz.
 *
 * `ScriptProcessorNode` rather than an `AudioWorklet`: the worklet needs a separate module
 * URL, which means a second build entry and a second thing that can go stale in the
 * service worker's precache. The node is deprecated and has run every voice demo on the
 * web for a decade; when it finally goes, this is one function to replace.
 */
export async function openMic(
	onFrame: (base64: string) => void
): Promise<MicStream> {
	const stream = await navigator.mediaDevices.getUserMedia({
		audio: {
			autoGainControl: true,
			echoCancellation: true,
			noiseSuppression: true
		}
	});
	const context = new AudioContext();
	const source = context.createMediaStreamSource(stream);
	const processor = context.createScriptProcessor(FRAME_SAMPLES * 4, 1, 1);

	processor.onaudioprocess = event => {
		const input = event.inputBuffer.getChannelData(0);

		onFrame(
			floatToPcm16Base64(
				resample(input, context.sampleRate, INPUT_SAMPLE_RATE)
			)
		);
	};

	source.connect(processor);
	// A ScriptProcessor only fires while it is connected to something. Destination with no
	// gain, rather than the speakers, or the author hears themselves at one frame's delay.
	const sink = context.createGain();

	sink.gain.value = 0;
	processor.connect(sink);
	sink.connect(context.destination);

	return {
		stop() {
			processor.onaudioprocess = null;
			processor.disconnect();
			sink.disconnect();
			source.disconnect();
			// The track, not just the graph — this is what puts the hardware light out.
			stream.getTracks().forEach(track => track.stop());
			void context.close();
		}
	};
}

/**
 * Plays the model's speech, gapless, and drops everything queued on a barge-in.
 *
 * Scheduled against `AudioContext.currentTime` rather than played on an `<audio>` element:
 * the model sends speech in chunks as it generates them, and anything that plays a chunk
 * per element leaves an audible seam between each one.
 */
export class SpeechPlayer {
	private context?: AudioContext;
	private playingUntil = 0;
	private sources = new Set<AudioBufferSourceNode>();

	/** Queue one base64 PCM16 chunk at 24 kHz. */
	push(base64: string): void {
		const context = (this.context ??= new AudioContext());
		const samples = pcm16Base64ToFloat(base64);

		if (samples.length === 0) {
			return;
		}

		const buffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);

		buffer.copyToChannel(samples, 0);

		const source = context.createBufferSource();

		source.buffer = buffer;
		source.connect(context.destination);

		// A small floor ahead of `currentTime`, so the first chunk of a turn is not
		// scheduled in the past and dropped.
		const startAt = Math.max(this.playingUntil, context.currentTime + 0.02);

		source.start(startAt);
		this.playingUntil = startAt + buffer.duration;
		this.sources.add(source);
		source.onended = () => this.sources.delete(source);
	}

	/**
	 * Barge-in. Everything already scheduled is thrown away, because the author talked
	 * over a sentence and finishing it is the model talking over them.
	 */
	interrupt(): void {
		this.sources.forEach(source => {
			try {
				source.stop();
			} catch {
				// Already ended. Stopping twice throws and means nothing.
			}
		});
		this.sources.clear();
		this.playingUntil = 0;
	}

	close(): void {
		this.interrupt();
		void this.context?.close();
		this.context = undefined;
	}

	/** Whether anything is still scheduled — the panel's "model speaking" light. */
	get speaking(): boolean {
		return this.sources.size > 0;
	}
}
