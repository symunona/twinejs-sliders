import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {PreviewSelect} from '../../../components/control/preview-select';
import {
	DESKTOP_STAGE,
	PHONE_STAGE,
	bubbleSizingOptions,
	layoutSizing
} from '../bubble-sizing';

/*
 * The figure is a model of the renderer, so its claims are tested as geometry: what share
 * of the stage the bubble takes on a phone versus a desktop, and whether the words fit.
 */

const share = (sizing: 'auto' | 'absolute' | 'manual', stage = PHONE_STAGE) => {
	const {box} = layoutSizing(sizing, stage);

	return (box.width * box.height) / (stage.width * stage.height);
};

describe('layoutSizing', () => {
	// Fixed px type: the same words cover more of a small stage.
	it('auto: the bubble takes a bigger share of a phone than of a desktop', () => {
		expect(share('auto', PHONE_STAGE)).toBeGreaterThan(
			share('auto', DESKTOP_STAGE) * 2
		);
	});

	it('auto: the words wrap onto more lines on a phone, and all of them show', () => {
		const phone = layoutSizing('auto', PHONE_STAGE);
		const desktop = layoutSizing('auto', DESKTOP_STAGE);

		expect(phone.lines.length).toBeGreaterThan(desktop.lines.length);
		expect(phone.visibleLines).toBe(phone.lines.length);
		expect(phone.font).toBe(desktop.font);
	});

	// The phone picture is the desktop one, scaled.
	it('absolute: same share of the stage and type scaled with it', () => {
		const phone = layoutSizing('absolute', PHONE_STAGE);
		const desktop = layoutSizing('absolute', DESKTOP_STAGE);
		const ratio = DESKTOP_STAGE.height / PHONE_STAGE.height;

		expect(share('absolute', PHONE_STAGE)).toBeCloseTo(
			share('absolute', DESKTOP_STAGE)
		);
		expect(desktop.font / phone.font).toBeCloseTo(ratio, 2);
		expect(phone.lines.length).toBe(desktop.lines.length);
		expect(phone.visibleLines).toBe(phone.lines.length);
	});

	// Stated box, fixed type: the phone cuts the line off, the desktop has room.
	it('manual: same share of the stage, type fixed, clipped on a phone only', () => {
		const phone = layoutSizing('manual', PHONE_STAGE);
		const desktop = layoutSizing('manual', DESKTOP_STAGE);

		expect(share('manual', PHONE_STAGE)).toBeCloseTo(
			share('manual', DESKTOP_STAGE)
		);
		expect(phone.font).toBe(desktop.font);
		expect(phone.visibleLines).toBeLessThan(phone.lines.length);
		expect(desktop.visibleLines).toBe(desktop.lines.length);
	});
});

describe('bubbleSizingOptions', () => {
	const t = (key: string) => key;

	it('offers the empty option then every sizing, each explained', () => {
		const options = bubbleSizingOptions({
			emptyLabel: 'Default',
			emptyValue: '',
			t
		});

		expect(options.map(o => o.value)).toEqual([
			'',
			'auto',
			'absolute',
			'manual'
		]);
		expect(options.every(o => o.explanation)).toBe(true);
	});

	// The empty option says what it resolves to, not just "default".
	it('names what the empty option inherits', () => {
		const options = bubbleSizingOptions({
			emptyLabel: 'Default',
			emptyValue: '',
			inherited: 'manual',
			t
		});

		expect(options[0].detail).toBe('manual');
	});

	it('draws the highlighted option in the pane beside the list', () => {
		render(
			<PreviewSelect
				onChange={jest.fn()}
				options={bubbleSizingOptions({
					emptyLabel: 'Default',
					emptyValue: '',
					inherited: 'absolute',
					t
				})}
				value=""
			>
				Sizing
			</PreviewSelect>
		);
		fireEvent.click(screen.getByRole('button'));

		const pane = screen.getByTestId('preview-select-explanation');

		// Opens on the chosen (empty) option, which resolves to absolute.
		expect(pane.querySelector('svg')).toHaveAttribute(
			'data-sizing',
			'absolute'
		);
		expect(pane).toHaveTextContent('components.bubbleSizing.inherited');

		fireEvent.pointerOver(
			within(screen.getByRole('listbox')).getAllByRole('option')[3]
		);
		expect(pane.querySelector('svg')).toHaveAttribute('data-sizing', 'manual');
		expect(pane).toHaveTextContent('components.bubbleSizing.manualText');
	});
});
