/**
 * A live emitter on a dark stage, its box outlined and its origin crossed. Draws through
 * the renderer's own `ParticleHost`, so what the editor shows is what a scene shows.
 *
 * The canvas is the whole preview, not the box: a plume taller than its box is drawn,
 * not clipped. The emitter's place on it is read off the box element each frame.
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
	const stageRef = React.useRef<HTMLDivElement>(null);
	const boxRef = React.useRef<HTMLDivElement>(null);
	const hostRef = React.useRef<ParticleHost>();
	const originRef = React.useRef(origin);

	originRef.current = origin;

	React.useEffect(() => {
		const stage = stageRef.current;

		if (!stage) {
			return;
		}

		const host = new ParticleHost(document, {
			anchor: () => {
				const el = boxRef.current;

				if (!el) {
					return undefined;
				}

				return {
					unit: el.offsetWidth,
					x: el.offsetLeft + originRef.current.x * el.offsetWidth,
					y: el.offsetTop + originRef.current.y * el.offsetHeight
				};
			}
		});

		hostRef.current = host;
		stage.appendChild(host.el);

		return () => {
			host.destroy();
			hostRef.current = undefined;
		};
	}, []);

	React.useEffect(() => {
		hostRef.current?.set(params);
	}, [params]);

	React.useEffect(() => {
		hostRef.current?.sprite(url);
	}, [url]);

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
		<div className="particle-preview" ref={stageRef} style={{height: STAGE}}>
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
