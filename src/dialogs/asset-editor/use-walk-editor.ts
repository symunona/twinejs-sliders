import type {AssetStore} from '@sliders/asset-store';
import {
	compileWalk,
	depthScale,
	findWalkPath,
	hasWalkArea,
	idlePoseName,
	isWalkable,
	remapWalkArea,
	snapToWalk,
	stageToImage
} from '@sliders/scene-core';
import {
	AssetId,
	Character,
	Frac2,
	poseAssets,
	WalkArea,
	WalkOp
} from '@sliders/scene-types';
import * as React from 'react';
import {MaskToolId} from './mask-shapes';
import {GhostWalk} from './walk-ghost';
import {bakedSize, frameToBaked, frameToSource, WalkFrame} from './walk-shapes';

/** The ghost character an author last picked, across dialogs. Per browser, not per story. */
const GHOST_KEY = 'sliders.walk.ghost';

function readGhostId(): string | undefined {
	try {
		return window.localStorage.getItem(GHOST_KEY) ?? undefined;
	} catch {
		return undefined;
	}
}

function writeGhostId(id: string | undefined) {
	try {
		if (id) {
			window.localStorage.setItem(GHOST_KEY, id);
		}
	} catch {
		// Private windows throw. Remembering the ghost is a nicety.
	}
}

/** The last walk-here, drawn as a polyline. SOURCE fractions. */
export interface WalkPreviewPath {
	points: Frac2[];
	/** Where the author clicked. A dashed line runs to it when the walk fell short. */
	click: Frac2;
	reached: boolean;
	/** False when the character had no `walk` pose and glided. */
	walkPose: boolean;
}

export interface WalkEditor {
	tool: MaskToolId;
	setTool: (tool: MaskToolId) => void;
	/** What the next ring drawn is, until a shape is picked to edit instead. */
	op: WalkOp;
	setOp: (op: WalkOp) => void;
	selected?: string;
	setSelected: (id: string | undefined) => void;
	walkHere: boolean;
	setWalkHere: (on: boolean) => void;
	characters: Character[];
	ghostId?: string;
	setGhostId: (id: string | undefined) => void;
	ghost?: Character;
	urls: Record<AssetId, string>;
	/** Feet, SOURCE fraction. */
	ghostAt: Frac2;
	setGhostAt: (at: Frac2) => void;
	/** Put the ghost down: snapped onto the floor when it was dropped off it. */
	dropGhost: () => void;
	/** Off the floor, with a floor to be on. */
	ghostOff: boolean;
	/** Depth scale where the ghost stands. */
	ghostScale: number;
	ghostPose: string;
	walking?: GhostWalk;
	endWalk: () => void;
	path?: WalkPreviewPath;
	/** Walk the ghost to a SOURCE fraction. */
	walkTo: (click: Frac2) => void;
	/** The walk area as a save would store it, before clipping. What the maths runs on. */
	baked: WalkArea;
}

/**
 * The walk tool's working state: which gesture, which op, the ghost, the last walk. None
 * of it is saved -- the walk area itself is the dialog's, beside the mask, because `dirty`
 * and both saves read it.
 *
 * Everything on screen is in SOURCE fractions; everything handed to `scene-core` is in the
 * baked picture's, through `frame`. Path, snap and depth are asked of the picture the
 * player will draw, not of the one the editor happens to show.
 */
export function useWalkEditor(options: {
	store: AssetStore;
	walk: WalkArea;
	frame?: WalkFrame;
	/** The tool is open. Characters are only listed once it is. */
	active: boolean;
}): WalkEditor {
	const {active, frame, store, walk} = options;
	const [tool, setTool] = React.useState<MaskToolId>('polygon');
	const [op, setOp] = React.useState<WalkOp>('walk');
	const [selected, setSelected] = React.useState<string>();
	const [walkHere, setWalkHere] = React.useState(false);
	const [characters, setCharacters] = React.useState<Character[]>([]);
	const [ghostId, setGhostIdState] = React.useState<string | undefined>(
		readGhostId
	);
	const [urls, setUrls] = React.useState<Record<AssetId, string>>({});
	const [ghostAt, setGhostAt] = React.useState<Frac2>();
	const [walking, setWalking] = React.useState<GhostWalk>();
	const [path, setPath] = React.useState<WalkPreviewPath>();

	React.useEffect(() => {
		if (!active) {
			return;
		}

		let current = true;

		store.listCharacters().then(list => {
			if (current) {
				setCharacters(list);
			}
		});

		return () => {
			current = false;
		};
	}, [active, store]);

	const ghost =
		characters.find(character => character.id === ghostId) ?? characters[0];

	React.useEffect(() => {
		if (!ghost) {
			return;
		}

		let current = true;
		const ids = Object.values(ghost.poses ?? {}).flatMap(poseAssets);

		Promise.all(ids.map(async id => [id, await store.url(id)] as const)).then(
			pairs => {
				if (current) {
					setUrls(
						Object.fromEntries(
							pairs.filter((pair): pair is [string, string] => !!pair[1])
						)
					);
				}
			}
		);

		return () => {
			current = false;
		};
	}, [ghost, store]);

	const baked = React.useMemo(
		() => (frame ? remapWalkArea(walk, p => frameToBaked(frame, p), false) : walk),
		[frame, walk]
	);
	const img = frame ? bakedSize(frame) : undefined;
	const toBaked = React.useCallback(
		(p: Frac2) => (frame ? frameToBaked(frame, p) : p),
		[frame]
	);
	const toSource = React.useCallback(
		(p: Frac2) => (frame ? frameToSource(frame, p) : p),
		[frame]
	);

	// First floor point, or the bottom middle. Only until the author moves the ghost.
	const defaultAt = React.useMemo(() => {
		const snapped = snapToWalk(baked, {x: 0.5, y: 0.85}, img);

		return snapped ? toSource(snapped) : toSource({x: 0.5, y: 0.85});
		// Deliberately not keyed on `baked`: the default is where the ghost STARTS, and it
		// must not jump every time a corner is dragged.
	}, [img?.w, img?.h, toSource, hasWalkArea(baked)]);
	const at = ghostAt ?? defaultAt;
	const bakedAt = toBaked(at);
	const floor = hasWalkArea(baked);

	function setGhostId(id: string | undefined) {
		setGhostIdState(id);
		writeGhostId(id);
		setWalking(undefined);
	}

	function dropGhost() {
		if (!floor || isWalkable(baked, bakedAt)) {
			return;
		}

		const snapped = snapToWalk(baked, bakedAt, img);

		if (snapped) {
			setGhostAt(toSource(snapped));
		}
	}

	function walkTo(click: Frac2) {
		if (!ghost || !img) {
			return;
		}

		const found = findWalkPath(baked, bakedAt, toBaked(click), img);

		if (!found) {
			return;
		}

		const compiled = compileWalk({
			character: ghost,
			depth: baked.depth,
			img,
			path: found.points
		});
		const points = found.points.map(toSource);

		setPath({click, points, reached: found.reached, walkPose: compiled.walkPose});
		setWalking({
			from: points[0],
			startedAt: performance.now(),
			steps: compiled.steps,
			toSource: v => toSource(stageToImage(v, img))
		});
		setGhostAt(toSource(found.goal));
	}

	// A walk belongs to the gesture that started it. Leaving walk-here ends it and wipes
	// the line, so it does not reappear stale when the mode comes back.
	React.useEffect(() => {
		if (!walkHere) {
			setWalking(undefined);
			setPath(undefined);
		}
	}, [walkHere]);

	return {
		baked,
		characters,
		dropGhost,
		endWalk: () => setWalking(undefined),
		ghost,
		ghostAt: at,
		ghostId: ghost?.id,
		ghostOff: floor && !isWalkable(baked, bakedAt),
		ghostPose: ghost ? idlePoseName(ghost) : 'idle',
		ghostScale: depthScale(baked.depth, bakedAt.y),
		op,
		path,
		selected,
		setGhostAt: next => {
			setWalking(undefined);
			setGhostAt(next);
		},
		setGhostId,
		setOp,
		setSelected,
		setTool,
		setWalkHere,
		tool,
		urls,
		walkHere,
		walkTo,
		walking
	};
}
