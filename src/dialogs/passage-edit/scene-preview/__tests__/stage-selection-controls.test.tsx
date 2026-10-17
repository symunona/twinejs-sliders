import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import type {AssetResolver, Character, Stage} from '@sliders/scene-types';
import {FakeStateProvider} from '../../../../test-util';
import {StageSelectionControls} from '../stage-selection-controls';
import {parseSceneText} from '../use-scene-parse';

const passage = [
	'[scene]',
	'cast:',
	'  mira: {at: -0.4, pose: angry}',
	'  joren: {at: 0.3, z: 2}',
	'props:',
	'  candle: {at: 0.4}'
].join('\n');

const stage: Stage = parseSceneText(passage).states[0];

const mira: Character = {
	poses: {angry: {asset: 'a_2'}, idle: {asset: 'a_1'}},
	id: 'mira',
	name: 'Mira',
	origin: {x: 0.5, y: 1},
	size: {w: 1, h: 2},
	tags: []
};

const assets = {
	character: async (id: string) => (id === 'mira' ? mira : undefined),
	meta: async () => undefined,
	url: async () => undefined
} as unknown as AssetResolver;

function renderControls(
	ids: string[],
	overrides: Partial<React.ComponentProps<typeof StageSelectionControls>> = {}
) {
	const handlers = {
		onDelete: jest.fn(),
		onFlip: jest.fn(),
		onPose: jest.fn(),
		onPreviewPose: jest.fn(),
		onStepZ: jest.fn()
	};

	render(
		<FakeStateProvider>
			<StageSelectionControls
				assets={assets}
				editable
				entities={ids.map(id => stage.entities[id])}
				{...handlers}
				{...overrides}
			/>
		</FakeStateProvider>
	);

	return handlers;
}

/**
 * i18n is not initialised under jest, so every `t()` is its own key here. Real pose names
 * come from the manifest and are unaffected; only the Automatic row is a key.
 */
const AUTO_LABEL = 'dialogs.passageEdit.scenePreview.poseAuto';

/**
 * The pose control's own button. Found structurally — it is the row's only `MenuButton` —
 * rather than by label: the row also holds flip, two depth steps and delete, their order is
 * not what these tests are about, and their labels are all keys in this environment.
 */
function poseButton(): HTMLButtonElement | undefined {
	return (
		document.querySelector<HTMLButtonElement>(
			'.scene-preview-selection .menu-button button'
		) ?? undefined
	);
}

/** The open menu's rows. Portalled to the body, so this cannot be scoped to the row. */
function poseItems(): HTMLButtonElement[] {
	return Array.from(document.querySelectorAll('.menu-button-menu button'));
}

function itemNamed(label: string): HTMLButtonElement {
	const item = poseItems().find(button => button.textContent === label);

	if (!item) {
		throw new Error(`no menu item "${label}" in [${poseItems().map(i => i.textContent).join(', ')}]`);
	}

	return item;
}

async function openPoseMenu() {
	await waitFor(() => expect(poseButton()).toBeDefined());
	fireEvent.click(poseButton() as HTMLButtonElement);
	await waitFor(() => expect(poseItems().length).toBeGreaterThan(0));
}

/**
 * React 16 derives `onPointerEnter`/`onPointerLeave` from the pointerover/pointerout pair,
 * so dispatching `pointerenter` — which does not bubble — reaches nothing. These are the
 * events the component actually sees in a browser.
 */
function hover(item: HTMLElement) {
	fireEvent.pointerOver(item);
}

function unhover(item: HTMLElement) {
	fireEvent.pointerOut(item);
}

describe('<StageSelectionControls>', () => {
	// The row floats over the stage, so it costs the stage no height and simply is not there
	// when it has nothing to say. An empty placeholder would sit on the scene for nothing.

	it('renders nothing without a selection', () => {
		renderControls([]);

		expect(screen.queryByTestId('scene-preview-selection')).toBeNull();
	});

	it('renders nothing when there is no editor to write to', () => {
		renderControls(['mira'], {editable: false});

		expect(screen.queryByTestId('scene-preview-selection')).toBeNull();
	});

	it('offers the character manifest poses, plus automatic', async () => {
		renderControls(['mira']);
		await openPoseMenu();

		expect(poseItems().map(item => item.textContent)).toEqual([
			AUTO_LABEL,
			'angry',
			'idle'
		]);
		// The scene's own pose is the one ticked, so the menu reports as well as offers.
		expect(
			poseItems()
				.filter(item => item.getAttribute('aria-checked') === 'true')
				.map(item => item.textContent)
		).toEqual(['angry']);
	});

	it('writes the chosen pose, and removes the key for automatic', async () => {
		const {onPose} = renderControls(['mira']);

		await openPoseMenu();
		fireEvent.click(itemNamed('idle'));
		expect(onPose).toHaveBeenCalledWith('idle');

		await openPoseMenu();
		fireEvent.click(itemNamed(AUTO_LABEL));
		expect(onPose).toHaveBeenLastCalledWith(undefined);
	});

	it('previews the hovered pose and takes it back on leave', async () => {
		const {onPose, onPreviewPose} = renderControls(['mira']);

		await openPoseMenu();
		hover(itemNamed('idle'));
		expect(onPreviewPose).toHaveBeenLastCalledWith('idle');

		// Automatic previews the fallback, so it is a pose to look at like any other.
		hover(itemNamed(AUTO_LABEL));
		expect(onPreviewPose).toHaveBeenLastCalledWith('');

		unhover(itemNamed(AUTO_LABEL));
		expect(onPreviewPose).toHaveBeenLastCalledWith(null);

		// Hovering is a question, not an answer.
		expect(onPose).not.toHaveBeenCalled();
	});

	it('takes the preview back when the menu closes without a leave', async () => {
		const {onPreviewPose} = renderControls(['mira']);

		await openPoseMenu();
		hover(itemNamed('idle'));
		onPreviewPose.mockClear();

		// What a click anywhere else does: the items unmount under the pointer and no leave
		// event ever arrives.
		fireEvent.click(document.body);
		expect(onPreviewPose).toHaveBeenCalledWith(null);
	});

	it('offers no poses for a prop — props are one image', async () => {
		renderControls(['candle']);

		// Nothing left to choose at all now that depth is two buttons. Waited on so a late
		// resolver cannot sneak one in after the assertion.
		await waitFor(() => expect(poseButton()).toBeUndefined());
	});

	it('offers no poses for a multi-selection', async () => {
		renderControls(['mira', 'joren']);

		await waitFor(() => expect(poseButton()).toBeUndefined());
	});

	// A prop, so nothing is fetched and the buttons are all there is.
	it('flips, steps depth and deletes through its buttons', () => {
		const {onDelete, onFlip, onStepZ} = renderControls(['candle']);
		const buttons = document.querySelectorAll('button');

		fireEvent.click(buttons[0]);
		expect(onFlip).toHaveBeenCalled();

		// Backward then forward, in the order a stack reads bottom-up.
		fireEvent.click(buttons[1]);
		expect(onStepZ).toHaveBeenCalledWith(-1);

		fireEvent.click(buttons[2]);
		expect(onStepZ).toHaveBeenLastCalledWith(1);

		fireEvent.click(buttons[buttons.length - 1]);
		expect(onDelete).toHaveBeenCalled();
	});
});

describe('grade extremes on slider hover', () => {
	/** The stage's sprite as the renderer draws it: `.sliders-entity > .sliders-entity-art > img`. */
	function drawSprite(id: string) {
		const box = document.createElement('div');
		const artBox = document.createElement('div');
		const img = document.createElement('img');

		box.className = 'sliders-entity';
		box.dataset.entityId = id;
		artBox.className = 'sliders-entity-art';
		img.src = `http://localhost/${id}.png`;
		Object.defineProperty(img, 'complete', {value: true});
		Object.defineProperty(img, 'naturalWidth', {value: 100});
		Object.defineProperty(img, 'naturalHeight', {value: 200});
		artBox.appendChild(img);
		box.appendChild(artBox);
		document.body.appendChild(box);
		drawn.push(box);
	}

	const drawn: HTMLElement[] = [];

	function overlay() {
		return document.querySelector<HTMLElement>('[data-testid="scene-grade-extremes"]');
	}

	function controls(id: string, onGradeHover = jest.fn()) {
		return (
			<FakeStateProvider>
				<StageSelectionControls
					assets={assets}
					editable
					entities={[stage.entities[id]]}
					onDelete={jest.fn()}
					onFlip={jest.fn()}
					onGrade={jest.fn()}
					onGradeHover={onGradeHover}
					onPose={jest.fn()}
					onPreviewPose={jest.fn()}
					onStepZ={jest.fn()}
				/>
			</FakeStateProvider>
		);
	}

	function row(key: string) {
		return document.querySelector<HTMLElement>(
			`.scene-grade-sliders-row[data-grade-key="${key}"]`
		)!;
	}

	// Only what this block drew: clearing the body would pull the render container out
	// from under testing-library's own cleanup.
	afterEach(() => {
		drawn.splice(0).forEach(el => el.remove());
	});

	it('shows the hovered key, and drops it on leave and on selection change', async () => {
		drawSprite('candle');
		drawSprite('joren');

		const onGradeHover = jest.fn();
		const {rerender} = render(controls('candle', onGradeHover));

		// React 16 derives enter/leave from over/out (TRAPS).
		fireEvent.pointerOver(row('saturation'));
		await waitFor(() => expect(overlay()?.dataset.gradeKey).toBe('saturation'));
		expect(onGradeHover).toHaveBeenLastCalledWith('saturation');
		expect(overlay()!.querySelectorAll('img')).toHaveLength(2);

		fireEvent.pointerOut(row('saturation'), {relatedTarget: document.body});
		await waitFor(() => expect(overlay()).toBeNull());
		expect(onGradeHover).toHaveBeenLastCalledWith(null);

		fireEvent.pointerOver(row('hue'));
		await waitFor(() => expect(overlay()).not.toBeNull());
		rerender(controls('joren', onGradeHover));
		await waitFor(() => expect(overlay()).toBeNull());
	});

	it('shows nothing for a sprite with no picture on the stage', async () => {
		render(controls('candle'));
		fireEvent.pointerOver(row('hue'));
		// Nothing to wait FOR; one tick for the state to land.
		await waitFor(() => expect(row('hue')).not.toBeNull());
		expect(overlay()).toBeNull();
	});
});
