import * as React from 'react';
import {
	DialogueLayer,
	DomRenderer,
	LinkHandler,
	mergeBubbleStyle
} from '@sliders/render-dom';
import {
	AssetResolver,
	Beat,
	BeatEase,
	BubbleStyle,
	Stage,
	Transition,
	beatLines
} from '@sliders/scene-types';
import {diffStages, timeBeat} from '@sliders/scene-core';
import type {ScrubChannel} from './timing-scrub';
import './scene-stage.css';

export interface SceneStageProps {
	assets: AssetResolver;
	stage: Stage;
	/**
	 * Bumped whenever the asset library changes, which makes the renderer drop what it
	 * cached about the assets on stage and resolve them again.
	 *
	 * Needed because the renderer caches a URL and a meta per asset id, and an asset's
	 * bytes can change UNDER a stable id — the asset editor writes an edit back over the
	 * original, and the store revokes the old object URL when it does. Without this the
	 * preview keeps a revoked URL on the sprite: the stage does not merely show the old
	 * picture, it shows a broken image, and it does so until the passage is reopened.
	 *
	 * A number rather than a callback so it reaches the effect as a dependency, the way
	 * `EffectPreview` takes its own revision.
	 */
	assetRevision?: number;
	/** The beat that produced this stage, if any. Drives bubbles and the narration box. */
	beat?: Beat;
	/** When true, play the derived transitions. When false, snap. */
	animate?: boolean;
	/**
	 * The scene's own `ease:`, under whatever the beat asks for.
	 *
	 * Passed in rather than read off the beat, because a scene default belongs to no beat —
	 * it is exactly the thing that applies when the beat says nothing.
	 */
	sceneEase?: BeatEase;
	/**
	 * The look every line starts from: the story's `sliders.bubble.*` variables with the
	 * scene's own `bubble:` over them, already merged.
	 *
	 * Passed in for the same reason `sceneEase` is — neither belongs to a beat, and this
	 * component only ever sees one beat at a time. The speaking character's own defaults
	 * and then the beat's keys go over the top of it here.
	 */
	bubbleDefaults?: BubbleStyle;
	onLink?: LinkHandler;
	/**
	 * Hands the renderer out once it is mounted, and `undefined` on teardown.
	 *
	 * The visual editor overlay needs `rectOf()` and `stageBox()` to hit test and to draw
	 * handles on the sprite. Held in a ref like `assets` and `onLink` so that a caller
	 * passing an inline arrow function cannot cause a remount — see above.
	 */
	onRenderer?: (renderer: DomRenderer | undefined) => void;
	/**
	 * Whether the stage may be heard. Muted is the default everywhere the editor mounts one
	 * — see `DomRenderer.setMuted`.
	 */
	muted?: boolean;
	/**
	 * The story's stylesheet, injected next to the stage so a bubble token the story paints
	 * itself (`as: ghostly`) previews the way it will play. Scoped to this element rather
	 * than the document: the story's CSS is written against the player's page, and letting
	 * a `body {}` rule out of the stage would restyle the editor.
	 */
	stylesheet?: string;
	/**
	 * The editor's zoomed-out view: below 1 the stage is drawn that much smaller inside the
	 * host and sprites off the frame stay visible. See `DomRenderer.setViewScale`.
	 */
	viewScale?: number;
	/**
	 * Playback is stopped on this beat until the author clicks (`autoAdvance: 0`). Shows the
	 * renderer's cue, the same one the player shows the reader.
	 */
	waitingForClick?: boolean;
	/**
	 * The timing overlay's hover: frames drawn straight onto the renderer, no re-render.
	 * While one is up the stage shows it; `undefined` puts back the stage and lines above.
	 */
	scrub?: ScrubChannel;
}

/**
 * Mounts a DomRenderer plus its DialogueLayer once, then feeds them stages and beats.
 *
 * Deliberately does NOT remount on change — remounting restarts CSS animations and makes
 * the preview flash on every keystroke (spec 06).
 */
export const SceneStage: React.FC<SceneStageProps> = ({
	animate,
	assetRevision,
	assets,
	beat,
	bubbleDefaults,
	muted = true,
	onLink,
	onRenderer,
	sceneEase,
	scrub,
	stage,
	stylesheet,
	viewScale = 1,
	waitingForClick = false
}) => {
	const hostRef = React.useRef<HTMLDivElement>(null);
	const rendererRef = React.useRef<DomRenderer>();
	const styleRef = React.useRef<HTMLStyleElement>();
	const dialogueRef = React.useRef<DialogueLayer>();
	const prevStageRef = React.useRef<Stage>();
	// Held in refs so remounting never depends on their identity.
	const assetsRef = React.useRef(assets);
	const beatRef = React.useRef(beat);
	const onLinkRef = React.useRef(onLink);
	const onRendererRef = React.useRef(onRenderer);
	const [ready, setReady] = React.useState(false);
	/**
	 * Everything that times the beat — its `dur:`/`ease:`, each `with:` part's, the scene's
	 * `ease:` — as ONE string the apply effect can depend on.
	 *
	 * `beat` itself is a fresh object on every parse, so depending on it would re-apply the
	 * stage on every keystroke; this string only changes when the author retimes something.
	 * The real values are read out of refs.
	 */
	const timingKey = JSON.stringify([
		beat?.dur ?? null,
		beat?.ease ?? null,
		beat?.with?.map(part => [part.who, part.dur ?? null, part.ease ?? null]) ?? null,
		sceneEase ?? null
	]);
	const sceneEaseRef = React.useRef<BeatEase | undefined>(sceneEase);
	/** What the last `apply` was given, so a flip of `animate` alone can be told apart. */
	const appliedRef = React.useRef<{stage?: Stage; timingKey: string}>({
		timingKey: ''
	});

	sceneEaseRef.current = sceneEase;
	assetsRef.current = assets;
	beatRef.current = beat;
	onLinkRef.current = onLink;
	onRendererRef.current = onRenderer;

	React.useEffect(() => {
		const host = hostRef.current;

		if (!host) {
			return;
		}

		// The renderer is given NO `onLink` here, deliberately: on the stage every click a
		// link could ride on is already spoken for — plain selects, ctrl/cmd extends the
		// selection, shift is the drag's axis lock, double click opens the asset — so a
		// link handler would fire ON TOP of one of those rather than instead of it. The
		// editor's affordance is the Open button in the selection row. A link in bubble
		// TEXT has no such conflict and keeps its ctrl-click.
		const renderer = new DomRenderer();
		const dialogue = new DialogueLayer({
			onLink: (name, target, event) => onLinkRef.current?.(name, target, event)
		});

		rendererRef.current = renderer;
		dialogueRef.current = dialogue;

		let cancelled = false;

		renderer.mount(host, assetsRef.current).then(() => {
			if (cancelled) {
				return;
			}

			// Bubbles ask the renderer where anchors landed, so they mount after it.
			dialogue.mount(host, renderer);
			setReady(true);

			// Announced only once the mount resolved: before that `stageBox()` is a zero
			// box and every rect the overlay asked for would be nonsense.
			onRendererRef.current?.(renderer);
		});

		return () => {
			cancelled = true;
			dialogue.destroy();
			renderer.destroy();
			rendererRef.current = undefined;
			dialogueRef.current = undefined;
			prevStageRef.current = undefined;
			appliedRef.current = {timingKey: ''};
			onRendererRef.current?.(undefined);
		};
	}, []);

	React.useEffect(() => {
		const renderer = rendererRef.current;

		if (!renderer || !ready) {
			return;
		}

		const prev = prevStageRef.current;
		const applied = appliedRef.current;

		// Only `animate` moved: playback stopped (or started) on the stage already drawn.
		// Re-applying it would write zero durations in the SAME task as the move that is
		// just starting, so the browser never runs it -- the last beat of a scene, the
		// drone landing, snapped instead of gliding. Nothing to redraw, so draw nothing.
		if (
			prev === stage &&
			applied.stage === stage &&
			applied.timingKey === timingKey
		) {
			return;
		}

		appliedRef.current = {stage, timingKey};

		let transitions: Transition[] = [];

		if (prev) {
			// The beat's own timing first -- per entity, the way the player times it --
			// THEN the snap: a scene being typed into must not animate whatever the author
			// timed the beat at, and a zeroed duration with a curve on it is still a snap.
			transitions = timeBeat(
				diffStages(prev, stage),
				beatRef.current,
				sceneEaseRef.current,
				stage
			);

			// Snap while typing: derive the same set but with zero duration, so entities
			// still enter and exit correctly without animating on every keystroke.
			if (!animate) {
				transitions = transitions.map(t => ({...t, duration: 0}));
			}
		}

		prevStageRef.current = stage;
		void renderer.apply(stage, transitions);
	}, [animate, ready, stage, timingKey]);

	/**
	 * Re-resolve every asset on stage after the library moved.
	 *
	 * Re-applied with the stage it already has and no transitions: nothing about the SCENE
	 * changed, only the pixels behind a name, so this is a redraw rather than a beat and
	 * must not animate. `setContent` still bails per entity when the URL comes back the
	 * same, so an edit to one asset does not restart the animated WebP on any other.
	 *
	 * Skipped on mount — the first `apply` is already resolving everything from an empty
	 * cache, and invalidating it mid-flight would be one wasted `list()` per passage
	 * opened.
	 */
	const lastRevision = React.useRef(assetRevision);

	React.useEffect(() => {
		const renderer = rendererRef.current;
		const stage = prevStageRef.current;

		if (!renderer || !ready || lastRevision.current === assetRevision) {
			return;
		}

		lastRevision.current = assetRevision;
		renderer.invalidate();

		if (stage) {
			void renderer.apply(stage, []);
		}
	}, [assetRevision, ready]);

	React.useEffect(() => {
		if (ready) {
			rendererRef.current?.setMuted(muted);
		}
	}, [muted, ready]);

	React.useEffect(() => {
		if (ready) {
			rendererRef.current?.setViewScale(viewScale);
		}
	}, [ready, viewScale]);

	React.useEffect(() => {
		if (ready) {
			rendererRef.current?.setWaitingForClick(waitingForClick);
		}
	}, [ready, waitingForClick]);

	/**
	 * Fire a beat's one-shot when the scrubber ARRIVES on it.
	 *
	 * Keyed on the beat index, not on the beat object: the parser hands back fresh objects
	 * on every keystroke, and a sound that re-fired while somebody typed the line under it
	 * would be unbearable. Stepping back and then forward over the same beat does fire it
	 * again, which is right — landing on the beat is what plays it, in the editor and in the
	 * player alike.
	 */
	const sfxIndex = beat?.sfx ? beat.index : undefined;

	React.useEffect(() => {
		if (!ready || sfxIndex === undefined || muted) {
			return;
		}

		const sound = beatRef.current?.sfx;

		if (sound) {
			rendererRef.current?.cue(sound);
		}
		// `beatRef` is deliberately not a dependency (it is a ref, so it cannot be one):
		// reading the sound through it is what keeps this effect from re-running when the
		// same beat is re-parsed on the next keystroke.
	}, [muted, ready, sfxIndex]);

	/**
	 * The story's CSS, as one style element inside the stage.
	 *
	 * Rewritten in place rather than remounted, so editing the stylesheet does not restart
	 * the transitions running on the stage under it.
	 */
	React.useEffect(() => {
		const host = hostRef.current;

		if (!host) {
			return;
		}

		if (!stylesheet?.trim()) {
			styleRef.current?.remove();
			styleRef.current = undefined;

			return;
		}

		if (!styleRef.current) {
			styleRef.current = document.createElement('style');
			styleRef.current.dataset.slidersStoryStyles = 'true';
			host.appendChild(styleRef.current);
		}

		styleRef.current.textContent = stylesheet;
	}, [stylesheet]);

	React.useEffect(() => () => styleRef.current?.remove(), []);

	/**
	 * Draw one beat's lines. A ref so the scrub channel can draw ANOTHER beat's lines with
	 * the same defaults; returns the cancel for a late off-stage lookup.
	 */
	const showLinesRef = React.useRef<
		(shown: Beat | undefined) => (() => void) | undefined
	>();

	showLinesRef.current = shown => {
		const dialogue = dialogueRef.current;

		if (!dialogue) {
			return undefined;
		}

		// Every line the beat shows, at once: the box and each speaker's bubble. Anything a
		// beat does not say is cleared, so stale text can't linger.
		const lines = shown ? beatLines(shown) : [];
		const box = lines.find(line => line.who === undefined);
		const speakers = lines.filter(line => line.who !== undefined);
		const specs = (characterBubble: (who: string) => BubbleStyle | undefined) =>
			speakers.map(line => ({
				style: mergeBubbleStyle(
					mergeBubbleStyle(bubbleDefaults, characterBubble(line.who!)),
					line.style
				),
				text: line.text,
				who: line.who!
			}));
		const onStage = (who: string) => rendererRef.current?.characterOf(who)?.bubble;

		dialogue.setBubbles(specs(onStage));
		dialogue.setBox(
			box ? box.text : null,
			box ? mergeBubbleStyle(bubbleDefaults, box.style) : undefined
		);

		// A speaker who is not on stage — a narrator, a voice through a door — still has a
		// character in the library, and their defaults arrive a tick later.
		const offStage = speakers.filter(line => !onStage(line.who!));

		if (offStage.length > 0) {
			let live = true;

			void Promise.all(
				offStage.map(line =>
					assetsRef.current
						.character(line.who!)
						.then(character => [line.who!, character?.bubble] as const)
				)
			).then(found => {
				const library = new Map(found);

				if (live && found.some(([, bubble]) => bubble)) {
					dialogue.setBubbles(specs(who => onStage(who) ?? library.get(who)));
				}
			});

			return () => {
				live = false;
			};
		}

		return undefined;
	};

	React.useEffect(() => {
		if (!ready) {
			return;
		}

		return showLinesRef.current?.(beat);
	}, [beat, bubbleDefaults, ready, stage]);

	React.useEffect(() => {
		if (!scrub || !ready) {
			return;
		}

		// `scrubbing` is false between hovers; `linesOf` is the beat whose lines are up.
		let scrubbing = false;
		let linesOf: number | undefined;
		let cancelLines: (() => void) | undefined;
		const off = scrub.subscribe(frame => {
			const renderer = rendererRef.current;

			if (!renderer) {
				return;
			}

			if (frame) {
				void renderer.apply(frame.stage, []);

				// Lines only when the hovered BEAT changes: re-sizing every bubble on every
				// mouse move was the other half of the lag.
				if (!scrubbing || linesOf !== frame.beat?.index) {
					cancelLines?.();
					cancelLines = showLinesRef.current?.(frame.beat);
					linesOf = frame.beat?.index;
				}

				scrubbing = true;
				return;
			}

			if (!scrubbing) {
				return;
			}

			scrubbing = false;
			cancelLines?.();
			cancelLines = showLinesRef.current?.(beatRef.current);

			if (prevStageRef.current) {
				void renderer.apply(prevStageRef.current, []);
			}
		});

		return () => {
			off();
			cancelLines?.();
		};
	}, [ready, scrub]);

	/**
	 * Stopped is STILL for the dialogue: no CSS transition or animation on a bubble.
	 *
	 * The editor redraws on every drag frame and every keystroke, and a bubble that eased
	 * toward its value trailed the pointer. Entity durations are already zeroed per apply;
	 * the bubble's follow and enter animation live in the stylesheet, not the renderer's
	 * to zero. Entity loops (parallax, `motion:`) keep running — scene-stage.css.
	 *
	 * On a stop the class waits for the transitions already running: the last beat of a
	 * playback glides to rest instead of snapping (see the apply effect above).
	 */
	const [still, setStill] = React.useState(!animate);

	React.useEffect(() => {
		if (animate) {
			setStill(false);

			return;
		}

		const host = hostRef.current;
		let cancelled = false;
		const running =
			host && typeof host.getAnimations === 'function'
				? host
						.getAnimations({subtree: true})
						.filter(
							a =>
								typeof CSSTransition !== 'undefined' && a instanceof CSSTransition
						)
				: [];

		void Promise.allSettled(running.map(a => a.finished)).then(() => {
			if (!cancelled) {
				setStill(true);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [animate]);

	return (
		<div className={`scene-stage${still ? ' still' : ''}`} ref={hostRef} />
	);
};
