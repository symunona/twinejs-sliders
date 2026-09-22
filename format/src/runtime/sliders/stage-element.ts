/**
 * `<sliders-stage>` — one scene, playing.
 *
 * The element owns nothing about scene semantics: `@sliders/scene-core` turns a scene into
 * a list of stages, `@sliders/render-dom` draws one, and this only decides when to move
 * from one to the next. Every beat that says something waits for a click (or the auto
 * advance timer); everything else falls through in the same tick, so a run of stage-only
 * beats is a single transition rather than a stutter.
 */

import {
	applyScene,
	diffStages,
	easeTransitions,
	resolveStage,
	runBeats,
	timeTransitions
} from '@sliders/scene-core';
import {
	DialogueLayer,
	DomRenderer,
	LinkListLayer,
	mergeBubbleStyle
} from '@sliders/render-dom';
import type {LinkListEntry} from '@sliders/render-dom';
import type {Beat, Scene, SceneError, Stage} from '@sliders/scene-types';
import {go} from '../actions';
import {createLoggers} from '../logger';
import {get, set} from '../state';
import {passageNamed} from '../story';
import {CustomElement} from '../util/custom-element';
import {manifestResolver} from './assets';
import {enterCinema, leaveCinema} from './cinema';
import {
	STAGE_VAR,
	autoAdvanceMs,
	fullScreenScenes,
	muted,
	storyBubbleDefaults
} from './config';
import {holdLinkList, releaseLinkList} from './link-list';
import {stageFrom} from './scene-graph';

const {warn} = createLoggers('scene');

/**
 * `navigator.userActivation`, which the DOM lib of the TypeScript this repo pins does not
 * know about yet.
 *
 * Stated here rather than left to the lib because the root `tsconfig.json` does not cover
 * `format/src/runtime` at all: the gap is invisible to the build and to the bundler, and
 * surfaces only under ts-jest — where it failed the compile of every test that so much as
 * imports this file. See `listenForGesture`.
 */
interface ActivationNavigator extends Navigator {
	userActivation?: {hasBeenActive: boolean};
}

/** What the `[scene]` modifier packs into the element's `scene` attribute. */
export interface StagePayload {
	scene: Scene;
	/** Link name -> passage name, with `if:` already evaluated. */
	links?: Record<string, string>;
	/**
	 * The same names, in the order the list is to be drawn in.
	 *
	 * In a menu the order is the content, and `links` cannot carry it: an integer-like key
	 * sits at the FRONT of an object whatever position it was written in. The map is for
	 * lookup by name and nothing else; this is the order.
	 *
	 * It is the order the PARSER produced, which is the YAML's for every ordinary link
	 * name. `Scene.links` is a map as well, so a scene that names its links `1`, `2`, `3`
	 * has already lost the author's order before the modifier sees it — not something this
	 * end can recover, only something it can stop compounding.
	 */
	linkOrder?: string[];
	/**
	 * Draw the list inside the stage box rather than expecting Chapbook markup under it.
	 *
	 * Set by the modifier, which is the one place that can read story state and so the one
	 * place that can answer `show:` (`showSceneLinks`). True means the scene wrote a
	 * `linkList:` block AND the list is to be shown; either half missing and the element
	 * draws nothing, because the markup path has it covered or nobody wanted it.
	 */
	drawLinks?: boolean;
	/** Only sent when `config.testing` is on. */
	errors?: string[];
}

export function encodePayload(payload: StagePayload): string {
	return encodeURIComponent(JSON.stringify(payload));
}

function decodePayload(raw: string): StagePayload | undefined {
	try {
		return JSON.parse(decodeURIComponent(raw));
	} catch (error) {
		warn(`Couldn't read a scene from the page: ${(error as Error).message}`);
		return undefined;
	}
}

/**
 * The entries the stage draws, in the scene's own order.
 *
 * `links` is the modifier's map, already filtered by `if:`, so a gated link that failed its
 * condition is absent here and never reaches the menu — the same pruning the bubbles and
 * the clickable entities get, and the reason a name in `linkOrder` may have no target.
 *
 * `icon:` and `transition:` are merged from the block's defaults HERE rather than at parse
 * time, because the parser leaves them apart on purpose: a scene that inherits its links
 * through `from:` would otherwise inherit the other scene's list style baked into them.
 */
export function linkEntries(
	payload: StagePayload,
	links: Record<string, string>
): LinkListEntry[] {
	const style = payload.scene.linkList;
	const order = payload.linkOrder ?? Object.keys(links);

	return order
		.filter(name => links[name])
		.map(name => {
			const link = payload.scene.links?.[name];

			return {
				name,
				to: links[name],
				icon: link?.icon ?? style?.icon,
				transition: link?.transition ?? style?.transition
			};
		});
}

/** Publishes the stage so a story can read `{sliders.stage}` — debugging, mostly. */
function publishStage(stage: Stage): void {
	set(STAGE_VAR, JSON.stringify(stage));
}

export class SlidersStage extends CustomElement {
	private renderer?: DomRenderer;
	private dialogue?: DialogueLayer;
	private states: Stage[] = [];
	private scene?: Scene;
	private links: Record<string, string> = {};
	private beatIndex = 0;
	/** The Chapbook fork under the stage — only a scene WITHOUT `linkList:` has one. */
	private linkList?: HTMLElement;
	/** The list drawn inside the stage box — only a scene WITH `linkList:` has one. */
	private linkListLayer?: LinkListLayer;
	private linkListEntries: LinkListEntry[] = [];
	private timer?: number;
	private cinema = false;

	private handleClick = (event: MouseEvent) => {
		// A link is a navigation, not an advance — in a bubble (an <a>) or on the stage (an
		// entity carrying `link:`). Tapping anywhere ELSE still advances, which is what lets
		// a clickable door coexist with tap-to-read.
		if (
			!(event.target as HTMLElement | null)?.closest('a, [data-sliders-link]')
		) {
			void this.play();
		}
	};

	/**
	 * Follow a link, from a bubble or from a clickable entity.
	 *
	 * One closure for both, handed to the dialogue layer and to the renderer, so the two
	 * cannot resolve the same name differently. `target` is the passage the author wrote
	 * inline; a bare name is looked up in the scene's link map, which the modifier has
	 * already filtered by `if:` — so a gated link that failed its condition is simply not
	 * there and the click does nothing but say so.
	 */
	/**
	 * A reader's click on a scene `links:` entry, an entity `link:` or a bubble link.
	 *
	 * A link that goes nowhere is a dead click and a warning, never an error screen.
	 * `go()` THROWS on an unknown passage, the throw reaches `window.onerror`, and
	 * `<error-handler>` then paints "An unexpected error has occurred" over the story —
	 * so one typo in one link used to end the reader's session, with everything they had
	 * already read replaced by a box. The passage is checked HERE rather than catching
	 * around `go()`, so only this one miss is survivable: `go()`'s other throw (a `trail`
	 * that is not an array) is a broken engine and still deserves the screen.
	 */
	private followLink = (name: string, target?: string) => {
		const to = target ?? this.links[name];

		if (!to) {
			warn(`The link "${name}" has no \`to:\` in this scene's links.`);
			return;
		}

		if (!passageNamed(to)) {
			warn(`The link "${name}" points at "${to}", which is not a passage.`);
			return;
		}

		go(to);
	};

	/**
	 * The gesture the autoplay policy is waiting for.
	 *
	 * A stage mounts muted and unmutes here rather than trying to play and being refused,
	 * because `setMuted(false)` is what actually starts the bed — so the first sound a
	 * reader hears begins on their first tap instead of never. On the document, not on the
	 * stage: a reader who pressed a key or clicked the page chrome has given the browser
	 * the same permission, and the story's first passage is often not a scene at all.
	 */
	private handleGesture = () => {
		this.unlockSound();
	};

	async connectedCallback() {
		const payload = decodePayload(this.getAttribute('scene') ?? '');

		if (!payload) {
			return;
		}

		if (fullScreenScenes()) {
			this.cinema = true;
			this.style.position = 'absolute';
			enterCinema();
		}

		if (payload.errors?.length) {
			this.renderErrors(payload.errors);
		}

		this.scene = payload.scene;
		this.links = payload.links ?? {};

		// The list under the stage waits for the beats to finish. A scene with NO beats is
		// never held: there is nothing to spoil and nothing to wait for, so it keeps drawing
		// the list the moment the passage renders. Done before the first `await`, and
		// custom element reactions run after the whole passage has been inserted, so the
		// list is never painted in its shown state first.
		if ((payload.scene.beats?.length ?? 0) > 0) {
			this.linkList = holdLinkList(this);
		}

		const base = stageFrom(payload.scene.from);
		const entry = applyScene(base, payload.scene);

		// NOT `[entry, ...runBeats(...)]`: runBeats ALREADY returns the entry state as its
		// first element, so prepending it again made `states[i]` the stage before beat i-1
		// and every beat's staging landed one beat late — the last beat's never landed at
		// all. Loudest with a frame cycle, where "one beat late" means the sprite keeps
		// walking through the line that told it to stop.
		this.states = runBeats(entry, payload.scene.beats ?? []);
		this.beatIndex = 0;
		this.renderer = new DomRenderer({
			guides: Boolean(get('config.testing')),
			onLink: this.followLink
		});
		await this.renderer.mount(this, manifestResolver);
		this.dialogue = new DialogueLayer({onLink: this.followLink});
		this.dialogue.mount(this, this.renderer);

		if (payload.drawLinks) {
			// The SAME `followLink` the bubbles and the clickable entities get, so a name
			// cannot resolve one way in a bubble and another in the menu.
			this.linkListLayer = new LinkListLayer({onLink: this.followLink});
			this.linkListLayer.mount(this, this.renderer);
			this.linkListEntries = linkEntries(payload, this.links);

			// Revealed on the same beat as the markup list (`link-list.ts`): a scene with
			// beats keeps its choices back until they are done, or the menu answers the
			// question before the line that poses it has been read. A scene with no beats
			// has nothing to spoil, so it draws at once.
			if ((payload.scene.beats?.length ?? 0) === 0) {
				this.revealLinkList();
			}
		}

		// The scene enters FROM the stage it inherited, so a character already on stage in
		// the previous scene slides instead of popping.
		const from = resolveStage(base);
		const to = resolveStage(entry);

		await this.renderer.apply(to, diffStages(from, to));
		publishStage(entry);
		this.addEventListener('click', this.handleClick);
		this.listenForGesture();
		void this.play();
	}

	/**
	 * Unmute now if the reader has already interacted with the page, and otherwise as soon
	 * as they do.
	 *
	 * `userActivation.hasBeenActive` is the difference between a story whose second scene
	 * has music and one whose every scene needs its own tap first: activation is sticky for
	 * the document, so a reader who clicked to get here has already paid for it.
	 */
	private listenForGesture() {
		if ((navigator as ActivationNavigator).userActivation?.hasBeenActive) {
			this.unlockSound();
			return;
		}

		document.addEventListener('pointerdown', this.handleGesture, {once: true});
		document.addEventListener('keydown', this.handleGesture, {once: true});
	}

	private unlockSound() {
		// Re-read the config rather than cache it: a vars section in this very passage may
		// have just silenced the chapter.
		this.renderer?.setMuted?.(muted());
	}

	disconnectedCallback() {
		if (this.cinema) {
			this.cinema = false;
			leaveCinema();
		}

		// A stage that leaves must never leave an invisible link list behind it.
		releaseLinkList(this.linkList);
		this.linkList = undefined;
		this.removeEventListener('click', this.handleClick);
		// `once` removes it on the way in, never on the way out — a stage that left before
		// the reader touched anything would otherwise unmute the NEXT stage's renderer
		// through a closure over a destroyed one.
		document.removeEventListener('pointerdown', this.handleGesture);
		document.removeEventListener('keydown', this.handleGesture);
		window.clearTimeout(this.timer);
		this.dialogue?.destroy();
		this.linkListLayer?.destroy();
		this.renderer?.destroy();
		this.dialogue = undefined;
		this.linkListLayer = undefined;
		this.renderer = undefined;
	}

	/** Hand the entries to the layer. Safe to call twice; a scene without one does nothing. */
	private revealLinkList() {
		this.linkListLayer?.set(this.linkListEntries, this.scene?.linkList);
	}

	private renderErrors(errors: string[]) {
		const el = document.createElement('pre');

		el.className = 'sliders-stage__error';
		el.textContent = `This scene has problems:\n\n${errors.join('\n')}`;
		this.append(el);
	}

	/** Run beats until one of them needs to be read, or the scene is over. */
	async play() {
		window.clearTimeout(this.timer);

		const beats: Beat[] = this.scene?.beats ?? [];

		while (this.beatIndex < beats.length) {
			const beat = beats[this.beatIndex];
			const before = this.states[this.beatIndex];
			const after = this.states[this.beatIndex + 1] ?? before;

			this.beatIndex++;

			if (after !== before) {
				const from = resolveStage(before);
				const to = resolveStage(after);

				await this.renderer?.apply(
					to,
					easeTransitions(
						timeTransitions(diffStages(from, to), beat.dur),
						beat.ease,
						this.scene?.ease
					)
				);
				publishStage(after);
			}

			// Before the switch, not inside it: a sound rides on a line, on a stage move or
			// on a beat of its own, and all three arrive here.
			if (beat.sfx) {
				this.renderer?.cue?.(beat.sfx);
			}

			switch (beat.kind) {
				case 'say':
					this.dialogue?.setBox(null);
					this.dialogue?.say(beat.who, beat.text, {
						// Four layers, widest first: the story's `sliders.bubble.*`
						// variables, the scene's own `bubble:`, the speaking character's,
						// then this beat's `as:`/`bubble:`. Merged key by key the whole
						// way, so each one only states what it cares about.
						style: mergeBubbleStyle(
							mergeBubbleStyle(
								this.sceneBubbleDefaults(),
								await this.bubbleDefaults(beat.who)
							),
							beat.style
						)
					});
					this.waitForReader(beat.dur);
					return;

				case 'box':
					this.dialogue?.clear();
					this.dialogue?.setBox(
						beat.text,
						mergeBubbleStyle(this.sceneBubbleDefaults(), beat.style)
					);
					this.waitForReader(beat.dur);
					return;

				case 'wait':
					this.setAttribute('data-waiting', 'timer');
					this.timer = window.setTimeout(
						() => void this.play(),
						beat.seconds * 1000
					);
					return;
			}

			// `set` and `fx` change the stage and fall through in the SAME tick, so the next
			// line lands on top of the move -- unless the author gave the beat a `dur:`,
			// which is how "hold this, then go on" is written without a `- wait:` line
			// underneath it. A `dur: 0` still falls through: zero is a snap, not a pause.
			if (beat.dur !== undefined && beat.dur > 0) {
				this.setAttribute('data-waiting', 'timer');
				this.timer = window.setTimeout(() => void this.play(), beat.dur * 1000);
				return;
			}
		}

		this.removeAttribute('data-waiting');
		// The beats are done, so the choices have stopped being a spoiler. That is one click
		// later than the final line appearing: the last beat always waits for the reader
		// (see `waitForReader`), and the click that used to do nothing but clear the beat
		// marker now brings the list up.
		releaseLinkList(this.linkList);
		this.revealLinkList();
	}

	/** The story's variables with this scene's own `bubble:` over them. */
	private sceneBubbleDefaults() {
		return mergeBubbleStyle(storyBubbleDefaults(), this.scene?.bubble);
	}

	/**
	 * A speaker's own bubble defaults.
	 *
	 * The entity on stage first, since it is already resolved, then the cast manifest — a
	 * narrator speaks without standing anywhere, and their character exists only in the
	 * manifest.
	 */
	private async bubbleDefaults(who: string) {
		const onStage = this.renderer?.characterOf(who);

		if (onStage) {
			return onStage.bubble;
		}

		return (await manifestResolver.character(who))?.bubble;
	}

	/**
	 * How long an untimed beat holds, in ms, and `0` for "wait for a click".
	 *
	 * Three layers, narrowest first: a beat's own `dur:` (handled by the caller), then the
	 * scene's `autoAdvance:`, then the reader's `sliders.autoAdvance`. The scene key exists
	 * because the reader's is a Chapbook STATE variable — global, and persisted to the
	 * reader's localStorage — so setting it in one passage re-paces every later scene and
	 * every later session. Pacing belongs to the scene; the reader's setting is the
	 * fallback for scenes that express no opinion.
	 *
	 * NOT inherited through `from:`: that key inherits the STAGE, and a patch scene is
	 * usually a different moment at a different pace. Insert Scene seeds the key into every
	 * skeleton it writes, so a story that wants one pace says so per scene.
	 */
	private autoAdvanceDelay(): number {
		const own = this.scene?.autoAdvance;

		if (typeof own === 'number' && Number.isFinite(own)) {
			return Math.max(0, own) * 1000;
		}

		return autoAdvanceMs();
	}

	/**
	 * Auto advance is a convenience, never the only way forward: the last beat always waits
	 * for the reader, and that wait is now load-bearing. The click that ends it is what
	 * reveals the links under the stage (`link-list.ts`), so a timer running past the last
	 * beat would pop the choices up while the final line was still being read — the exact
	 * spoiler the reveal exists to prevent, and worse, because the reader never asked.
	 *
	 * A beat's own `dur:` beats the scene's `autoAdvance:` and the READER's
	 * `sliders.autoAdvance` alike — the author timed this line, and neither a scene default
	 * nor a preference may stretch or shorten it. It does NOT beat the last-beat rule: that
	 * one is about the links, not about pacing, and honouring `dur` there would mean "end
	 * the scene on a timer", which is a different feature with no way back from it.
	 *
	 * `data-waiting` stays `'beat'` either way, so the marker still says "there is more to
	 * read" and a click still skips ahead.
	 */
	private waitForReader(dur?: number) {
		this.setAttribute('data-waiting', 'beat');

		if (this.beatIndex >= (this.scene?.beats?.length ?? 0)) {
			return;
		}

		// The two zeros mean opposite things, and which one you get depends on WHERE it was
		// written. A `dur: 0` is the author saying "do not dwell on this beat", so it still
		// schedules -- at 0ms, i.e. straight on to the next one. A zero from the scene's
		// `autoAdvance:` or from the reader's setting means "let them click", so it
		// schedules nothing. Same number, opposite answers, because one times a single beat
		// and the other is a standing default for the beats that did not time themselves.
		if (dur !== undefined) {
			this.timer = window.setTimeout(
				() => void this.play(),
				Math.max(0, dur) * 1000
			);
			return;
		}

		const delay = this.autoAdvanceDelay();

		if (delay > 0) {
			this.timer = window.setTimeout(() => void this.play(), delay);
		}
	}
}
