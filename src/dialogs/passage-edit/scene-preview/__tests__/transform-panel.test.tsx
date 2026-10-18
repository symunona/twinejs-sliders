import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {resolveStage} from '@sliders/scene-core';
import type {Stage} from '@sliders/scene-types';
import {SceneSidebar} from '../scene-sidebar';
import {TransformPanel} from '../transform-panel';
import {parseSceneText} from '../use-scene-parse';

const K = 'dialogs.passageEdit.scenePreview.transform';

const passage = [
	'[scene]',
	'cast:',
	'  mira: {at: -0.4, scale: 0.8, rot: 15}',
	'  joren: {at: 0.3, z: 2}',
	'props:',
	'  cup: {of: mira, at: [0.1, 0]}',
	'  sky: {fit: cover}'
].join('\n');

const authored: Stage = parseSceneText(passage).states[0];
const drawn: Stage = resolveStage(authored);

// i18n is not initialised under jest: `t()` hands back its key, so the boxes are named by
// key (TRAPS.md).
function box(name: string): HTMLInputElement {
	return screen.getByRole('spinbutton', {
		name: `${K}.${name}`
	}) as HTMLInputElement;
}

function renderPanel(ids: string[], editable = true) {
	const onWrite = jest.fn();

	render(
		<TransformPanel
			authored={authored}
			drawn={drawn}
			editable={editable}
			ids={ids}
			onWrite={onWrite}
		/>
	);

	return onWrite;
}

describe('<TransformPanel>', () => {
	it('shows the current at, scale, rot, and z as placeholder when not written', () => {
		renderPanel(['mira']);

		expect(box('x').value).toBe('-0.4');
		expect(box('y').value).not.toBe('');
		expect(box('scale').value).toBe('0.8');
		expect(box('rot').value).toBe('15');
		expect(box('z').value).toBe('');
		expect(box('z').placeholder).toBe(`${K}.zAuto`);
	});

	it('shows a written z', () => {
		renderPanel(['joren']);

		expect(box('z').value).toBe('2');
	});

	it('writes a typed number on Enter', () => {
		const onWrite = renderPanel(['mira']);

		fireEvent.change(box('rot'), {target: {value: '90'}});
		fireEvent.keyDown(box('rot'), {key: 'Enter'});

		expect(onWrite).toHaveBeenCalledWith([
			expect.objectContaining({id: 'mira', key: 'rot', reset: 0, value: 90})
		]);
	});

	it('removes scale when the box is emptied', () => {
		const onWrite = renderPanel(['mira']);

		fireEvent.change(box('scale'), {target: {value: ''}});
		fireEvent.blur(box('scale'));

		expect(onWrite).toHaveBeenCalledWith([
			expect.objectContaining({key: 'scale', reset: 1, value: undefined})
		]);
	});

	it('writes nothing when the value did not change', () => {
		const onWrite = renderPanel(['mira']);

		fireEvent.change(box('x'), {target: {value: '-0.4'}});
		fireEvent.blur(box('x'));

		expect(onWrite).not.toHaveBeenCalled();
	});

	it('shows the offset of an of: child, and says so', () => {
		renderPanel(['cup']);

		expect(box('x').value).toBe('0.1');
		expect(box('y').value).toBe('0');
		expect(screen.getByText(`${K}.relative`)).toBeInTheDocument();
	});

	it('offers only z on a fit: plane', () => {
		renderPanel(['sky']);

		expect(screen.queryByRole('spinbutton', {name: `${K}.x`})).toBeNull();
		expect(screen.getByText(`${K}.plane`)).toBeInTheDocument();
		expect(box('z')).toBeInTheDocument();
	});

	it('asks for a single sprite on a multi-selection', () => {
		renderPanel(['mira', 'joren']);

		expect(screen.queryByRole('spinbutton')).toBeNull();
		expect(screen.getByText(`${K}.singleOnly`)).toBeInTheDocument();
	});

	it('disables every box when the stage is not editable', () => {
		renderPanel(['mira'], false);

		for (const input of screen.getAllByRole('spinbutton')) {
			expect(input).toBeDisabled();
		}
	});
});

describe('<SceneSidebar> transform tab', () => {
	it('draws an accented handle and the panel when open on it', () => {
		render(
			<SceneSidebar
				active="transform"
				onActive={jest.fn()}
				onOpenChange={jest.fn()}
				open
				tabs={[
					{content: <p>scene</p>, icon: null, id: 'scene', label: 'scene'},
					{
						accent: true,
						content: (
							<TransformPanel
								authored={authored}
								drawn={drawn}
								editable
								ids={['mira']}
								onWrite={jest.fn()}
							/>
						),
						icon: null,
						id: 'transform',
						label: 'transform'
					}
				]}
			/>
		);

		const handle = screen.getByTestId('scene-sidebar-tab-transform');

		expect(handle).toHaveClass('scene-sidebar-tab-accent');
		expect(handle).not.toHaveClass('scene-sidebar-tab-scope');
		expect(within(handle).getByRole('tab')).toBeInTheDocument();
		expect(screen.getByTestId('transform-panel')).toBeInTheDocument();
	});
});
