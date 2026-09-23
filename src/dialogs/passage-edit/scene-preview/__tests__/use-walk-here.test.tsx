import type {DomRenderer} from '@sliders/render-dom';
import type {
	AssetMeta,
	AssetResolver,
	Character,
	Stage
} from '@sliders/scene-types';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {
	bgFxMovesFloor,
	useWalkHere,
	WalkHereInfo,
	WalkHereRequest
} from '../use-walk-here';

const ROOM: AssetMeta = {
	animated: false,
	bytes: 1,
	h: 900,
	hash: 'h',
	id: 'a_room',
	kind: 'bg',
	mime: 'image/png',
	name: 'room',
	tags: [],
	w: 1600,
	walk: {
		shapes: [
			{
				id: 's1',
				op: 'walk',
				points: [
					{x: 0, y: 0.5},
					{x: 1, y: 0.5},
					{x: 1, y: 1},
					{x: 0, y: 1}
				]
			}
		]
	}
};

const KATE: Character = {
	id: 'kate',
	name: 'Kate',
	origin: {x: 0.5, y: 1},
	poses: {
		idle: {asset: 'a_idle'},
		walk: {steps: [{asset: 'a_w1'}, {asset: 'a_w2'}]}
	},
	size: {h: 1000, w: 400},
	tags: []
};

function resolver(meta: AssetMeta = ROOM): AssetResolver {
	return {
		character: async id => (id === 'kate' ? KATE : undefined),
		meta: async id => (id === meta.name ? meta : undefined),
		url: async () => 'data:,'
	};
}

function stage(patch: Partial<Stage> = {}): Stage {
	return {
		bg: 'room',
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: {
			kate: {
				at: {x: -0.5, y: -0.6},
				flip: false,
				id: 'kate',
				kind: 'cast',
				opacity: 1,
				ref: 'kate',
				scale: 1
			}
		},
		fx: [],
		...patch
	};
}

const renderer = {
	stageBox: () => ({height: 900, left: 0, top: 0, width: 1600})
} as unknown as DomRenderer;

let seen: {info?: WalkHereInfo; drawn?: Stage};

const Probe: React.FC<{
	assets: AssetResolver;
	request?: WalkHereRequest;
	stage: Stage;
}> = props => {
	const walk = useWalkHere({
		assets: props.assets,
		renderer,
		request: props.request,
		stage: props.stage
	});

	seen = {drawn: walk.decorate(props.stage), info: walk.info};

	return <div style={{position: 'relative'}}>{walk.layer}</div>;
};

beforeEach(() => {
	seen = {};
});

describe('bgFxMovesFloor', () => {
	it('blocks the motions that slide the floor, not a shudder', () => {
		expect(bgFxMovesFloor('parallax_left')).toBe(true);
		expect(bgFxMovesFloor('scroll_infinite_up')).toBe(true);
		expect(bgFxMovesFloor('circling')).toBe(true);
		expect(bgFxMovesFloor('earthquake')).toBe(false);
		expect(bgFxMovesFloor(undefined)).toBe(false);
	});
});

describe('useWalkHere', () => {
	it('does nothing while off', () => {
		render(<Probe assets={resolver()} stage={stage()} />);

		expect(screen.queryByTestId('scene-walk-here')).toBeNull();
		expect(seen.drawn!.entities.kate.steps).toBeUndefined();
	});

	it('lists the cast and walks the first of them to a click, as steps', async () => {
		render(
			<Probe assets={resolver()} request={{on: true}} stage={stage()} />
		);

		await waitFor(() => expect(seen.info?.cast).toEqual([{id: 'kate', name: 'Kate'}]));
		await screen.findByTestId('scene-walk-here');
		expect(seen.info!.blocked).toBeUndefined();

		// Mount px: right half of the stage, low down.
		act(() => {
			fireEvent.pointerDown(screen.getByTestId('scene-walk-here'), {
				button: 0,
				clientX: 1200,
				clientY: 800
			});
		});

		const walker = seen.drawn!.entities.kate;

		expect(walker.poseLoop).toBe('once');
		expect(walker.steps![0].name).toBe('walk#1');
		expect(walker.steps![walker.steps!.length - 1].name).toBe('idle');
		// The walk is laid over the drawing; the entity's own place is untouched.
		expect(walker.at).toEqual({x: -0.5, y: -0.6});
	});

	it('says why when the backdrop has no walk area', async () => {
		render(
			<Probe
				assets={resolver({...ROOM, walk: undefined})}
				request={{on: true}}
				stage={stage()}
			/>
		);

		await waitFor(() => expect(seen.info?.blocked).toBe('noArea'));
		expect(screen.queryByTestId('scene-walk-here')).toBeNull();
	});

	it('is off on a scrolling backdrop', async () => {
		render(
			<Probe
				assets={resolver()}
				request={{on: true}}
				stage={stage({bgFx: {id: 'scroll_infinite_left'}})}
			/>
		);

		await waitFor(() => expect(seen.info?.blocked).toBe('moving'));
		expect(seen.info!.fx).toBe('scroll_infinite_left');
	});
});
