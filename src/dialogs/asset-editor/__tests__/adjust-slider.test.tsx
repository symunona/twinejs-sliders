import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {AdjustSlider, AdjustSliderProps} from '../adjust-slider';

describe('<AdjustSlider>', () => {
	function renderComponent(props?: Partial<AdjustSliderProps>) {
		return render(
			<AdjustSlider
				label="mock-label"
				max={3}
				min={0.2}
				onChange={jest.fn()}
				resetLabel="mock-reset"
				resetTo={1}
				step={0.01}
				value={1}
				{...props}
			/>
		);
	}

	it('shows the value as text when it is not editable', () => {
		const {container} = renderComponent({value: 1.5});

		expect(container.querySelector('.adjust-slider-value')).toHaveTextContent('1.5');
		expect(container.querySelector('.adjust-slider-number')).not.toBeInTheDocument();
	});

	it('reports a dragged value', () => {
		const onChange = jest.fn();
		const {container} = renderComponent({onChange});

		fireEvent.change(container.querySelector('input[type="range"]')!, {
			target: {value: '2.5'}
		});
		expect(onChange).toHaveBeenCalledWith(2.5);
	});

	it('reports a typed value past the slider’s own end', () => {
		const onChange = jest.fn();

		renderComponent({editable: true, onChange});
		fireEvent.change(screen.getByLabelText('mock-label'), {target: {value: '8'}});
		expect(onChange).toHaveBeenCalledWith(8);
	});

	// Otherwise the committed number would be echoed back over the half-written one, and
	// typing `1.5` would fight the box at the `1.`.
	it('leaves a half-written number alone', () => {
		const onChange = jest.fn();

		renderComponent({editable: true, onChange});

		const box = screen.getByLabelText('mock-label');

		fireEvent.change(box, {target: {value: ''}});
		expect(onChange).not.toHaveBeenCalled();
		expect(box).toHaveValue(null);
	});

	it('resets to the value that means "leave this alone"', () => {
		const onChange = jest.fn();

		renderComponent({onChange, value: 2});
		fireEvent.click(screen.getByRole('button', {name: 'mock-reset'}));
		expect(onChange).toHaveBeenCalledWith(1);
	});

	it('marks itself overridden off its default, like the other "not default" rows', () => {
		const {container, rerender} = renderComponent({value: 2});

		expect(container.querySelector('.adjust-slider')).toHaveClass('overridden');
		expect(screen.getByRole('button', {name: 'mock-reset'})).toBeEnabled();
		rerender(
			<AdjustSlider
				label="mock-label"
				max={3}
				min={0.2}
				onChange={jest.fn()}
				resetLabel="mock-reset"
				resetTo={1}
				step={0.01}
				value={1}
			/>
		);
		expect(container.querySelector('.adjust-slider')).not.toHaveClass(
			'overridden'
		);
		expect(screen.getByRole('button', {name: 'mock-reset'})).toBeDisabled();
	});

	// Grid places it on the name line; DOM keeps it out of the <label>.
	it('keeps the reset out of the label', () => {
		const {container} = renderComponent({value: 2});

		expect(container.querySelector('label button')).not.toBeInTheDocument();
		expect(container.querySelector('.adjust-slider > button')).toBe(
			screen.getByRole('button', {name: 'mock-reset'})
		);
	});

	// The button is labelable too; the label must still name the slider, not it.
	it('still names the slider by its label', () => {
		const {container} = renderComponent();

		expect(screen.getByLabelText(/mock-label/)).toBe(
			container.querySelector('input[type="range"]')
		);
	});
});
