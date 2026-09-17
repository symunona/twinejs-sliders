import {computeStageBox} from '@sliders/render-dom';
import type {Rect} from '@sliders/render-dom';
import type {
	Camera,
	EntityId,
	Stage,
	StageEntity
} from '@sliders/scene-types';
import {
	DESIGN_HEIGHT,
	DESIGN_WIDTH,
	entityTraces,
	ghostRect,
	hasGhosts,
	imagePoint
} from '../stage-history';
import {sceneToMount} from '../stage-geometry';

const BOX = computeStageBox(1600, 900);
const CAMERA: Camera = {at: {x: 0, y: 0}, zoom: 1};

function entity(
	id: EntityId,
	at: {x: number; y: number},
	scale = 1
): StageEntity {
	return {at, flip: false, id, kind: 'cast', opacity: 1, ref: id, scale};
}

function stageOf(...entities: StageEntity[]): Stage {
	return {
		entities: Object.fromEntries(entities.map(e => [e.id, e])),
		fx: {}
	} as Stage;
}

/** A rect whose origin (bottom centre) lands exactly on `at`. */
function rectAt(at: {x: number; y: number}, width = 200, height = 400): Rect {
	const origin = sceneToMount(BOX, CAMERA, at);

	return {height, left: origin.x - width / 2, top: origin.y - height, width};
}

describe('imagePoint', () => {
	it('maps the stage corners onto the design resolution', () => {
		expect(DESIGN_WIDTH).toBe(1920);
		expect(DESIGN_HEIGHT).toBe(1080);
		expect(imagePoint({x: 0, y: 0})).toEqual({x: 960, y: 540});
		expect(imagePoint({x: -1, y: 1})).toEqual({x: 0, y: 0});
		expect(imagePoint({x: 1, y: -1})).toEqual({x: 1920, y: 1080});
	});

	it('rounds to whole pixels', () => {
		expect(imagePoint({x: 0.123, y: -0.456})).toEqual({x: 1078, y: 786});
	});
});

describe('ghostRect', () => {
	const rect: Rect = {height: 400, left: 100, top: 200, width: 200};
	const fraction = {x: 0.5, y: 1};

	it('puts the origin fraction on the given origin point', () => {
		const ghost = ghostRect(rect, fraction, {x: 500, y: 700}, 1);

		expect(ghost).toEqual({height: 400, left: 400, top: 300, width: 200});
	});

	it('scales about that origin, so feet stay on the floor', () => {
		const ghost = ghostRect(rect, fraction, {x: 500, y: 700}, 0.5);

		expect(ghost.width).toBe(100);
		expect(ghost.height).toBe(200);
		expect(ghost.left + ghost.width * fraction.x).toBe(500);
		expect(ghost.top + ghost.height * fraction.y).toBe(700);
	});
});

describe('entityTraces', () => {
	const now = entity('mira', {x: 0.4, y: -0.8});
	const rects = new Map<EntityId, Rect>([['mira', rectAt({x: 0.4, y: -0.8})]]);

	function traces(orig?: Stage, prev?: Stage) {
		return entityTraces({
			box: BOX,
			camera: CAMERA,
			orig,
			prev,
			rects,
			stage: stageOf(now)
		});
	}

	it('reports the measured rect for the present', () => {
		const [trace] = traces();

		expect(trace.now.rect).toEqual(rects.get('mira'));
		expect(trace.now.at).toEqual({x: 0.4, y: -0.8});
		expect(hasGhosts(trace)).toBe(false);
	});

	it('has no ghost when nothing moved', () => {
		const [trace] = traces(
			stageOf(entity('mira', {x: 0.4, y: -0.8})),
			stageOf(entity('mira', {x: 0.4, y: -0.8}))
		);

		expect(trace.orig).toBeUndefined();
		expect(trace.prev).toBeUndefined();
	});

	it('derives the arrival ghost from the current rect', () => {
		const [trace] = traces(stageOf(entity('mira', {x: -0.5, y: -0.8})));

		expect(trace.orig?.kind).toBe('orig');
		expect(trace.orig?.at).toEqual({x: -0.5, y: -0.8});
		expect(trace.orig?.pixel).toEqual(imagePoint({x: -0.5, y: -0.8}));
		// Same sprite, same size, only moved.
		expect(trace.orig?.rect.width).toBe(trace.now.rect.width);
		expect(trace.orig?.rect.height).toBe(trace.now.rect.height);
		expect(trace.orig?.rect).toEqual(rectAt({x: -0.5, y: -0.8}));
		expect(hasGhosts(trace)).toBe(true);
	});

	it('shrinks the ghost when the entity has been scaled up since', () => {
		const scaled = stageOf(entity('mira', {x: 0.4, y: -0.8}, 2));
		const [trace] = entityTraces({
			box: BOX,
			camera: CAMERA,
			orig: scaled,
			rects,
			stage: stageOf(now)
		});

		expect(trace.orig?.rect.width).toBe(trace.now.rect.width * 2);
		expect(trace.orig?.scale).toBe(2);
	});

	it('drops prev when it says the same thing as orig', () => {
		const was = stageOf(entity('mira', {x: -0.5, y: -0.8}));
		const [trace] = traces(was, stageOf(entity('mira', {x: -0.5, y: -0.8})));

		expect(trace.orig).toBeDefined();
		expect(trace.prev).toBeUndefined();
	});

	it('keeps prev when it differs from both', () => {
		const [trace] = traces(
			stageOf(entity('mira', {x: -0.5, y: -0.8})),
			stageOf(entity('mira', {x: 0, y: -0.8}))
		);

		expect(trace.orig?.at.x).toBe(-0.5);
		expect(trace.prev?.at.x).toBe(0);
	});

	it('gives no ghost for a state the entity was not in', () => {
		const [trace] = traces(stageOf(entity('tav', {x: 0, y: 0})));

		expect(trace.orig).toBeUndefined();
	});

	it('skips an entity the renderer has not measured', () => {
		expect(
			entityTraces({
				box: BOX,
				camera: CAMERA,
				rects: new Map(),
				stage: stageOf(now)
			})
		).toEqual([]);
	});

	it('gives up on a degenerate box rather than producing NaN rects', () => {
		expect(
			entityTraces({
				box: computeStageBox(0, 0),
				camera: CAMERA,
				rects,
				stage: stageOf(now)
			})
		).toEqual([]);
	});
});
