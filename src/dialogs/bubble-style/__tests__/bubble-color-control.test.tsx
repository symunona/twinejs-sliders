import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {BubbleColorControl} from '../bubble-color-control';

describe('<BubbleColorControl> quick list', () => {
	it('has no quick list without swatches', () => {
		render(
			<BubbleColorControl clearLabel="clear" onChange={jest.fn()}>
				fill
			</BubbleColorControl>
		);

		expect(screen.queryByRole('button', {name: 'story colours'})).toBeNull();
	});

	it('writes a picked swatch exactly as the story spells it', () => {
		const onChange = jest.fn();

		render(
			<BubbleColorControl
				clearLabel="clear"
				onChange={onChange}
				swatches={['#f66', 'rgba(0, 0, 0, 0.6)']}
				swatchesLabel="story colours"
				value="#f66"
			>
				fill
			</BubbleColorControl>
		);
		fireEvent.click(screen.getByRole('button', {name: 'story colours'}));

		expect(
			screen.getByRole('button', {name: '#f66'}).getAttribute('aria-pressed')
		).toBe('true');

		fireEvent.click(screen.getByRole('button', {name: 'rgba(0, 0, 0, 0.6)'}));
		expect(onChange).toHaveBeenCalledWith('rgba(0, 0, 0, 0.6)');
	});
});
