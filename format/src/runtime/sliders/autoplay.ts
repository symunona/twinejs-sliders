/**
 * Can this page start sound before the reader has touched it?
 *
 * Every mainstream browser blocks AUDIBLE autoplay until the user interacts with the page:
 * Chrome / Edge / Opera (unless the site has a high media-engagement score, is an installed
 * PWA, or runs under `--autoplay-policy=no-user-gesture-required`, as kiosks do), Firefox
 * ("Block Audio" by default, per-site override), Safari macOS and iOS (per-site "Allow All
 * Auto-Play"; iOS low-power mode blocks more). Electron and most kiosk shells allow it.
 * Nothing announces the answer up front except Firefox, so it is asked three ways:
 *
 * 1. `navigator.userActivation.hasBeenActive` — the reader already interacted: allowed.
 * 2. `navigator.getAutoplayPolicy('mediaelement')` — Firefox 112+ only (Chrome and Safari
 *    have not shipped it). `allowed-muted` is NOT allowed: the sound deck plays aloud.
 * 3. Play a few milliseconds of silent WAV through an unmuted `<audio>`, the same element
 *    kind the sound deck uses. A `NotAllowedError` means blocked. Any other rejection, a
 *    `play()` that returns nothing and stays paused, or no answer within `PROBE_CAP_MS`
 *    (some engines leave the promise pending) is treated as blocked too: asking for one
 *    click is cheap, a silent opening scene is not.
 *
 * Every step is wrapped. A probe that throws answers `blocked`, never an error screen.
 */

export type AutoplayAnswer = 'allowed' | 'blocked';

export interface AutoplayVerdict {
	answer: AutoplayAnswer;
	/** Which step decided, for the debugger. */
	via: string;
}

const PROBE_CAP_MS = 1500;

interface AutoplayNavigator {
	userActivation?: {hasBeenActive?: boolean};
	getAutoplayPolicy?: (type: string) => string;
}

/** 8 kHz mono 8-bit PCM, 80 samples of silence: a valid WAV every engine decodes. */
export function silentWav(): string {
	const samples = 80;
	const bytes = new Uint8Array(44 + samples);
	const view = new DataView(bytes.buffer);
	const text = (offset: number, value: string) => {
		for (let i = 0; i < value.length; i++) {
			bytes[offset + i] = value.charCodeAt(i);
		}
	};

	text(0, 'RIFF');
	view.setUint32(4, 36 + samples, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 8000, true);
	view.setUint32(28, 8000, true);
	view.setUint16(32, 1, true);
	view.setUint16(34, 8, true);
	text(36, 'data');
	view.setUint32(40, samples, true);
	bytes.fill(128, 44);

	let binary = '';

	bytes.forEach(byte => (binary += String.fromCharCode(byte)));
	return `data:audio/wav;base64,${btoa(binary)}`;
}

async function probeElement(): Promise<AutoplayVerdict> {
	const audio = document.createElement('audio');
	let timer: number | undefined;

	audio.muted = false;
	audio.src = silentWav();

	try {
		const played = audio.play() as Promise<void> | undefined;

		if (!played || typeof played.then !== 'function') {
			// Pre-promise engines: the element itself says whether it started.
			await new Promise(resolve => window.setTimeout(resolve, 50));
			return {answer: audio.paused ? 'blocked' : 'allowed', via: 'probe (no promise)'};
		}

		const answer = await Promise.race<AutoplayVerdict>([
			played.then(() => ({answer: 'allowed' as const, via: 'probe'})),
			new Promise(resolve => {
				timer = window.setTimeout(
					() => resolve({answer: 'blocked', via: 'probe timed out'}),
					PROBE_CAP_MS
				);
			})
		]);

		return answer;
	} catch (error) {
		const name = (error as {name?: string})?.name ?? 'Error';

		return {answer: 'blocked', via: `probe ${name}`};
	} finally {
		window.clearTimeout(timer);

		try {
			audio.pause();
			audio.removeAttribute('src');
			audio.load();
		} catch {
			// A half-torn-down probe is harmless.
		}
	}
}

export async function probeAutoplay(): Promise<AutoplayVerdict> {
	try {
		const nav = navigator as Navigator & AutoplayNavigator;

		if (nav.userActivation?.hasBeenActive) {
			return {answer: 'allowed', via: 'userActivation'};
		}

		if (typeof nav.getAutoplayPolicy === 'function') {
			try {
				const policy = nav.getAutoplayPolicy('mediaelement');

				return {
					answer: policy === 'allowed' ? 'allowed' : 'blocked',
					via: `getAutoplayPolicy ${policy}`
				};
			} catch {
				// Fall through to the probe.
			}
		}

		return await probeElement();
	} catch (error) {
		return {answer: 'blocked', via: `failed: ${(error as Error)?.message}`};
	}
}
