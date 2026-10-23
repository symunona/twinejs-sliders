import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {StageEntity} from '@sliders/scene-types';
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
