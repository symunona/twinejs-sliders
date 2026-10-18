import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {
	BubbleColorControl,
	colorChannels,
	formatColor
} from '../bubble-color-control';

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

describe('colorChannels() / formatColor()', () => {
	it.each([
		['#f66', {alpha: 1, hex: '#ff6666'}],
		['#FF666680', {alpha: 0.5, hex: '#ff6666'}],
		['rgba(0, 0, 0, 0.6)', {alpha: 0.6, hex: '#000000'}],
		['rgb(255 102 0 / 25%)', {alpha: 0.25, hex: '#ff6600'}],
		['transparent', {alpha: 0, hex: '#000000'}]
	])('splits %s', (value, channels) => {
		expect(colorChannels(value)).toEqual(channels);
	});

	it.each(['var(--ink)', 'red', '', undefined])('leaves %s alone', value => {
		expect(colorChannels(value)).toBeUndefined();
	});

	it('writes hex when opaque, rgba otherwise', () => {
		expect(formatColor({alpha: 1, hex: '#ff6666'})).toBe('#ff6666');
		expect(formatColor({alpha: 0.4, hex: '#ff6666'})).toBe(
			'rgba(255, 102, 102, 0.4)'
		);
	});
});

describe('<BubbleColorControl> alpha', () => {
	function alpha() {
		return screen.getByRole('slider') as HTMLInputElement;
	}

	it('shows the alpha of the value', () => {
		render(
			<BubbleColorControl
				clearLabel="clear"
				onChange={jest.fn()}
				value="rgba(0, 0, 0, 0.6)"
			>
				fill
			</BubbleColorControl>
		);

		expect(alpha().value).toBe('0.6');
	});

	it('writes once, on release, keeping the hue', () => {
		const onChange = jest.fn();

		render(
			<BubbleColorControl clearLabel="clear" onChange={onChange} value="#f66">
				fill
			</BubbleColorControl>
		);
		fireEvent.input(alpha(), {target: {value: '0.3'}});
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.change(alpha());
		expect(onChange).toHaveBeenCalledWith('rgba(255, 102, 102, 0.3)');
	});

	it('keeps the alpha when the well picks a new hue', () => {
		const onChange = jest.fn();

		render(
			<BubbleColorControl
				clearLabel="clear"
				onChange={onChange}
				value="rgba(0, 0, 0, 0.5)"
			>
				fill
			</BubbleColorControl>
		);
		fireEvent.change(screen.getByLabelText('fill'), {
			target: {value: '#00ff00'}
		});

		expect(onChange).toHaveBeenCalledWith('rgba(0, 255, 0, 0.5)');
	});

	it('is disabled for a value it cannot split', () => {
		render(
			<BubbleColorControl
				clearLabel="clear"
				onChange={jest.fn()}
				value="var(--ink)"
			>
				fill
			</BubbleColorControl>
		);

		expect(alpha().disabled).toBe(true);
	});
});
