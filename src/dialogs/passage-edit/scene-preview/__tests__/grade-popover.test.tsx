import {act, fireEvent, render} from '@testing-library/react';
import * as React from 'react';
import type {EntityGrade} from '@sliders/scene-types';
import {GradePopover} from '../grade-popover';

jest.useFakeTimers();

function rowFor(labelKey: string): HTMLElement {
	// A non-editable AdjustSlider folds its readout into the label, so find the row by
	// label text and take its range (`.claude/TRAPS.md`).
	const row = Array.from(
		document.querySelectorAll<HTMLElement>('.scene-grade-popover .adjust-slider')
	).find(el => el.textContent?.includes(labelKey));

	if (!row) {
		throw new Error(`no slider ${labelKey}`);
	}

	return row;
}

function setup(grade: EntityGrade | undefined) {
	const anchor = document.createElement('button');
	const onChange = jest.fn();
	const onClose = jest.fn();
	const onCommit = jest.fn();

	document.body.appendChild(anchor);
	render(
		<GradePopover
			anchor={anchor}
			grade={grade}
			note="note"
			onChange={onChange}
			onClose={onClose}
			onCommit={onCommit}
		/>
	);

	return {anchor, onChange, onClose, onCommit};
}

describe('GradePopover', () => {
	it('shows one slider per grade key, at the grade on screen', () => {
		setup({warmth: 30});

		expect(
			document.querySelectorAll('.scene-grade-popover .adjust-slider')
		).toHaveLength(11);

		const warmth = rowFor('dialogs.assetEditor.warmth').querySelector(
			'input[type="range"]'
		) as HTMLInputElement;

		expect(warmth.value).toBe('30');
		expect(
			(rowFor('dialogs.assetEditor.gamma').querySelector(
				'input[type="range"]'
			) as HTMLInputElement).value
		).toBe('1');
	});

	it('hands up the WHOLE grade on a move, and writes on release', () => {
		const {onChange, onCommit} = setup({warmth: 30});
		const hue = rowFor('dialogs.assetEditor.hue').querySelector(
			'input[type="range"]'
		) as HTMLInputElement;

		fireEvent.change(hue, {target: {value: '-10'}});
		expect(onChange).toHaveBeenLastCalledWith({hue: -10, warmth: 30});

		act(() => {
			jest.runAllTimers();
		});
		expect(onCommit).toHaveBeenCalled();
	});

	it('drops a key moved back to rest', () => {
		const {onChange} = setup({warmth: 30, hue: 5});
		const warmth = rowFor('dialogs.assetEditor.warmth').querySelector(
			'input[type="range"]'
		) as HTMLInputElement;

		fireEvent.change(warmth, {target: {value: '0'}});
		expect(onChange).toHaveBeenLastCalledWith({hue: 5});
	});

	it('resets the whole grade, and writes it', () => {
		const {onChange, onCommit} = setup({warmth: 30});
		const reset = Array.from(
			document.querySelectorAll<HTMLButtonElement>(
				'.scene-grade-popover-foot button'
			)
		).pop()!;

		fireEvent.click(reset);
		expect(onChange).toHaveBeenLastCalledWith(undefined);
		act(() => {
			jest.runAllTimers();
		});
		expect(onCommit).toHaveBeenCalled();
	});

	it('closes on Escape and on a press outside, not on a press inside', () => {
		const {anchor, onClose} = setup(undefined);

		fireEvent.pointerDown(
			document.querySelector('.scene-grade-popover') as HTMLElement
		);
		fireEvent.pointerDown(anchor);
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.pointerDown(document.body);
		expect(onClose).toHaveBeenCalledTimes(1);
		fireEvent.keyDown(document, {key: 'Escape'});
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
