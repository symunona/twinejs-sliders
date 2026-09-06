import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {AnchorSelect, AnchorSelectProps} from '../anchor-select';

describe('<AnchorSelect>', () => {
	function renderComponent(props?: Partial<AnchorSelectProps>) {
		return render(
			<AnchorSelect
				onChange={jest.fn()}
				onChangePicking={jest.fn()}
				origin={{x: 0.5, y: 1}}
				picking={false}
				{...props}
			/>
		);
	}

	it('draws a button for each of the nine presets', () => {
		const {container} = renderComponent();

		expect(container.querySelectorAll('[data-preset]').length).toBe(9);
	});

	it('marks the preset the anchor is sitting on', () => {
		const {container} = renderComponent();

		expect(
			container.querySelector('[data-preset="bottom-center"]')
		).toHaveAttribute('aria-pressed', 'true');
		expect(container.querySelector('[data-preset="top-left"]')).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	});

	it('marks nothing when the anchor is somewhere of its own', () => {
		const {container} = renderComponent({origin: {x: 0.4, y: 0.2}});

		expect(container.querySelectorAll('[aria-pressed="true"]').length).toBe(0);
	});

	it('reports the preset that was clicked', () => {
		const onChange = jest.fn();
		const {container} = renderComponent({onChange});

		fireEvent.click(container.querySelector('[data-preset="top-left"]')!);
		expect(onChange).toHaveBeenCalledWith({x: 0, y: 0});
	});

	// Otherwise the next click on the art would move the anchor straight back off the
	// preset the author just chose.
	it('turns picking off when a preset is chosen', () => {
		const onChangePicking = jest.fn();
		const {container} = renderComponent({onChangePicking, picking: true});

		fireEvent.click(container.querySelector('[data-preset="middle-center"]')!);
		expect(onChangePicking).toHaveBeenCalledWith(false);
	});

	it('toggles picking from the custom checkbox', () => {
		const onChangePicking = jest.fn();

		renderComponent({onChangePicking});
		fireEvent.click(screen.getByRole('checkbox'));
		expect(onChangePicking).toHaveBeenCalledWith(true);
	});

	// The test i18n mock returns the key and drops interpolation, so the numbers
	// themselves are covered by the `roundAnchor` tests instead.
	it('reads the anchor out', () => {
		const {container} = renderComponent({origin: {x: 0.25, y: 0.6666}});

		expect(container.querySelector('[data-readout="anchor"]')).toHaveTextContent(
			'components.anchorSelect.readout'
		);
	});

	it('shows the pick hint only while picking', () => {
		const {rerender} = renderComponent({pickHint: 'mock-hint'});

		expect(screen.queryByText('mock-hint')).not.toBeInTheDocument();
		rerender(
			<AnchorSelect
				onChange={jest.fn()}
				onChangePicking={jest.fn()}
				origin={{x: 0.5, y: 1}}
				pickHint="mock-hint"
				picking
			/>
		);
		expect(screen.getByText('mock-hint')).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
