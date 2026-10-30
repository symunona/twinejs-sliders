/**
 * The live emitter over a particle tile, while it is hovered. The particle editor's own
 * `ParticlePreview`, so a tile animates exactly as the editor and a scene do.
 *
 * One at a time, library-wide: mounting a second one stops the first. Each preview is a
 * WebGL canvas and a frame loop, so nothing idles on a tile nobody points at.
 */

import {emitBox, resolveEmit, type AssetMeta} from '@sliders/scene-types';
import {DEFAULT_ORIGIN} from '@sliders/render-dom';
import * as React from 'react';
import {ParticlePreview} from '../sliders-particles/particle-preview';
import '../sliders-particles/sliders-particles.css';
import {useAssetStore} from './asset-store-context';

/** Stops the hover preview that is live now, if any. */
let stopLive: (() => void) | undefined;

/**
 * Hover state for one tile, with the at-most-one rule: starting a preview stops whatever
 * other tile had one, even if its pointerleave never came (drag, unmount, a fast flick).
 */
export function useParticleHover(enabled: boolean) {
	const [live, setLive] = React.useState(false);
	const stop = React.useCallback(() => setLive(false), []);

	React.useEffect(
		() => () => {
			if (stopLive === stop) {
				stopLive = undefined;
			}
		},
		[stop]
	);

	const onPointerEnter = React.useCallback(() => {
		if (!enabled) {
			return;
		}

		if (stopLive && stopLive !== stop) {
			stopLive();
		}

		stopLive = stop;
		setLive(true);
	}, [enabled, stop]);

	const onPointerLeave = React.useCallback(() => {
		if (stopLive === stop) {
			stopLive = undefined;
		}

		setLive(false);
	}, [stop]);

	return {live: enabled && live, onPointerEnter, onPointerLeave};
}

export interface ParticleTilePreviewProps {
	height: number;
	meta: AssetMeta;
}

export const ParticleTilePreview: React.FC<ParticleTilePreviewProps> = props => {
	const {height, meta} = props;
	const store = useAssetStore();
	const spec = meta.particles;
	const params = React.useMemo(() => resolveEmit(spec, undefined), [spec]);
	const box = React.useMemo(() => emitBox(spec), [spec]);
	const spriteName = spec?.sprite;
	const [url, setUrl] = React.useState<string>();

	// The sprite is a NAME, as in the editor and the renderer. Unknown draws the soft dot.
	React.useEffect(() => {
		let current = true;

		setUrl(undefined);

		if (!spriteName) {
			return;
		}

		store
			.lookup(spriteName)
			.then(sprite =>
				sprite && !sprite.particles ? store.url(sprite.id) : undefined
			)
			.then(result => current && setUrl(result))
			.catch(() => undefined);

		return () => {
			current = false;
		};
	}, [spriteName, store]);

	return (
		<div className="sliders-tile-particles" data-testid="particle-tile-preview">
			<ParticlePreview
				box={box}
				height={height}
				origin={meta.origin ?? DEFAULT_ORIGIN}
				params={params}
				url={url}
			/>
		</div>
	);
};
