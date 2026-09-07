/**
 * `<sliders-stage>` — one scene, playing.
 *
 * The element owns nothing about scene semantics: `@sliders/scene-core` turns a scene into
 * a list of stages, `@sliders/render-dom` draws one, and this only decides when to move
 * from one to the next. Every beat that says something waits for a click (or the auto
 * advance timer); everything else falls through in the same tick, so a run of stage-only
 * beats is a single transition rather than a stutter.
 */

import {applyScene, diffStages, resolveStage, runBeats} from '@sliders/scene-core';
import {DialogueLayer, DomRenderer, mergeBubbleStyle} from '@sliders/render-dom';
import type {Beat, Scene, SceneError, Stage} from '@sliders/scene-types';
import {go} from '../actions';
import {createLoggers} from '../logger';
import {get, set} from '../state';
import {CustomElement} from '../util/custom-element';
import {manifestResolver} from './assets';
import {enterCinema, leaveCinema} from './cinema';
import {STAGE_VAR, autoAdvanceMs, fullScreenScenes} from './config';
import {stageFrom} from './scene-graph';

const {warn} = createLoggers('scene');

/** What the `[scene]` modifier packs into the element's `scene` attribute. */
export interface StagePayload {
	scene: Scene;
	/** Link name -> passage name, with `if:` already evaluated. */
	links?: Record<string, string>;
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
	private timer?: number;
	private cinema = false;

	private handleClick = (event: MouseEvent) => {
		// A link inside a bubble is a navigation, not an advance.
		if (!(event.target as HTMLElement | null)?.closest('a')) {
			void this.play();
		}
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

		const base = stageFrom(payload.scene.from);
		const entry = applyScene(base, payload.scene);

		this.states = [entry, ...runBeats(entry, payload.scene.beats ?? [])];
		this.beatIndex = 0;
		this.renderer = new DomRenderer({guides: Boolean(get('config.testing'))});
		await this.renderer.mount(this, manifestResolver);
		this.dialogue = new DialogueLayer({
			onLink: (name, target) => {
				const to = target ?? this.links[name];

				if (to) {
					go(to);
				} else {
					warn(`The link "${name}" has no \`to:\` in this scene's links.`);
				}
			}
		});
		this.dialogue.mount(this, this.renderer);

		// The scene enters FROM the stage it inherited, so a character already on stage in
		// the previous scene slides instead of popping.
		const from = resolveStage(base);
		const to = resolveStage(entry);

		await this.renderer.apply(to, diffStages(from, to));
		publishStage(entry);
		this.addEventListener('click', this.handleClick);
		void this.play();
	}

	disconnectedCallback() {
		if (this.cinema) {
			this.cinema = false;
			leaveCinema();
		}

		this.removeEventListener('click', this.handleClick);
		window.clearTimeout(this.timer);
		this.dialogue?.destroy();
		this.renderer?.destroy();
		this.dialogue = undefined;
		this.renderer = undefined;
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

				await this.renderer?.apply(to, diffStages(from, to));
				publishStage(after);
			}

			switch (beat.kind) {
				case 'say':
					this.dialogue?.setBox(null);
					this.dialogue?.say(beat.who, beat.text, {
						// The speaking character's own `bubble:` is the default; the beat's
						// `as:`/`bubble:` overrides it key by key.
						style: mergeBubbleStyle(
							this.renderer?.characterOf(beat.who)?.bubble,
							beat.style
						)
					});
					this.waitForReader();
					return;

				case 'box':
					this.dialogue?.clear();
					this.dialogue?.setBox(beat.text, beat.style);
					this.waitForReader();
					return;

				case 'wait':
					this.setAttribute('data-waiting', 'timer');
					this.timer = window.setTimeout(
						() => void this.play(),
						beat.seconds * 1000
					);
					return;
			}
		}

		this.removeAttribute('data-waiting');
	}

	/**
	 * Auto advance is a convenience, never the only way forward: the last beat always waits
	 * for the reader, or the links under the stage would appear while the final line was
	 * still being read.
	 */
	private waitForReader() {
		this.setAttribute('data-waiting', 'beat');

		const delay = autoAdvanceMs();

		if (delay > 0 && this.beatIndex < (this.scene?.beats?.length ?? 0)) {
			this.timer = window.setTimeout(() => void this.play(), delay);
		}
	}
}
