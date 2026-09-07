import * as React from 'react';
import {
	DialogueLayer,
	DomRenderer,
	LinkHandler,
	mergeBubbleStyle
} from '@sliders/render-dom';
import {AssetResolver, Beat, Stage, Transition} from '@sliders/scene-types';
import {diffStages} from '@sliders/scene-core';

export interface SceneStageProps {
	assets: AssetResolver;
	stage: Stage;
	/** The beat that produced this stage, if any. Drives bubbles and the narration box. */
	beat?: Beat;
	/** When true, play the derived transitions. When false, snap. */
	animate?: boolean;
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
	 * The story's stylesheet, injected next to the stage so a bubble token the story paints
	 * itself (`as: ghostly`) previews the way it will play. Scoped to this element rather
	 * than the document: the story's CSS is written against the player's page, and letting
	 * a `body {}` rule out of the stage would restyle the editor.
	 */
	stylesheet?: string;
}

/**
 * Mounts a DomRenderer plus its DialogueLayer once, then feeds them stages and beats.
 *
 * Deliberately does NOT remount on change — remounting restarts CSS animations and makes
 * the preview flash on every keystroke (spec 06).
 */
export const SceneStage: React.FC<SceneStageProps> = ({
	animate,
	assets,
	beat,
	onLink,
	onRenderer,
	stage,
	stylesheet
}) => {
	const hostRef = React.useRef<HTMLDivElement>(null);
	const rendererRef = React.useRef<DomRenderer>();
	const styleRef = React.useRef<HTMLStyleElement>();
	const dialogueRef = React.useRef<DialogueLayer>();
	const prevStageRef = React.useRef<Stage>();
	// Held in refs so remounting never depends on their identity.
	const assetsRef = React.useRef(assets);
	const onLinkRef = React.useRef(onLink);
	const onRendererRef = React.useRef(onRenderer);
	const [ready, setReady] = React.useState(false);

	assetsRef.current = assets;
	onLinkRef.current = onLink;
	onRendererRef.current = onRenderer;

	React.useEffect(() => {
		const host = hostRef.current;

		if (!host) {
			return;
		}

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
			onRendererRef.current?.(undefined);
		};
	}, []);

	React.useEffect(() => {
		const renderer = rendererRef.current;

		if (!renderer || !ready) {
			return;
		}

		const prev = prevStageRef.current;
		let transitions: Transition[] = [];

		if (prev) {
			transitions = diffStages(prev, stage);

			// Snap while typing: derive the same set but with zero duration, so entities
			// still enter and exit correctly without animating on every keystroke.
			if (!animate) {
				transitions = transitions.map(t => ({...t, duration: 0}));
			}
		}

		prevStageRef.current = stage;
		void renderer.apply(stage, transitions);
	}, [animate, ready, stage]);

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

	React.useEffect(() => {
		const dialogue = dialogueRef.current;

		if (!dialogue || !ready) {
			return;
		}

		// Each beat owns exactly one of the two surfaces, so stale text can't linger.
		if (beat?.kind === 'say') {
			const onStage = rendererRef.current?.characterOf(beat.who)?.bubble;

			dialogue.setBubbles([
				{
					style: mergeBubbleStyle(onStage, beat.style),
					text: beat.text,
					who: beat.who
				}
			]);
			dialogue.setBox(null);

			// A speaker who is not on stage — a narrator, a voice through a door — still has
			// a character in the library, and their defaults arrive a tick later.
			if (!onStage) {
				let live = true;

				void assetsRef.current.character(beat.who).then(character => {
					if (live && character?.bubble) {
						dialogue.setBubbles([
							{
								style: mergeBubbleStyle(character.bubble, beat.style),
								text: beat.text,
								who: beat.who
							}
						]);
					}
				});

				return () => {
					live = false;
				};
			}
		} else if (beat?.kind === 'box') {
			dialogue.setBubbles([]);
			dialogue.setBox(beat.text, beat.style);
		} else {
			dialogue.setBubbles([]);
			dialogue.setBox(null);
		}
	}, [beat, ready, stage]);

	return <div className="scene-stage" ref={hostRef} />;
};
