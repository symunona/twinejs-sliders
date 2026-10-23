import {act, render} from '@testing-library/react';
import * as React from 'react';
import {AssetResolver, Stage} from '@sliders/scene-types';
import {SceneStage} from '../scene-stage';

const mockRenderer = {
	apply: jest.fn(),
	characterOf: jest.fn(),
	cue: jest.fn(),
	destroy: jest.fn(),
	invalidate: jest.fn(),
	mount: jest.fn(),
	setMuted: jest.fn(),
	setViewScale: jest.fn(),
	setWaitingForClick: jest.fn()
};

const mockDialogue = {
	destroy: jest.fn(),
	mount: jest.fn(),
	setBox: jest.fn(),
	setBubbles: jest.fn()
};

// Plain functions, not `jest.fn`: this project runs with `resetMocks`, which strips a mock's
// implementation before every test, and a constructor that has lost its implementation hands
// back an empty object -- "renderer.mount is not a function" from inside the component.
jest.mock('@sliders/render-dom', () => ({
	...jest.requireActual('@sliders/render-dom'),
	DialogueLayer: function DialogueLayer() {
		return mockDialogue;
	},
	DomRenderer: function DomRenderer() {
		return mockRenderer;
	}
}));

const assets: AssetResolver = {
	character: jest.fn().mockResolvedValue(undefined),
	meta: jest.fn().mockResolvedValue(undefined),
	url: jest.fn().mockResolvedValue('blob:one')
};

const stage: Stage = {
	entities: {hero: {at: {x: 0, y: 0}, id: 'hero', ref: 'hero-idle', z: 1}}
} as unknown as Stage;

/** Lets the renderer's `mount()` promise resolve, which is what flips `ready`. */
async function mounted() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

beforeEach(() => {
	// Same reason: `resetMocks` cleared these between tests, so the two the component
	// awaits have to be given their promises back.
	mockRenderer.apply.mockResolvedValue(undefined);
	mockRenderer.mount.mockResolvedValue(undefined);
	(assets.url as jest.Mock).mockResolvedValue('blob:one');
	(assets.meta as jest.Mock).mockResolvedValue(undefined);
	(assets.character as jest.Mock).mockResolvedValue(undefined);
});

describe('SceneStage asset revision', () => {
	it('drops what the renderer cached when the library changes', async () => {
		// The bug: the asset editor writes an edit back over an asset, which keeps its id
		// and revokes the object URL the renderer is holding. Nothing about the scene TEXT
		// changed, so no parse reaches the stage, and the sprite sits there pointing at a
		// dead blob URL until the passage is reopened.
		const {rerender} = render(
			<SceneStage assetRevision={1} assets={assets} stage={stage} />
		);

		await mounted();
		mockRenderer.apply.mockClear();

		rerender(<SceneStage assetRevision={2} assets={assets} stage={stage} />);
		await mounted();

		expect(mockRenderer.invalidate).toHaveBeenCalled();
		expect(mockRenderer.apply).toHaveBeenCalled();
	});

	it('re-applies without animating, because a redraw is not a beat', async () => {
		const {rerender} = render(
			<SceneStage animate assetRevision={1} assets={assets} stage={stage} />
		);

		await mounted();
		mockRenderer.apply.mockClear();

		rerender(
			<SceneStage animate assetRevision={2} assets={assets} stage={stage} />
		);
		await mounted();

		expect(mockRenderer.apply).toHaveBeenCalledWith(stage, []);
	});

	it('invalidates nothing on mount, when the cache is empty anyway', async () => {
		render(<SceneStage assetRevision={7} assets={assets} stage={stage} />);
		await mounted();

		expect(mockRenderer.invalidate).not.toHaveBeenCalled();
	});

	it('invalidates nothing when the library held still', async () => {
		const {rerender} = render(
			<SceneStage assetRevision={3} assets={assets} stage={stage} />
		);

		await mounted();
		rerender(<SceneStage assetRevision={3} assets={assets} muted stage={stage} />);
		await mounted();

		expect(mockRenderer.invalidate).not.toHaveBeenCalled();
	});
});

describe('SceneStage play stop', () => {
	const entity = {id: 'hero', opacity: 1, ref: 'hero-idle', scale: 1, z: 1};
	const start: Stage = {
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: {hero: {...entity, at: {x: -1.2, y: 0}}},
		fx: []
	} as unknown as Stage;
	const landed: Stage = {
		...start,
		entities: {hero: {...entity, at: {x: 0.5, y: 0}}}
	} as unknown as Stage;

	it('lets the last beat finish moving when playback stops on it', async () => {
		// The bug: play reaches the last beat, the preview stops playing in the same tick,
		// and `animate` going false re-applied the SAME stage with zero durations. Applied in
		// the same task as the move, it wrote `transition-duration: 0s` before the browser
		// ever started the move — the drone landed in one frame instead of three seconds.
		const {rerender} = render(
			<SceneStage animate assets={assets} stage={start} />
		);

		await mounted();
		rerender(<SceneStage animate assets={assets} stage={landed} />);
		await mounted();
		mockRenderer.apply.mockClear();

		rerender(<SceneStage animate={false} assets={assets} stage={landed} />);
		await mounted();

		expect(mockRenderer.apply).not.toHaveBeenCalled();
	});

	it('still snaps the next stage once playback stopped', async () => {
		const {rerender} = render(
			<SceneStage animate assets={assets} stage={start} />
		);

		await mounted();
		rerender(<SceneStage animate={false} assets={assets} stage={start} />);
		rerender(<SceneStage animate={false} assets={assets} stage={landed} />);
		await mounted();

		const [, transitions] = mockRenderer.apply.mock.calls[
			mockRenderer.apply.mock.calls.length - 1
		];

		expect(transitions.length).toBeGreaterThan(0);
		expect(transitions.every((t: {duration: number}) => t.duration === 0)).toBe(
			true
		);
	});
});

describe('SceneStage still', () => {
	it('holds everything still unless playing', async () => {
		const {container, rerender} = render(
			<SceneStage animate={false} assets={assets} stage={stage} />
		);
		const host = () => container.querySelector('.scene-stage');

		await mounted();
		expect(host()).toHaveClass('still');

		rerender(<SceneStage animate assets={assets} stage={stage} />);
		await mounted();
		expect(host()).not.toHaveClass('still');

		rerender(<SceneStage animate={false} assets={assets} stage={stage} />);
		await mounted();
		expect(host()).toHaveClass('still');
	});
});

describe('SceneStage wait cue', () => {
	it('hands the wait to the renderer', async () => {
		const {rerender} = render(<SceneStage assets={assets} stage={stage} />);

		await mounted();
		expect(mockRenderer.setWaitingForClick).toHaveBeenLastCalledWith(false);

		rerender(<SceneStage assets={assets} stage={stage} waitingForClick />);
		expect(mockRenderer.setWaitingForClick).toHaveBeenLastCalledWith(true);
	});
});
