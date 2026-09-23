import {
	characterMetrics,
	STAGE_ASPECT
} from '@sliders/render-dom';
import {
	AssetId,
	Character,
	Frac2,
	poseCover,
	SceneStep,
	splitPoseImage,
	Vec2
} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {ArtRect} from '../../components/anchor/use-art-rect';

/**
 * The image a step name draws: a pose's cover, or one image of it (`walk#3`). The same
 * reading the renderer's `resolvePose` makes, for a sprite that is not the renderer's.
 */
export function stepImage(
	character: Character | undefined,
	name: string | undefined
): AssetId | undefined {
	const poses = character?.poses ?? {};

	if (!name) {
		return undefined;
	}

	if (name in poses) {
		return poseCover(poses[name]);
	}

	const image = splitPoseImage(name);
	const pose = image && poses[image.pose];

	if (!image || !pose) {
		return undefined;
	}

	if (pose.steps?.length) {
		return pose.steps[image.index]?.asset;
	}

	return image.index === 0 ? pose.asset : undefined;
}

/**
 * Which way the ghost faces once a walk is over: the way its last step faced. A walk that
 * ends facing left must not snap back to the art's own facing when it stops.
 */
export function facingAfter(steps: SceneStep[], before: boolean): boolean {
	const last = steps[steps.length - 1];

	return last?.flip === undefined ? before : last.flip;
}

/**
 * A compiled walk being played on the ghost: the renderer's step list, its start, and
 * how to put a step's scene `at` back over the art.
 */
export interface GhostWalk {
	steps: SceneStep[];
	/** Source fraction the walk starts from. */
	from: Frac2;
	startedAt: number;
	/** Scene coords → source fraction. */
	toSource: (at: Vec2) => Frac2;
}

export interface WalkGhostProps {
	character?: Character;
	/** Object URLs for the character's images. */
	urls: Record<AssetId, string>;
	rect: ArtRect;
	/** The stage's height as a fraction of the art's height. */
	stageHeight: number;
	/** Where the feet are, source fraction, when not walking. */
	at: Frac2;
	/** Depth scale at `at`. */
	scale: number;
	/** Pose drawn when not walking. */
	pose: string;
	flip?: boolean;
	/** Off the floor: drawn red. */
	invalid?: boolean;
	walk?: GhostWalk;
	onWalkEnd?: () => void;
	/** A press on the sprite, to drag it. Absent = not draggable. */
	onPointerDown?: (event: React.PointerEvent) => void;
}

interface Frame {
	at: Frac2;
	scale: number;
	flip: boolean;
	name: string;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/**
 * Where a walk is `seconds` in: each step glides linearly from where the one before left
 * the feet, exactly as the renderer's step clock plays it.
 */
export function walkFrame(walk: GhostWalk, seconds: number): Frame | undefined {
	let start = 0;
	let from = walk.from;
	let fromScale = walk.steps[0]?.scale ?? 1;

	for (let index = 0; index < walk.steps.length; index++) {
		const step = walk.steps[index];
		const dur = step.dur ?? 0.1;
		const to = step.at ? walk.toSource(step.at) : from;
		const toScale = step.scale ?? fromScale;

		if (seconds < start + dur || index === walk.steps.length - 1) {
			const t = Math.min(1, Math.max(0, (seconds - start) / dur));

			return {
				at: {x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t)},
				flip: !!step.flip,
				name: step.name,
				scale: lerp(fromScale, toScale, t)
			};
		}

		start += dur;
		from = to;
		fromScale = toScale;
	}

	return undefined;
}

/** Seconds a walk takes, first step to last. */
export function walkSeconds(walk: Pick<GhostWalk, 'steps'>): number {
	return walk.steps.reduce((sum, step) => sum + (step.dur ?? 0.1), 0);
}

/**
 * The ghost character: one sprite over the art, feet on a point, sized the way the
 * renderer sizes a cast member — `characterMetrics` against a stage box as tall as the
 * stage is over this picture, at the depth scale. Plays a compiled walk on rAF when given
 * one.
 */
export const WalkGhost: React.FC<WalkGhostProps> = props => {
	const {
		at,
		character,
		invalid,
		onPointerDown,
		onWalkEnd,
		pose,
		rect,
		scale,
		stageHeight,
		urls,
		walk
	} = props;
	const [now, setNow] = React.useState(0);
	const ended = React.useRef<GhostWalk>();

	React.useEffect(() => {
		if (!walk) {
			return;
		}

		let frame = 0;
		const total = walkSeconds(walk);
		const tick = () => {
			const seconds = (performance.now() - walk.startedAt) / 1000;

			setNow(seconds);

			if (seconds < total) {
				frame = requestAnimationFrame(tick);
			} else if (ended.current !== walk) {
				ended.current = walk;
				onWalkEnd?.();
			}
		};

		frame = requestAnimationFrame(tick);

		return () => cancelAnimationFrame(frame);
		// `onWalkEnd` is read fresh on the frame it fires; restarting the clock because a
		// parent re-rendered would replay the walk.
	}, [walk]);

	if (!character) {
		return null;
	}

	const shown: Frame = (walk && walkFrame(walk, now)) || {
		at,
		flip: !!props.flip,
		name: pose,
		scale
	};
	const stagePx = stageHeight * rect.height;
	const metrics = characterMetrics(
		{height: stagePx, left: 0, top: 0, width: stagePx * STAGE_ASPECT},
		character,
		shown.scale
	);
	const asset = stepImage(character, shown.name);
	const url = asset ? urls[asset] : undefined;
	const left = rect.left + shown.at.x * rect.width - metrics.origin.x * metrics.width;
	const top = rect.top + shown.at.y * rect.height - metrics.origin.y * metrics.height;

	return (
		<div
			className={classNames('walk-ghost', {
				draggable: !!onPointerDown,
				invalid,
				walking: !!walk
			})}
			data-pose={shown.name}
			data-scale={shown.scale.toFixed(3)}
			data-testid="walk-ghost"
			onPointerDown={onPointerDown}
			style={{
				height: metrics.height,
				left,
				top,
				transform: shown.flip ? 'scaleX(-1)' : undefined,
				transformOrigin: `${metrics.origin.x * 100}% ${metrics.origin.y * 100}%`,
				width: metrics.width
			}}
		>
			{url ? (
				<img
					alt=""
					draggable={false}
					src={url}
					style={{
						objectPosition: `${metrics.origin.x * 100}% ${metrics.origin.y * 100}%`
					}}
				/>
			) : (
				<span className="walk-ghost-placeholder" />
			)}
		</div>
	);
};
