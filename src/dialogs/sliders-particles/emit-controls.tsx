/**
 * The emitter's knobs: one slider per number, two colours, a blend. Shared by the
 * Particles dialog (editing the asset) and the scene editor (editing a scene's `emit:`
 * over it) — so a knob means the same in both places.
 *
 * `base` is what each knob resets to: the defaults in the dialog, the asset's own numbers
 * in a scene. A knob away from its base is highlighted, which in a scene is "this scene
 * overrides it".
 */

import {
	EMIT_BLENDS,
	EMIT_NUMBER_KEYS,
	EMIT_RANGES,
	type EmitBlend,
	type EmitParams,
	type EmitPatch
} from '@sliders/scene-types';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {AdjustSlider} from '../asset-editor/adjust-slider';
import './emit-controls.css';

export interface EmitControlsProps {
	value: EmitParams;
	base: EmitParams;
	/** One knob moved. */
	onChange: (patch: EmitPatch) => void;
	disabled?: boolean;
}

export const EmitControls: React.FC<EmitControlsProps> = props => {
	const {base, disabled, onChange, value} = props;
	const {t} = useTranslation();

	return (
		<div className="emit-controls">
			{EMIT_NUMBER_KEYS.map(key => (
				<AdjustSlider
					disabled={disabled}
					key={key}
					label={t(`dialogs.slidersParticles.keys.${key}`)}
					max={EMIT_RANGES[key].max}
					min={EMIT_RANGES[key].min}
					onChange={next => onChange({[key]: next})}
					resetLabel={t('dialogs.slidersParticles.reset')}
					resetTo={base[key]}
					step={EMIT_RANGES[key].step}
					value={value[key]}
				/>
			))}
			<div className="emit-controls-row">
				{(['color', 'colorEnd'] as const).map(key => (
					<label
						className={value[key] !== base[key] ? 'overridden' : undefined}
						key={key}
					>
						<span>{t(`dialogs.slidersParticles.keys.${key}`)}</span>
						<input
							disabled={disabled}
							onChange={event => onChange({[key]: event.target.value})}
							type="color"
							value={value[key]}
						/>
					</label>
				))}
				<label className={value.blend !== base.blend ? 'overridden' : undefined}>
					<span>{t('dialogs.slidersParticles.keys.blend')}</span>
					<select
						disabled={disabled}
						onChange={event => onChange({blend: event.target.value as EmitBlend})}
						value={value.blend}
					>
						{EMIT_BLENDS.map(blend => (
							<option key={blend} value={blend}>
								{t(`dialogs.slidersParticles.blends.${blend}`)}
							</option>
						))}
					</select>
				</label>
			</div>
		</div>
	);
};
