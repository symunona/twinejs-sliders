/**
 * The deck: music tracks by key, and one-shots fired over them.
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

import type {
	AssetResolver,
	MusicLoop,
	MusicTrack,
	StageMusic,
	StageSound
} from '@sliders/scene-types';

/** How many one-shots may overlap before the oldest is cut. */
const MAX_VOICES = 8;

/** Steps per second while a fade runs. 30 is inaudible as steps and cheap as timers. */
const FADE_HZ = 30;

/**
 * How often a section loop (`loop: {from, to}`) checks whether it has reached `to`, in ms.
 *
 * Polled, not `timeupdate`: that event fires every ~250ms, which overshoots `to` by up to a
 * quarter second — an audible stumble in a bar of music. 25ms is under one beat of a fast
 * tempo's sixteenth note and costs nothing while nothing loops.
 */
const SECTION_POLL_MS = 25;

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 1;
	}

	return Math.min(1, Math.max(0, value));
}

/**
 * Ramps an element's volume and resolves when it lands — `true`, or `false` when a newer
 * ramp on the same element (or a hard stop) took it over first.
 *
 * Hand-rolled because `<audio>` has no volume automation — the Web Audio graph that does
 * would mean an AudioContext, which is the thing this module is avoiding.
 *
 * One ramp per element, ever. Two intervals writing the same `volume` fight: a fade-out
 * started under a still-running fade-in ends at whatever the loser wrote last, which is a
 * track that "stopped" at half volume and plays on forever.
 */
const ramps = new WeakMap<HTMLAudioElement, () => void>();

function cancelRamp(el: HTMLAudioElement): void {
	ramps.get(el)?.();
	ramps.delete(el);
}

function fadeTo(
	el: HTMLAudioElement,
	target: number,
	seconds: number,
	win: typeof globalThis
): Promise<boolean> {
	cancelRamp(el);

	const from = el.volume;
	const to = clamp01(target);

	if (seconds <= 0 || from === to) {
		el.volume = to;
		return Promise.resolve(true);
	}

	const steps = Math.max(1, Math.round(seconds * FADE_HZ));
	let step = 0;

	return new Promise<boolean>(resolve => {
		const timer = win.setInterval(() => {
			step++;

			const ratio = step / steps;

			el.volume = clamp01(from + (to - from) * ratio);

			if (step >= steps) {
				win.clearInterval(timer);
				ramps.delete(el);
				resolve(true);
			}
		}, 1000 / FADE_HZ);

		ramps.set(el, () => {
			win.clearInterval(timer);
			resolve(false);
		});
	});
}

/**
 * One keyed track the deck holds.
 *
 * The OBJECT is the per-key generation guard (what `musicGen` was for the one bed): a slow
 * URL lookup checks `tracks.get(key) === held` when it lands, and anything that replaced or
 * dropped the key in the meantime makes that false. Without it a lookup overtaken by a newer
 * stage starts an element nothing holds a reference to, and it plays forever.
 */
interface HeldTrack {
	key: string;
	/** What the stage asked for, kept current by every `music()` that keeps this take. */
	track: MusicTrack;
	/** The take playing. `newScene()` forgets it, so a scene-top `restart:` lands again. */
	take?: number;
	/** Undefined while the URL resolves. */
	el?: HTMLAudioElement;
	/** Finished plays, for `loop: N`. */
	plays: number;
	/**
	 * Played out and stays out (`loop: false`, or `loop: N` used up). Re-applying the same
	 * state must NOT restart it — a stage re-applied by a scrub, a step back or the next
	 * passage is the same request, not a new one. `restart: true` is the way to hear it again.
	 */
	done: boolean;
	/** The section-loop poll, while one runs. */
	poll?: ReturnType<typeof setInterval>;
}

/** `loop: true` is the element's own loop; every other mode is driven from `ended`. */
function nativeLoop(loop: MusicLoop): boolean {
	return loop === true;
}

function sectionOf(loop: MusicLoop): {from: number; to?: number} | undefined {
	return typeof loop === 'object' && loop !== null ? loop : undefined;
}

/** Total plays a `loop:` allows. Infinity for the modes that never end on their own. */
function playsOf(loop: MusicLoop): number {
	if (loop === false) {
		return 1;
	}

	if (typeof loop === 'number') {
		return Number.isFinite(loop) && loop >= 1 ? Math.floor(loop) : 1;
	}

	return Infinity;
}

function sameLoop(a: MusicLoop, b: MusicLoop): boolean {
	const sa = sectionOf(a);
	const sb = sectionOf(b);

	if (sa || sb) {
		return !!sa && !!sb && sa.from === sb.from && sa.to === sb.to;
	}

	return a === b;
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
	/**
	 * A set, not one callback: a SHARED deck (the player's, see `DomRendererOptions.deck`)
	 * outlives every renderer that draws with it, and each of them wants to hear about a
	 * refusal while it is mounted — and to stop hearing about it once it is gone.
	 */
	private readonly blockedListeners = new Set<() => void>();

	/** Tracks by key, in the order the stage named them. */
	private tracks = new Map<string, HeldTrack>();
	/** Elements fading out after their key went away or was replaced. `stop()` kills them. */
	private leaving = new Set<HTMLAudioElement>();
	private voices: HTMLAudioElement[] = [];
	private muted = true;
	private blocked = false;
	private urls = new Map<string, Promise<string | undefined>>();

	constructor(options: SoundDeckOptions = {}) {
		this.doc = options.doc ?? (typeof document === 'undefined' ? undefined : document);
		this.win = (this.doc?.defaultView ?? globalThis) as typeof globalThis;

		if (options.onBlocked) {
			this.blockedListeners.add(options.onBlocked);
		}
	}

	/**
	 * Same resolver again is a no-op. A shared deck hears this from every renderer on every
	 * apply, and clearing the URL cache each time would re-resolve a playing track's name
	 * for nothing.
	 */
	setResolver(resolver: AssetResolver | undefined): void {
		if (resolver === this.resolver) {
			return;
		}

		this.resolver = resolver;
		this.urls.clear();
	}

	/** Hear about autoplay refusals. Returns the unsubscribe. */
	addBlockedListener(listener: () => void): () => void {
		this.blockedListeners.add(listener);
		return () => {
			this.blockedListeners.delete(listener);
		};
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
			this.killLeaving();

			for (const held of this.tracks.values()) {
				this.stopPoll(held);

				if (held.el) {
					cancelRamp(held.el);
					held.el.pause();
				}
			}

			return;
		}

		// Unmuting is a gesture, so this is the moment a refused track can finally start.
		// Everything the state wants and has an element for: a track still resolving starts
		// itself when it lands, and a played-out one stays out.
		for (const held of this.tracks.values()) {
			if (held.el && !held.done) {
				void this.begin(held, held.el);
			}
		}
	}

	isMuted(): boolean {
		return this.muted;
	}

	/** True when something was refused for want of a user gesture and is still waiting for one. */
	isBlocked(): boolean {
		return this.blocked;
	}

	/** The keys held, in order, and the id each plays. For tests and debugging. */
	held(): {key: string; id: string; take?: number; done: boolean}[] {
		return Array.from(this.tracks.values()).map(held => ({
			done: held.done,
			id: held.track.id,
			key: held.key,
			take: held.take
		}));
	}

	/**
	 * Sets the music to what the stage says it should be, diffed by KEY against what the
	 * deck is holding — not against the previous stage. That is what lets the player hand
	 * one deck from passage to passage: the next scene's `music:` is compared with what is
	 * actually audible, so the same track under the same key plays straight through.
	 *
	 * - key gone: fade out over the OLD track's `fade`.
	 * - key new: start at `start`, fade in over its `fade`.
	 * - same key, other id: crossfade, over the NEW track's `fade`.
	 * - same key, same id, a `take` that differs from the one playing: restart (crossfade
	 *   with itself). That is `restart: true`.
	 * - same key, same id otherwise: keep playing. Volume ramps, loop mode updates live.
	 *
	 * Resolves once every new element is resolved and asked to play. Fades run on after.
	 */
	async music(music: StageMusic | undefined): Promise<void> {
		const wanted = music ?? {};
		const starts: Promise<void>[] = [];

		for (const [key, held] of Array.from(this.tracks)) {
			if (!Object.prototype.hasOwnProperty.call(wanted, key)) {
				this.tracks.delete(key);
				this.retire(held, held.track.fade);
			}
		}

		for (const [key, track] of Object.entries(wanted)) {
			if (!track?.id) {
				continue;
			}

			const held = this.tracks.get(key);

			if (
				!held ||
				held.track.id !== track.id ||
				(track.take !== undefined && track.take !== held.take)
			) {
				if (held) {
					this.retire(held, track.fade);
				}

				starts.push(this.start(key, track));
				continue;
			}

			this.update(held, track);
		}

		// Map order follows the stage's key order, so `held()` reads like the YAML. Re-insert
		// in that order: a kept key would otherwise stay where it was first added.
		const ordered = new Map<string, HeldTrack>();

		for (const key of Object.keys(wanted)) {
			const held = this.tracks.get(key);

			if (held) {
				ordered.set(key, held);
			}
		}

		this.tracks = ordered;
		await Promise.all(starts);
	}

	/**
	 * A new passage begins: forget which take each track is playing.
	 *
	 * Takes are numbered per scene (top = 0, beat `i` = `i + 1`), so the same number in the
	 * next passage is a different request. Forgetting them is what makes a scene-top
	 * `restart: true` restart on EVERY entry, while a track without `restart:` carries on.
	 */
	newScene(): void {
		for (const held of this.tracks.values()) {
			held.take = undefined;
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

		await this.play(el);
	}

	/** Everything stops. Called when a stage unmounts, so a closed preview cannot keep playing. */
	stop(): void {
		this.stopVoices();
		this.killLeaving();

		for (const held of this.tracks.values()) {
			this.stopPoll(held);

			if (held.el) {
				kill(held.el);
			}
		}

		// Emptying the map is also what drops any lookup still in flight: it lands, finds
		// its `HeldTrack` gone, and never plays.
		this.tracks.clear();
	}

	private async start(key: string, track: MusicTrack): Promise<void> {
		const held: HeldTrack = {
			done: false,
			key,
			plays: 0,
			take: track.take,
			track: {...track}
		};

		this.tracks.set(key, held);

		const el = await this.element(track.id);

		// Overtaken while the URL resolved: the key was dropped, replaced or restarted.
		if (!el || this.tracks.get(key) !== held) {
			return;
		}

		held.el = el;
		el.addEventListener('ended', () => this.ended(held, el));

		// The params as they stand NOW: a `music()` that kept this take while the URL was
		// resolving has already updated `held.track`.
		el.loop = nativeLoop(held.track.loop);
		this.rewind(el, held.track.start);

		await this.begin(held, el);
	}

	/** Play from wherever the element stands, fading in from silence over the track's fade. */
	private async begin(held: HeldTrack, el: HTMLAudioElement): Promise<void> {
		if (this.muted) {
			return;
		}

		const fade = held.track.fade;

		cancelRamp(el);
		el.volume = fade > 0 ? 0 : clamp01(held.track.amount);
		await this.play(el);

		if (this.tracks.get(held.key) !== held || this.muted) {
			return;
		}

		this.startPoll(held);

		if (fade > 0) {
			void fadeTo(el, held.track.amount, fade, this.win);
		}
	}

	/** Same take: keep it playing, ramp to the new volume, adopt the new loop mode. */
	private update(held: HeldTrack, track: MusicTrack): void {
		const before = held.track;

		held.track = {...track};

		if (held.take === undefined) {
			// Adopt a take only when none is held: a state that names none (a beat before the
			// restart, re-applied by a scrub) must not erase the one playing, or stepping
			// forward onto the restart beat again would restart it a second time.
			held.take = track.take;
		}

		const el = held.el;

		if (!el) {
			return;
		}

		if (!sameLoop(before.loop, track.loop)) {
			el.loop = nativeLoop(track.loop);
			this.stopPoll(held);

			if (!this.muted && !held.done) {
				this.startPoll(held);
			}
		}

		if (before.amount !== track.amount) {
			if (this.muted || held.done) {
				// Nothing audible to ramp. The next `begin` reads the new amount anyway.
				cancelRamp(el);
			} else {
				void fadeTo(el, track.amount, track.fade, this.win);
			}
		}
	}

	/** Fade a track out over `seconds`, then let go of it. */
	private retire(held: HeldTrack, seconds: number): void {
		this.stopPoll(held);

		const el = held.el;

		if (!el) {
			// Still resolving: removing it from `tracks` already makes the lookup drop it.
			return;
		}

		if (this.muted || held.done || seconds <= 0) {
			kill(el);
			return;
		}

		this.leaving.add(el);
		void fadeTo(el, 0, seconds, this.win).then(landed => {
			this.leaving.delete(el);

			// `false` = a hard stop got here first and has already killed it.
			if (landed) {
				kill(el);
			}
		});
	}

	/**
	 * The file reached its end. `loop: true` never gets here (the element loops itself);
	 * every other mode decides what happens next, reading the loop as it stands NOW, since
	 * a beat may have changed it while the track played.
	 */
	private ended(held: HeldTrack, el: HTMLAudioElement): void {
		if (this.tracks.get(held.key) !== held || held.el !== el) {
			return;
		}

		held.plays++;

		const loop = held.track.loop;
		const section = sectionOf(loop);

		if (section) {
			// No `to`, or a `to` past the end of the file: the end is the loop point.
			this.rewind(el, section.from);
		} else if (held.plays < playsOf(loop)) {
			this.rewind(el, held.track.start);
		} else {
			held.done = true;
			this.stopPoll(held);
			return;
		}

		if (!this.muted) {
			void this.play(el);
		}
	}

	/**
	 * Section loop: jump back to `from` the moment `to` is reached.
	 *
	 * Runs only while a track with a `to` is audible — nothing polls in a silent scene, a
	 * muted deck or for a plain `loop: true`.
	 */
	private startPoll(held: HeldTrack): void {
		const section = sectionOf(held.track.loop);
		const el = held.el;

		if (held.poll !== undefined || !el || section?.to === undefined) {
			return;
		}

		const {from, to} = section;

		held.poll = this.win.setInterval(() => {
			if (el.currentTime >= to) {
				el.currentTime = from;
			}
		}, SECTION_POLL_MS);
	}

	private stopPoll(held: HeldTrack): void {
		if (held.poll !== undefined) {
			this.win.clearInterval(held.poll);
			held.poll = undefined;
		}
	}

	private rewind(el: HTMLAudioElement, seconds: number | undefined): void {
		try {
			// Before metadata has loaded this is the default playback start position, which
			// is exactly what a fresh element wants.
			el.currentTime = Math.max(0, seconds ?? 0);
		} catch {
			// Some engines throw on a seek they cannot do yet. Playing from 0 beats silence.
		}
	}

	private killLeaving(): void {
		for (const el of this.leaving) {
			kill(el);
		}

		this.leaving.clear();
	}

	private stopVoices(): void {
		for (const voice of this.voices) {
			voice.pause();
		}

		this.voices = [];
	}

	private async play(el: HTMLAudioElement): Promise<void> {
		if (this.muted) {
			return;
		}

		try {
			await el.play();
			this.blocked = false;
		} catch {
			// Autoplay policy, almost always. Not an error worth a console line per sound:
			// the surface asks for a gesture instead, and everything resumes from there.
			if (!this.blocked) {
				this.blocked = true;

				for (const listener of this.blockedListeners) {
					listener();
				}
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

/** Silence an element for good: no ramp left running, no download left going. */
function kill(el: HTMLAudioElement): void {
	cancelRamp(el);
	el.pause();
	el.removeAttribute('src');
}
