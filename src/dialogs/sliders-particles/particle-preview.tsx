/**
 * A live emitter on a dark stage, its box outlined and its origin crossed. Draws through
 * the renderer's own `ParticleHost`, so what the editor shows is what a scene shows.
 */

import {ParticleHost} from '@sliders/render-dom';
import type {EmitParams, Frac2} from '@sliders/scene-types';
import * as React from 'react';

export interface ParticlePreviewProps {
	box: {w: number; h: number};
	origin: Frac2;
	params: EmitParams;
	/** The sprite's url. Absent draws the built-in soft dot. */
	url?: string;
	/** Bumped to start the field over. */
	restart?: number;
}

/** Preview height in CSS px. The box is fitted inside with room for what leaves it. */
const STAGE = 360;

export const ParticlePreview: React.FC<ParticlePreviewProps> = props => {
	const {box, origin, params, restart, url} = props;
	const boxRef = React.useRef<HTMLDivElement>(null);
	const hostRef = React.useRef<ParticleHost>();

	React.useEffect(() => {
		const el = boxRef.current;

		if (!el) {
			return;
		}

		const host = new ParticleHost(document);

		hostRef.current = host;
		el.appendChild(host.el);

		return () => {
			host.destroy();
			hostRef.current = undefined;
		};
	}, []);

	React.useEffect(() => {
		hostRef.current?.set(params, url, origin);
	}, [origin, params, url]);

	React.useEffect(() => {
		if (restart) {
			hostRef.current?.restart();
		}
	}, [restart]);

	// Half the stage height for the box, so a plume twice its box still fits.
	const scale = Math.min((STAGE * 0.5) / box.h, (STAGE * 0.9) / box.w);
	const w = box.w * scale;
	const h = box.h * scale;

	return (
		<div className="particle-preview" style={{height: STAGE}}>
			<div
				className="particle-preview-box"
				ref={boxRef}
				style={{height: h, marginLeft: -w / 2, marginTop: -h / 2, width: w}}
			>
				<div
					className="particle-preview-origin"
					style={{left: `${origin.x * 100}%`, top: `${origin.y * 100}%`}}
				/>
			</div>
		</div>
	);
};
