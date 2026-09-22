/**
 * `screenshot_scene` — the model's eyes (plan §4).
 *
 * The picture has to be of the REAL preview: same `ScenePreview` stage component, same
 * resolver, same stylesheet, same beat runner. A second, simplified renderer for
 * screenshots would drift from the one the author looks at, and the model would then be
 * confidently describing a picture nobody else can see.
 *
 * So the host is an ordinary `<SceneStage>` mounted offscreen. Offscreen, not hidden:
 * `display: none` and `visibility: hidden` both give the subtree no layout, and a node
 * with no layout rasterises to nothing. It is positioned far off the left edge at a fixed
 * 16:9 size, `aria-hidden`, and it only exists while a capture is running.
 *
 * Caps, from the plan: never automatic, and one per model turn. The first is structural —
 * only the tool mounts this. The second is `runner.ts`'s to enforce per turn; here we only
 * make sure two captures cannot overlap, because they would share one host node.
 */

import {mergeBubbleStyle} from '@sliders/render-dom';
import type {Beat, Stage} from '@sliders/scene-types';
import * as React from 'react';
import {SceneStage} from '../../dialogs/passage-edit/scene-preview/scene-stage';
import {parseSceneText} from '../../dialogs/passage-edit/scene-preview/use-scene-parse';
import {usePreviewResolver} from '../../dialogs/passage-edit/scene-preview/use-preview-resolver';
import type {Story} from '../../store/stories';
import {storyBubbleDefaults} from '../../util/story-bubble';
import {rasterise} from './rasterise';
import type {Raster} from './rasterise';
import './screenshot-host.css';

/** 16:9, and big enough that a downscale to 768 is a downscale rather than a stretch. */
const HOST_WIDTH = 1280;
const HOST_HEIGHT = 720;

/**
 * Which state to stand on for a given beat.
 *
 * The scrubber counts STATES, not beats: state 0 is the stage before anything has run, so
 * beat N is state N+1. Separate from the hook because this off-by-one is the thing most
 * likely to be wrong, and a picture of the wrong beat is a picture that lies.
 *
 * No beat asked for means the scene's opening SHOT — its first beat — not state 0, which
 * for a scene with beats is a moment the reader never sees. A beat past the end clamps to
 * the last state, which is nearer what the model meant than an error.
 */
export function stateForBeat(beat: number | undefined, states: number): number {
	const last = Math.max(0, states - 1);

	if (beat === undefined) {
		return Math.min(1, last);
	}

	return Math.max(0, Math.min(beat + 1, last));
}

interface Mounted {
	beat?: Beat;
	bubbleDefaults?: ReturnType<typeof mergeBubbleStyle>;
	stage: Stage;
	stylesheet?: string;
}

export interface SceneScreenshot {
	/** Undefined while nothing is mounted — `runner.ts` reports that honestly. */
	capture: (passageId: string, beat?: number) => Promise<Raster>;
	/** Render this inside the dialog. It draws nothing the author can see. */
	host: React.ReactElement | null;
}

export function useSceneScreenshot(story: Story): SceneScreenshot {
	const assets = usePreviewResolver();
	const [mounted, setMounted] = React.useState<Mounted>();
	const node = React.useRef<HTMLDivElement>(null);
	const storyRef = React.useRef(story);
	/** Resolves when the host has painted whatever was just set. */
	const painted = React.useRef<(() => void) | undefined>();
	const busy = React.useRef(false);

	storyRef.current = story;

	React.useEffect(() => {
		painted.current?.();
		painted.current = undefined;
	}, [mounted]);

	const capture = React.useCallback(
		async (passageId: string, beat?: number): Promise<Raster> => {
			if (busy.current) {
				throw new Error('a screenshot is already being taken');
			}

			const current = storyRef.current;
			const passage = current.passages.find(
				candidate => candidate.id === passageId
			);

			if (!passage) {
				throw new Error('that passage is gone');
			}

			const parse = parseSceneText(passage.text, current.passages);

			if (!parse.hasScene) {
				throw new Error('that passage has no scene to look at');
			}

			const wanted = stateForBeat(beat, parse.states.length);
			const beats = parse.result?.scene.beats ?? [];

			busy.current = true;

			try {
				await new Promise<void>(resolve => {
					painted.current = resolve;
					setMounted({
						beat: wanted > 0 ? beats[wanted - 1] : undefined,
						bubbleDefaults: mergeBubbleStyle(
							storyBubbleDefaults(current.passages),
							parse.result?.scene.bubble
						),
						stage: parse.states[wanted],
						stylesheet: current.stylesheet
					});
				});

				if (!node.current) {
					throw new Error('the screenshot host did not mount');
				}

				return await rasterise(node.current);
			} finally {
				busy.current = false;
				setMounted(undefined);
			}
		},
		[]
	);

	return {
		capture,
		host: mounted ? (
			<div
				aria-hidden
				className="voice-screenshot-host"
				ref={node}
				style={{height: HOST_HEIGHT, width: HOST_WIDTH}}
			>
				<SceneStage
					animate={false}
					assets={assets}
					beat={mounted.beat}
					bubbleDefaults={mounted.bubbleDefaults}
					muted
					stage={mounted.stage}
					stylesheet={mounted.stylesheet}
				/>
			</div>
		) : null
	};
}
