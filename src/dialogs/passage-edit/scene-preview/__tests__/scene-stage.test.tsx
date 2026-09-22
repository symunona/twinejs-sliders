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
	setMuted: jest.fn()
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
