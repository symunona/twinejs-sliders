import * as React from 'react';
import {DialogueLayer, DomRenderer} from '@sliders/render-dom';
import {AssetResolver, Beat, Stage, Transition} from '@sliders/scene-types';
import {diffStages} from '@sliders/scene-core';

export interface SceneStageProps {
	assets: AssetResolver;
	stage: Stage;
	/** The beat that produced this stage, if any. Drives bubbles and the narration box. */
	beat?: Beat;
	/** When true, play the derived transitions. When false, snap. */
	animate?: boolean;
	onLink?: (name: string, target?: string) => void;
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
	stage
}) => {
	const hostRef = React.useRef<HTMLDivElement>(null);
	const rendererRef = React.useRef<DomRenderer>();
	const dialogueRef = React.useRef<DialogueLayer>();
	const prevStageRef = React.useRef<Stage>();
	// Held in refs so remounting never depends on their identity.
	const assetsRef = React.useRef(assets);
	const onLinkRef = React.useRef(onLink);
	const [ready, setReady] = React.useState(false);

	assetsRef.current = assets;
	onLinkRef.current = onLink;

	React.useEffect(() => {
		const host = hostRef.current;

		if (!host) {
			return;
		}

		const renderer = new DomRenderer();
		const dialogue = new DialogueLayer({
			onLink: (name, target) => onLinkRef.current?.(name, target)
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
		});

		return () => {
			cancelled = true;
			dialogue.destroy();
			renderer.destroy();
			rendererRef.current = undefined;
			dialogueRef.current = undefined;
			prevStageRef.current = undefined;
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

	React.useEffect(() => {
		const dialogue = dialogueRef.current;

		if (!dialogue || !ready) {
			return;
		}

		// Each beat owns exactly one of the two surfaces, so stale text can't linger.
		if (beat?.kind === 'say') {
			dialogue.setBubbles([{who: beat.who, text: beat.text}]);
			dialogue.setBox(null);
		} else if (beat?.kind === 'box') {
			dialogue.setBubbles([]);
			dialogue.setBox(beat.text);
		} else {
			dialogue.setBubbles([]);
			dialogue.setBox(null);
		}
	}, [beat, ready, stage]);

	return <div className="scene-stage" ref={hostRef} />;
};
