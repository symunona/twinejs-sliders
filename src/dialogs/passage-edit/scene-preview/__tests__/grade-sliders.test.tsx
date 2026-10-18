import {act, fireEvent, render} from '@testing-library/react';
import * as React from 'react';
import type {EntityGrade} from '@sliders/scene-types';
import {GradeSliders} from '../grade-sliders';

jest.useFakeTimers();

function rowFor(labelKey: string): HTMLElement {
	// A non-editable AdjustSlider folds its readout into the label, so find the row by
	// label text and take its range (`.claude/TRAPS.md`).
	const row = Array.from(
		document.querySelectorAll<HTMLElement>('.scene-grade-sliders .adjust-slider')
	).find(el => el.textContent?.includes(labelKey));

	if (!row) {
		throw new Error(`no slider ${labelKey}`);
	}

	return row;
}

function setup(grade: EntityGrade | undefined) {
	const onChange = jest.fn();
	const onCommit = jest.fn();
	const onHoverKey = jest.fn();

	render(
		<GradeSliders
			grade={grade}
			note="note"
			onChange={onChange}
			onCommit={onCommit}
			onHoverKey={onHoverKey}
		/>
	);

	return {onChange, onCommit, onHoverKey};
}

describe('GradeSliders', () => {
	it('shows one slider per grade key, at the grade on screen', () => {
		setup({warmth: 30});

		expect(
			document.querySelectorAll('.scene-grade-sliders .adjust-slider')
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

	it('writes when one slider is reset', () => {
		const {onChange, onCommit} = setup({warmth: 30});
		const reset = rowFor('dialogs.assetEditor.warmth').querySelector(
			'button'
		) as HTMLButtonElement;

		fireEvent.click(reset);
		expect(onChange).toHaveBeenLastCalledWith(undefined);
		act(() => {
			jest.runAllTimers();
		});
		expect(onCommit).toHaveBeenCalled();
	});

	it('says which slider the pointer is over', () => {
		const {onHoverKey} = setup(undefined);
		const row = rowFor('dialogs.assetEditor.hue').closest(
			'.scene-grade-sliders-row'
		) as HTMLElement;

		fireEvent.pointerOver(row);
		expect(onHoverKey).toHaveBeenLastCalledWith('hue');
		fireEvent.pointerOut(
			document.querySelector('.scene-grade-sliders') as HTMLElement
		);
		expect(onHoverKey).toHaveBeenLastCalledWith(null);
	});

	it('puts the whole-grade fixes on top of the group, over the sliders', () => {
		render(
			<GradeSliders
				fixes={<button type="button">fix</button>}
				grade={undefined}
				onChange={jest.fn()}
				onCommit={jest.fn()}
			/>
		);

		const group = document.querySelector('.scene-grade-sliders') as HTMLElement;
		const fixes = group.querySelector(
			'[data-testid="scene-grade-sliders-fixes"]'
		) as HTMLElement;
		const firstRow = group.querySelector('.scene-grade-sliders-row')!;

		expect(fixes).toHaveTextContent('fix');
		expect(
			fixes.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});
});
