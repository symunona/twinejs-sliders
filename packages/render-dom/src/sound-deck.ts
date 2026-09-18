/**
 * The deck: one bed that loops, and one-shots fired over it.
 *
 * It lives in `render-dom` rather than in the format, because BOTH surfaces need it and
 * they must behave identically — the editor's preview is the only place an author ever
 * checks whether a sound lands on the right beat, and a preview that mixes differently
 * from the player is worse than no preview. `render-dom` is already the one piece of code
 * they share, and it is already holding the `AssetResolver` that turns a name into a URL.
 *
 * Chapbook ships a sound bank of its own (`format/src/runtime/sound/`). It is not used
 * here: that one is keyed off story state, is reachable only from prose the scene-only
 * filter strips out of a scene passage anyway, and exists in the player alone.
 *
 * Everything is `<audio>` elements. No AudioContext: a context created outside a user
 * gesture starts suspended, decoding a five-minute bed to PCM costs tens of megabytes, and
 * nothing here needs a graph — this is playback, not synthesis.
 */

import type {AssetResolver, StageSound} from '@sliders/scene-types';

/** How many one-shots may overlap before the oldest is cut. */
const MAX_VOICES = 8;

/** Steps per second while a fade runs. 30 is inaudible as steps and cheap as timers. */
const FADE_HZ = 30;

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 1;
	}

	return Math.min(1, Math.max(0, value));
}

/**
 * Ramps an element's volume and resolves when it lands.
 *
 * Hand-rolled because `<audio>` has no volume automation — the Web Audio graph that does
 * would mean an AudioContext, which is the thing this module is avoiding.
 */
function fadeTo(
	el: HTMLAudioElement,
	target: number,
	seconds: number,
	win: typeof globalThis
): Promise<void> {
	const from = el.volume;
	const to = clamp01(target);

	if (seconds <= 0 || from === to) {
		el.volume = to;
		return Promise.resolve();
	}

	const steps = Math.max(1, Math.round(seconds * FADE_HZ));
	let step = 0;

	return new Promise<void>(resolve => {
		const timer = win.setInterval(() => {
			step++;

			const ratio = step / steps;

			el.volume = clamp01(from + (to - from) * ratio);

			if (step >= steps) {
				win.clearInterval(timer);
				resolve();
			}
		}, 1000 / FADE_HZ);
	});
}

export interface SoundDeckOptions {
	/** The document the elements belong to. Elements are never appended to it — see below. */
	doc?: Document;
	/**
	 * Called when playback was refused for want of a user gesture, so a surface can offer
	 * one. Fires on the first refusal only, until something plays successfully again.
	 */
	onBlocked?: () => void;
}

export class SoundDeck {
	private resolver?: AssetResolver;
	private readonly doc?: Document;
	private readonly win: typeof globalThis;
	private readonly onBlocked?: () => void;

	/** The bed. `wanted` is what the stage asked for, which may not be what is playing yet. */
	private bed?: HTMLAudioElement;
	private wanted?: StageSound;
	/** Bumped on every music change, so a crossfade that has been overtaken can bail. */
	private musicGen = 0;
	private voices: HTMLAudioElement[] = [];
	private muted = true;
	private blocked = false;
	private urls = new Map<string, Promise<string | undefined>>();

	constructor(options: SoundDeckOptions = {}) {
		this.doc = options.doc ?? (typeof document === 'undefined' ? undefined : document);
		this.win = (this.doc?.defaultView ?? globalThis) as typeof globalThis;
		this.onBlocked = options.onBlocked;
	}

	setResolver(resolver: AssetResolver | undefined): void {
		this.resolver = resolver;
		this.urls.clear();
	}

	/**
	 * Muted is the DEFAULT, and deliberately so: an editor that starts playing music because
	 * somebody opened a passage is an editor people mute at the operating system. The player
	 * unmutes as soon as it has a gesture to do it with.
	 */
	setMuted(muted: boolean): void {
		if (this.muted === muted) {
			return;
		}

		this.muted = muted;

		if (muted) {
			this.stopVoices();
			this.bed?.pause();
			return;
		}

		// Unmuting is a gesture, so this is the moment a refused bed can finally start.
		if (this.wanted) {
			void this.play(this.bed, this.wanted.amount);
		}
	}

	isMuted(): boolean {
		return this.muted;
	}

	/** True when something was refused for want of a gesture and is still waiting for one. */
	isBlocked(): boolean {
		return this.blocked;
	}

	/**
	 * Sets the bed to what the stage says it should be.
	 *
	 * The same track at the same volume is a no-op, which is what lets a chapter's worth of
	 * passages each declare `music:` and still play as one unbroken take.
	 */
	async music(sound: StageSound | undefined, seconds = 0): Promise<void> {
		const gen = ++this.musicGen;
		const current = this.wanted;

		this.wanted = sound ? {...sound} : undefined;

		if (current?.id === sound?.id) {
			// Same track: a volume change is a fade, not a restart.
			if (this.bed && sound && current && current.amount !== sound.amount) {
				await fadeTo(this.bed, this.muted ? 0 : sound.amount, seconds, this.win);
			}

			return;
		}

		const previous = this.bed;

		this.bed = undefined;

		if (previous) {
			void fadeTo(previous, 0, seconds, this.win).then(() => {
				previous.pause();
				previous.removeAttribute('src');
			});
		}

		if (!sound) {
			return;
		}

		const el = await this.element(sound.id);

		// A newer music() landed while the URL was resolving. Dropping the element here is
		// the whole reason `musicGen` exists: without it a slow lookup starts a bed that
		// nothing is holding a reference to, and it plays forever.
		if (!el || gen !== this.musicGen) {
			return;
		}

		el.loop = true;
		el.volume = seconds > 0 ? 0 : clamp01(sound.amount);
		this.bed = el;

		await this.play(el, sound.amount);

		if (seconds > 0 && gen === this.musicGen && !this.muted) {
			await fadeTo(el, sound.amount, seconds, this.win);
		}
	}

	/**
	 * Fires a one-shot. Never queues and never waits: a sound that missed its moment is
	 * worse than a sound that did not play.
	 */
	async cue(sound: StageSound): Promise<void> {
		if (this.muted) {
			return;
		}

		const el = await this.element(sound.id);

		if (!el || this.muted) {
			return;
		}

		el.loop = false;
		el.volume = clamp01(sound.amount);

		// Overlap is allowed — two footsteps in a row are two sounds — but not unbounded.
		this.voices.push(el);

		while (this.voices.length > MAX_VOICES) {
			const oldest = this.voices.shift();

			oldest?.pause();
		}

		el.addEventListener('ended', () => {
			this.voices = this.voices.filter(voice => voice !== el);
		});

		await this.play(el, sound.amount);
	}

	/** Everything stops. Called when a stage unmounts, so a closed preview cannot keep playing. */
	stop(): void {
		this.musicGen++;
		this.stopVoices();

		if (this.bed) {
			this.bed.pause();
			this.bed.removeAttribute('src');
			this.bed = undefined;
		}

		this.wanted = undefined;
	}

	private stopVoices(): void {
		for (const voice of this.voices) {
			voice.pause();
		}

		this.voices = [];
	}

	private async play(
		el: HTMLAudioElement | undefined,
		volume: number
	): Promise<void> {
		if (!el || this.muted) {
			return;
		}

		el.volume = clamp01(volume);

		try {
			await el.play();
			this.blocked = false;
		} catch {
			// Autoplay policy, almost always. Not an error worth a console line per sound:
			// the surface asks for a gesture instead, and everything resumes from there.
			if (!this.blocked) {
				this.blocked = true;
				this.onBlocked?.();
			}
		}
	}

	private async element(name: string): Promise<HTMLAudioElement | undefined> {
		const url = await this.url(name);

		if (!url || !this.doc) {
			return undefined;
		}

		const el = this.doc.createElement('audio');

		el.src = url;
		el.preload = 'auto';

		// Never appended to the document. An <audio> element plays perfectly well detached,
		// and appending would put a node inside the stage box that layout, `measure()` and
		// the editor's own hit-testing would all have to learn to ignore.
		return el;
	}

	private url(name: string): Promise<string | undefined> {
		const cached = this.urls.get(name);

		if (cached) {
			return cached;
		}

		const pending = this.resolver
			? this.resolver.url(name).catch(() => undefined)
			: Promise.resolve(undefined);

		this.urls.set(name, pending);
		return pending;
	}
}
