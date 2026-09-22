import type {AssetEffect} from '@sliders/scene-types';
import {effectClass, pruneEffectCss, syncEffect} from '@sliders/render-dom';
import * as React from 'react';
// Straight from the file rather than the folder's barrel, the same reason the mask overlay
// does it: the barrel drags in the preset list and the anchor picker, and neither has any
// business here.
import {useArtRect} from '../../components/anchor/use-art-rect';

export interface EffectPreviewProps {
	/** The preview canvas. Letterboxed inside its box, so it is measured, never assumed. */
	art: React.RefObject<HTMLCanvasElement>;
	/** The positioned element the overlay is drawn in. */
	container: React.RefObject<HTMLElement>;
	effect?: AssetEffect;
	/**
	 * Bumped whenever the canvas has been redrawn. The overlay copies the canvas into an
	 * `<img>`, so it has no way of noticing new pixels on its own.
	 */
	revision: number;
}

/** How long after the last change unused generated stylesheets are swept up. */
const PRUNE_DELAY = 800;

/**
 * The asset editor's live effect preview: the same layers, the same generated CSS and the
 * same blend modes the player will build, laid over the preview canvas.
 *
 * Shared rather than reimplemented, and that is the point of the feature. An effect is
 * animated CSS, so there is no still frame of it to bake into the asset and nothing about it
 * that a canvas can show — the only honest preview is the real thing. Going through
 * `syncEffect` is what keeps "what the author approved" and "what the reader sees" the same
 * DOM (see `.claude/ARCHITECTURE.md` — a rule that exists twice will drift).
 *
 * The canvas itself is left alone. Its pixels are copied into the layers as a data URL,
 * because a `<canvas>` cannot be a `background-image` and the layers have to be able to blend
 * against the picture the author is looking at.
 */
export const EffectPreview: React.FC<EffectPreviewProps> = props => {
	const {art, container, effect, revision} = props;
	const rect = useArtRect(art, container);
	const host = React.useRef<HTMLDivElement>(null);
	const [src, setSrc] = React.useState<string>();

	// Read the canvas AFTER paint, never during the render that changed it. The asset editor
	// redraws the canvas from an effect of its own, and there is no ordering between two
	// components' effects that is worth relying on -- a frame later, the pixels are certainly
	// there.

	React.useEffect(() => {
		const canvas = art.current;

		if (!canvas) {
			return;
		}

		const view = canvas.ownerDocument.defaultView;
		const frame = view?.requestAnimationFrame(() => {
			try {
				setSrc(canvas.toDataURL());
			} catch {
				// A canvas tainted by cross-origin pixels throws here. The effect simply does
				// not preview; nothing else in the editor cares.
				setSrc(undefined);
			}
		});

		return () => {
			if (frame !== undefined) {
				view?.cancelAnimationFrame(frame);
			}
		};
	}, [art, revision]);

	React.useEffect(() => {
		if (host.current) {
			syncEffect(host.current, effect, src);
		}
	}, [effect, src]);

	// Every value a slider passes through leaves a generated stylesheet behind, so a minute of
	// tuning leaves hundreds. Swept on a delay rather than on each change: the sheet the
	// running preview is animating against is the one that was just added, and removing it
	// mid-drag would strip the effect the author is trying to judge.

	React.useEffect(() => {
		if (!effect) {
			return;
		}

		const keep = effectClass(effect);
		const timer = window.setTimeout(
			() => pruneEffectCss([keep], host.current?.ownerDocument),
			PRUNE_DELAY
		);

		return () => window.clearTimeout(timer);
	}, [effect]);

	if (!rect) {
		return null;
	}

	return (
		<div
			aria-hidden
			className="asset-editor-fx"
			style={{
				height: rect.height,
				left: rect.left,
				top: rect.top,
				width: rect.width
			}}
		>
			{/* The fx host is `position: absolute; inset: 0`, so it needs a box of its own to
			    fill -- setting left/top/width/height on it directly over-constrains the
			    `inset` it already carries. */}
			<div ref={host} className="sliders-fx" />
		</div>
	);
};
