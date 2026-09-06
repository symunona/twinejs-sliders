import {Frac2} from '@sliders/scene-types';
import {IconCrosshair} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../container/button-bar';
import {CheckboxButton} from '../control/checkbox-button';
import {
	ANCHOR_PRESETS,
	anchorPreset,
	roundAnchor
} from './anchor-presets';
import './anchor-select.css';

export interface AnchorSelectProps {
	/** Disables the whole control, e.g. while a long edit is running. */
	disabled?: boolean;
	onChange: (origin: Frac2) => void;
	/** Turns picking on and off. The caller owns what a click on its image does. */
	onChangePicking: (picking: boolean) => void;
	origin: Frac2;
	/** True while the next click on the art will place the anchor. */
	picking: boolean;
	/** What to tell the author to click while picking is on. */
	pickHint?: string;
}

/**
 * Where an anchor sits: nine presets, or a point picked off the art itself.
 *
 * The preset grid is a picture of the frame — a button in each corner, each edge and the
 * middle — so "bottom centre" is chosen by pointing at the bottom centre rather than by
 * reading a label. Custom is a mode, not a value: the caller puts the click handler on
 * whatever is showing the art, because only it knows how its pixels map to fractions.
 *
 * Shared by the asset editor and the character editor so an anchor is placed the same way
 * whatever owns it.
 */
export const AnchorSelect: React.FC<AnchorSelectProps> = props => {
	const {disabled, onChange, onChangePicking, origin, picking, pickHint} = props;
	const {t} = useTranslation();
	const current = anchorPreset(origin);

	return (
		<div className="anchor-select">
			<div
				aria-label={t('components.anchorSelect.presets')}
				className="anchor-select-grid"
				role="group"
			>
				{ANCHOR_PRESETS.map(preset => {
					const label = t(`components.anchorSelect.preset.${preset.id}`);

					return (
						<button
							aria-label={label}
							aria-pressed={current === preset.id}
							className={classNames('anchor-select-preset', {
								selected: current === preset.id
							})}
							data-preset={preset.id}
							disabled={disabled}
							key={preset.id}
							onClick={() => {
								onChangePicking(false);
								onChange({...preset.value});
							}}
							title={label}
							type="button"
						>
							<span className="anchor-select-dot" />
						</button>
					);
				})}
			</div>
			<div className="anchor-select-side">
				<ButtonBar>
					<CheckboxButton
						disabled={disabled}
						icon={<IconCrosshair />}
						label={t('components.anchorSelect.custom')}
						onChange={onChangePicking}
						value={picking}
					/>
				</ButtonBar>
				<p className="anchor-select-readout" data-readout="anchor">
					{t('components.anchorSelect.readout', {
						x: roundAnchor(origin).x.toFixed(3),
						y: roundAnchor(origin).y.toFixed(3)
					})}
				</p>
				{picking && pickHint && (
					<p className="anchor-select-hint" role="status">
						{pickHint}
					</p>
				)}
			</div>
		</div>
	);
};
