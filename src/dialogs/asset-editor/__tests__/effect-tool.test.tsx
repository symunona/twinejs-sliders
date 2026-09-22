import {GLITCH_DEFAULTS} from '@sliders/render-dom';
import type {AssetEffect, GlitchEffect} from '@sliders/scene-types';
import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {EffectTool, EffectToolProps, GLITCH_PRESETS} from '../effect-tool';

/*
i18n is not initialised under jest, so `t()` hands back its own key: every label onscreen is
`dialogs.assetEditor.…`. Controls are found structurally -- by role inside the group that
names them -- and asserted on by key.
*/

function glitch(changes: Partial<GlitchEffect> = {}): GlitchEffect {
	return {...GLITCH_DEFAULTS, ...changes};
}

function renderTool(props?: Partial<EffectToolProps>) {
	const onChange = jest.fn();
	const result = render(
		<EffectTool onChange={onChange} {...props} />
	);

	return {...result, onChange};
}

/** The none/glitch radio group. */
function selector() {
	return screen.getByRole('radiogroup');
}

/*
These buttons carry a visible label AND a tooltip, and `IconButton` gives a non-`iconOnly`
button its `tooltipLabel` as the accessible name -- the tooltip is aria-hidden, so the hint
has to reach a screen reader from the button itself. So they are looked up by hint key.
*/
function choice(name: 'none' | 'glitch') {
	return within(selector()).getByRole('radio', {
		name: `dialogs.assetEditor.effectKindHint.${name}`
	});
}

/**
 * A parameter's range input.
 *
 * Found through its row rather than by accessible name: `AdjustSlider` is not `editable` here,
 * so the `<label>` wraps the range AND the value readout, and the computed name is the label
 * text with the current number stuck on the end. The same reason `mask-tool.test.tsx` reaches
 * for `input[type="range"]` directly.
 */
function param(key: keyof Omit<GlitchEffect, 'kind'>): HTMLInputElement {
	const row = screen
		.getByText(`dialogs.assetEditor.effectParam.${key}`)
		.closest('.adjust-slider');

	return row!.querySelector('input[type="range"]') as HTMLInputElement;
}

function hasParam(key: keyof Omit<GlitchEffect, 'kind'>): boolean {
	return (
		screen.queryByText(`dialogs.assetEditor.effectParam.${key}`) !== null
	);
}

describe('<EffectTool>', () => {
	it('starts on None when the asset carries no effect', () => {
		renderTool();

		expect(choice('none')).toHaveAttribute('aria-checked', 'true');
		expect(choice('glitch')).toHaveAttribute('aria-checked', 'false');
	});

	it('shows no parameters until an effect is chosen', () => {
		renderTool();

		expect(hasParam('amount')).toBe(false);
	});

	it('turns an effect on at the defaults, not at silence', () => {
		// A selector that switches an effect on and shows no change reads as broken.
		const {onChange} = renderTool();

		fireEvent.click(choice('glitch'));
		expect(onChange).toHaveBeenCalledWith(GLITCH_DEFAULTS);
	});

	it('clears the effect entirely when None is picked', () => {
		const {onChange} = renderTool({effect: glitch()});

		fireEvent.click(choice('none'));
		expect(onChange).toHaveBeenCalledWith(undefined);
	});

	it('shows every parameter once an effect is on', () => {
		renderTool({effect: glitch()});

		for (const key of Object.keys(GLITCH_DEFAULTS).filter(k => k !== 'kind')) {
			expect(hasParam(key as keyof Omit<GlitchEffect, 'kind'>)).toBe(true);
		}
	});

	it('reports one changed parameter and leaves the rest alone', () => {
		const {onChange} = renderTool({effect: glitch({bands: 3})});

		fireEvent.change(param('amount'), {target: {value: '72'}});

		expect(onChange).toHaveBeenCalledWith(glitch({amount: 72, bands: 3}));
	});

	it('applies a preset whole', () => {
		const {onChange} = renderTool({effect: glitch()});
		const vhs = GLITCH_PRESETS.find(preset => preset.id === 'vhs')!;

		fireEvent.click(
			screen.getByRole('button', {
				name: 'dialogs.assetEditor.effectPresetHint.vhs'
			})
		);

		expect(onChange).toHaveBeenCalledWith(vhs.effect);
	});

	it('says so when the settings would draw nothing', () => {
		renderTool({
			effect: glitch({amount: 0, noise: 0, scanlines: 0, split: 0})
		});

		expect(
			screen.getByText('dialogs.assetEditor.effectIdle')
		).toBeInTheDocument();

		// A warning, not a lockout: every slider still works.
		expect(param('amount')).not.toBeDisabled();
	});

	it('greys every control out while the editor is busy', () => {
		renderTool({disabled: true, effect: glitch()});

		expect(choice('glitch')).toBeDisabled();
		expect(param('amount')).toBeDisabled();
	});

	it('ignores an effect of an unknown kind rather than rendering its knobs', () => {
		renderTool({effect: {kind: 'bloom'} as unknown as AssetEffect});

		expect(choice('none')).toHaveAttribute('aria-checked', 'true');
	});
});
