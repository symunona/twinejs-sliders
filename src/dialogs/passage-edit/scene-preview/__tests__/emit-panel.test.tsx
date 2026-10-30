import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {AssetMeta, StageEntity} from '@sliders/scene-types';
import {EmitPanel} from '../emit-panel';

const fire: StageEntity = {
	at: {x: 0, y: 0},
	flip: false,
	id: 'fire',
	kind: 'prop',
	opacity: 1,
	ref: 'fire',
	scale: 1
};

describe('EmitPanel', () => {
	it('shows the asset numbers, and reset is off with nothing overridden', () => {
		render(<EmitPanel editable entity={fire} onEmit={jest.fn()} spec={{rate: 33}} />);

		expect(screen.getAllByRole('slider').length).toBeGreaterThan(5);
		expect(
			screen.getByRole('button', {name: 'dialogs.passageEdit.scenePreview.emitReset'})
		).toBeDisabled();
	});

	it('clears the overrides on reset', () => {
		const onEmit = jest.fn();

		render(
			<EmitPanel
				editable
				entity={{...fire, emit: {rate: 5}}}
				onEmit={onEmit}
				spec={{rate: 33}}
			/>
		);
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.passageEdit.scenePreview.emitReset'})
		);
		expect(onEmit).toHaveBeenCalledWith(null);
	});
});

describe('EmitPanel edit button', () => {
	it('opens the emitter when there is an opener, and only then', () => {
		const onEdit = jest.fn();
		const {rerender} = render(
			<EmitPanel editable entity={fire} onEmit={jest.fn()} spec={{}} />
		);

		expect(
			screen.queryByRole('button', {name: 'dialogs.passageEdit.scenePreview.emitEdit'})
		).toBeNull();

		rerender(
			<EmitPanel
				editable
				entity={fire}
				onEditEmitter={onEdit}
				onEmit={jest.fn()}
				spec={{}}
			/>
		);
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.passageEdit.scenePreview.emitEdit'})
		);
		expect(onEdit).toHaveBeenCalledTimes(1);
	});
});

describe('EmitPanel particle system dropdown', () => {
	const emitters = [
		{id: 'a1', kind: 'fx', name: 'fire', particles: {}},
		{id: 'a2', kind: 'fx', name: 'smoke', particles: {}}
	] as unknown as AssetMeta[];

	it('lists the emitters, shows the entity one, swaps by name', () => {
		const onRef = jest.fn();

		render(
			<EmitPanel
				editable
				emitters={emitters}
				entity={fire}
				onEmit={jest.fn()}
				onRef={onRef}
				spec={{}}
			/>
		);

		const select = screen.getByTestId('scene-preview-emit-system') as HTMLSelectElement;

		expect([...select.options].map(option => option.value)).toEqual(['fire', 'smoke']);
		expect(select.value).toBe('fire');
		fireEvent.change(select, {target: {value: 'smoke'}});
		expect(onRef).toHaveBeenCalledWith('smoke');
	});

	it('a qualified ref matches its bare name; an unknown one stays shown', () => {
		const {rerender} = render(
			<EmitPanel
				editable
				emitters={emitters}
				entity={{...fire, ref: 'particles/smoke'}}
				onEmit={jest.fn()}
				spec={{}}
			/>
		);

		expect(
			(screen.getByTestId('scene-preview-emit-system') as HTMLSelectElement).value
		).toBe('smoke');

		rerender(
			<EmitPanel
				editable
				emitters={emitters}
				entity={{...fire, ref: 'gone'}}
				onEmit={jest.fn()}
				spec={{}}
			/>
		);

		const select = screen.getByTestId('scene-preview-emit-system') as HTMLSelectElement;

		expect(select.value).toBe('gone');
		// No writer: read only.
		expect(select).toBeDisabled();
	});

	it('Edit sits next to the dropdown; reset all is its own button', () => {
		const {container} = render(
			<EmitPanel
				editable
				emitters={emitters}
				entity={{...fire, emit: {speed: 2}}}
				onEditEmitter={jest.fn()}
				onEmit={jest.fn()}
				onRef={jest.fn()}
				spec={{}}
			/>
		);
		const row = container.querySelector('.scene-preview-emit-system')!;

		expect(row.querySelector('select')).not.toBeNull();
		expect(row.textContent).toContain('dialogs.passageEdit.scenePreview.emitEditLabel');
		expect(
			container.querySelector('.scene-preview-emit-reset')!.textContent
		).toContain('dialogs.passageEdit.scenePreview.emitResetAll');
	});
});
