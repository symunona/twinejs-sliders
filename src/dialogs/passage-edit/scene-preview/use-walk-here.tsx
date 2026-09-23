import type {DomRenderer} from '@sliders/render-dom';
import {
	compileWalk,
	findWalkPath,
	hasWalkArea,
	imageToStage,
	stageToImage
} from '@sliders/scene-core';
import type {
	AssetMeta,
	AssetResolver,
	Character,
	SceneStep,
	Stage,
	Vec2
} from '@sliders/scene-types';
import * as React from 'react';
import {mountToScene} from './stage-geometry';

/** What the dialog asks for: walk-here on or off, and who walks. */
export interface WalkHereRequest {
	on: boolean;
	/** Entity id. Absent = the first cast member on stage. */
	walker?: string;
}

/**
 * What the preview tells the dialog about the beat on screen, so the dialog can fill its
 * walker list and say why walk-here does nothing.
 */
export interface WalkHereInfo {
	cast: {id: string; name: string}[];
	/** The walker actually used. */
	walker?: string;
	/**
	 * Why a click will not walk: `noBg`, `noArea`, `moving`, `noCast`. The dialog turns it
	 * into words; the preview only knows the reason.
	 */
	blocked?: 'noBg' | 'noArea' | 'moving' | 'noCast';
	/** The backdrop's motion, for the `moving` note. */
	fx?: string;
	/** The walker has no `walk` pose and glides. */
	noWalkPose?: boolean;
	/** The last click was on another island. */
	unreachable?: boolean;
}

/**
 * Backdrop motions that move the floor out from under the feet. A shudder does not, and a
 * story's own `fx:` token is its own business, so only these three families block.
 */
export function bgFxMovesFloor(id: string | undefined): boolean {
	return (
		!!id &&
		(id.startsWith('parallax_') || id.startsWith('scroll_') || id === 'circling')
	);
}

export function sameWalkHereInfo(a: WalkHereInfo, b: WalkHereInfo): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

interface ActiveWalk {
	walker: string;
	steps: SceneStep[];
	/** Where it ends, scene coords — where the next walk starts. */
	goal: Vec2;
	/** Identity of the beat it was walked on. A new beat drops it. */
	key: string;
}

/**
 * Walk-here in the scene preview (walk-area.md): a click on the stage walks one cast
 * member there over the CURRENT beat's backdrop walk area.
 *
 * Preview only. It never writes YAML: the walk is a scene step list laid over the drawn
 * stage — exactly what a compiled walk will be in the player — and it is dropped the
 * moment the beat, the backdrop or the walker changes.
 */
export function useWalkHere(options: {
	assets: AssetResolver;
	/** The stage as drawn, resolved to absolute coordinates. */
	stage: Stage;
	renderer?: DomRenderer;
	request?: WalkHereRequest;
	/** Bumped when the library changes, so an edited walk area is read again. */
	libraryVersion?: number;
}): {
	decorate: (stage: Stage) => Stage;
	layer: React.ReactNode;
	info: WalkHereInfo;
} {
	const {assets, libraryVersion, renderer, request, stage} = options;
	const on = !!request?.on;
	const [bgMeta, setBgMeta] = React.useState<AssetMeta>();
	const [characters, setCharacters] = React.useState<Record<string, Character>>(
		{}
	);
	const [walk, setWalk] = React.useState<ActiveWalk>();
	const [unreachable, setUnreachable] = React.useState(false);
	const castIds = React.useMemo(
		() =>
			Object.values(stage.entities ?? {})
				.filter(entity => entity.kind !== 'prop' && !entity.fit)
				.map(entity => `${entity.id}\u0000${entity.ref}`)
				.join('\u0001'),
		[stage.entities]
	);

	React.useEffect(() => {
		if (!on || !stage.bg) {
			setBgMeta(undefined);
			return;
		}

		let current = true;

		assets.meta(stage.bg).then(meta => {
			if (current) {
				setBgMeta(meta);
			}
		});

		return () => {
			current = false;
		};
	}, [assets, libraryVersion, on, stage.bg]);

	React.useEffect(() => {
		if (!on) {
			return;
		}

		let current = true;
		const pairs = castIds
			.split('\u0001')
			.filter(Boolean)
			.map(pair => pair.split('\u0000'));

		Promise.all(
			pairs.map(async ([id, ref]) => [id, await assets.character(ref)] as const)
		).then(list => {
			if (current) {
				setCharacters(
					Object.fromEntries(
						list.filter((pair): pair is [string, Character] => !!pair[1])
					)
				);
			}
		});

		return () => {
			current = false;
		};
	}, [assets, castIds, libraryVersion, on]);

	const cast = Object.keys(characters)
		.filter(id => stage.entities?.[id])
		.map(id => ({id, name: characters[id].name || id}));
	const walkerId =
		request?.walker && characters[request.walker] ? request.walker : cast[0]?.id;
	const walker = walkerId ? characters[walkerId] : undefined;
	const entity = walkerId ? stage.entities?.[walkerId] : undefined;
	const area = bgMeta?.walk;
	const fx = stage.bgFx?.id;
	const blocked: WalkHereInfo['blocked'] = !stage.bg
		? 'noBg'
		: bgFxMovesFloor(fx)
		? 'moving'
		: !hasWalkArea(area)
		? 'noArea'
		: !walker
		? 'noCast'
		: undefined;
	/** A walk belongs to one beat on one backdrop, walked by one character from one spot. */
	const key = `${stage.bg}\u0000${walkerId}\u0000${entity?.at.x}\u0000${entity?.at.y}`;

	React.useEffect(() => {
		setWalk(current => (current && current.key !== key ? undefined : current));
		setUnreachable(false);
	}, [key, on]);

	function walkTo(target: Vec2) {
		if (blocked || !walker || !entity || !bgMeta || !walkerId) {
			return;
		}

		const img = {h: bgMeta.h, w: bgMeta.w};
		const from = walk?.walker === walkerId ? walk.goal : entity.at;
		const found = findWalkPath(
			area,
			stageToImage(from, img),
			stageToImage(target, img),
			img
		);

		if (!found) {
			return;
		}

		const compiled = compileWalk({
			character: walker,
			depth: area?.depth,
			flip: entity.flip,
			img,
			path: found.points,
			scale: entity.scale
		});

		setUnreachable(!found.reached);
		setWalk({
			goal: imageToStage(found.goal, img),
			key,
			steps: compiled.steps,
			walker: walkerId
		});
	}

	const active = on && walk && walk.key === key ? walk : undefined;

	const decorate = React.useCallback(
		(drawn: Stage): Stage => {
			const target = active && drawn.entities?.[active.walker];

			if (!target) {
				return drawn;
			}

			return {
				...drawn,
				entities: {
					...drawn.entities,
					[active.walker]: {
						...target,
						pose: active.steps[0]?.name,
						poseLoop: 'once',
						steps: active.steps
					}
				}
			};
		},
		[active]
	);

	const layer =
		on && !blocked && renderer ? (
			<div
				className="scene-walk-here"
				data-testid="scene-walk-here"
				// Inline rather than in a stylesheet: one sheet over the stage, above the
				// renderer's isolated host, and nothing else to style.
				style={{
					bottom: 0,
					cursor: 'crosshair',
					left: 0,
					position: 'absolute',
					right: 0,
					top: 0,
					zIndex: 1
				}}
				onDoubleClick={event => event.stopPropagation()}
				onPointerDown={event => {
					// The stage editor under this would select, drag or pan. A walk-here
					// click is none of those, and never a text edit.
					event.stopPropagation();
					event.preventDefault();

					if (event.button !== 0) {
						return;
					}

					const box = event.currentTarget.getBoundingClientRect();

					walkTo(
						mountToScene(renderer.stageBox(), stage.camera, {
							x: event.clientX - box.left,
							y: event.clientY - box.top
						})
					);
				}}
			/>
		) : null;

	return {
		decorate,
		info: {
			blocked,
			cast,
			fx: blocked === 'moving' ? fx : undefined,
			noWalkPose: !!walker && !walker.poses?.walk,
			unreachable,
			walker: walkerId
		},
		layer
	};
}
