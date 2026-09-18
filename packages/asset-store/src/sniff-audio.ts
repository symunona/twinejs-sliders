/**
 * Header sniffing for uploaded sounds.
 *
 * Deliberately a separate module from `sniff.ts`: that one exists to answer "can canvas
 * safely re-encode this", a question sound never asks. Here the only job is to recognise a
 * sound at all, because the upload pipeline has to know not to hand the bytes to
 * `createImageBitmap` — which does not merely fail, it fails slowly and logs a warning per
 * file for what is a perfectly good upload.
 *
 * The browser decides what it can actually play. We only decide what this is.
 */

export type SniffedAudioFormat = 'mp3' | 'ogg' | 'wav' | 'm4a' | 'flac';

export interface AudioSniffResult {
	format: SniffedAudioFormat;
	mime: string;
}

const ID3_SIGNATURE = [0x49, 0x44, 0x33]; // "ID3"
const OGG_SIGNATURE = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WAVE_SIGNATURE = [0x57, 0x41, 0x56, 0x45]; // "WAVE"
const FLAC_SIGNATURE = [0x66, 0x4c, 0x61, 0x43]; // "fLaC"
const FTYP_SIGNATURE = [0x66, 0x74, 0x79, 0x70]; // "ftyp", at offset 4

function startsWith(
	bytes: Uint8Array,
	signature: number[],
	offset = 0
): boolean {
	if (bytes.length < offset + signature.length) {
		return false;
	}

	return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * An MPEG audio frame header: eleven set bits, then a version and layer that are not the
 * reserved values. Checked rather than assumed — `0xff` alone is a common first byte.
 */
function looksLikeMpegFrame(bytes: Uint8Array): boolean {
	if (bytes.length < 2 || bytes[0] !== 0xff) {
		return false;
	}

	const second = bytes[1];

	// 111x xxxx — the rest of the sync word.
	if ((second & 0xe0) !== 0xe0) {
		return false;
	}

	// Version 01 and layer 00 are both reserved, so either one means this is not MPEG audio.
	return (second & 0x18) !== 0x08 && (second & 0x06) !== 0x00;
}

/**
 * Identifies a sound from its header bytes, or `undefined` when the file is not one we
 * recognise. Never throws.
 */
export function sniffAudio(
	source: ArrayBuffer | Uint8Array
): AudioSniffResult | undefined {
	const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);

	// ID3 tags ride in front of the first frame, so they are the usual mp3 opener.
	if (startsWith(bytes, ID3_SIGNATURE) || looksLikeMpegFrame(bytes)) {
		return {format: 'mp3', mime: 'audio/mpeg'};
	}

	if (startsWith(bytes, OGG_SIGNATURE)) {
		return {format: 'ogg', mime: 'audio/ogg'};
	}

	if (
		startsWith(bytes, RIFF_SIGNATURE) &&
		startsWith(bytes, WAVE_SIGNATURE, 8)
	) {
		return {format: 'wav', mime: 'audio/wav'};
	}

	if (startsWith(bytes, FLAC_SIGNATURE)) {
		return {format: 'flac', mime: 'audio/flac'};
	}

	// m4a is an MP4 container. Anything with an `ftyp` box whose brand starts "M4A" is one;
	// the video brands (isom, mp42) are left alone on purpose, since a video file dropped on
	// the Sounds tab is a mistake worth letting through as `unknown` rather than renaming.
	if (startsWith(bytes, FTYP_SIGNATURE, 4)) {
		const brand = String.fromCharCode(...bytes.subarray(8, 11));

		if (brand === 'M4A') {
			return {format: 'm4a', mime: 'audio/mp4'};
		}
	}

	return undefined;
}

/** True when a MIME type names a sound, whatever the bytes turned out to be. */
export function isAudioMime(mime: string | undefined): boolean {
	return !!mime && mime.startsWith('audio/');
}

/**
 * How long a sound runs, in seconds, or `undefined` when nothing here can tell.
 *
 * Uses an `<audio>` element rather than `decodeAudioData`: decoding a five-minute music bed
 * to PCM to learn one number costs tens of megabytes, and an AudioContext created outside a
 * user gesture starts suspended anyway. Metadata is all we want, so `preload="metadata"` is
 * all we ask for.
 */
export async function measureAudioDuration(
	blob: Blob
): Promise<number | undefined> {
	if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
		return undefined;
	}

	const url = URL.createObjectURL(blob);
	const audio = document.createElement('audio');

	audio.preload = 'metadata';

	try {
		return await new Promise<number | undefined>(resolve => {
			// A file the browser cannot decode never fires either event on some platforms,
			// and an upload must not hang on a label.
			const timer = setTimeout(() => done(undefined), 5000);

			function done(value: number | undefined) {
				clearTimeout(timer);
				resolve(value);
			}

			audio.addEventListener('loadedmetadata', () =>
				done(Number.isFinite(audio.duration) ? audio.duration : undefined)
			);
			audio.addEventListener('error', () => done(undefined));
			audio.src = url;
		});
	} finally {
		URL.revokeObjectURL(url);
		audio.removeAttribute('src');
	}
}
