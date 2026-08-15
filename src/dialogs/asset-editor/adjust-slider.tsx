import {IconArrowBackUp} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../components/control/icon-button';

export interface AdjustSliderProps {
	label: string;
	max: number;
	min: number;
	onChange: (value: number) => void;
	resetLabel: string;
	/** The value that means "leave this alone". */
	resetTo: number;
	step: number;
	value: number;
}

/** One labelled adjustment slider, with the reset the sliders all need. */
export const AdjustSlider: React.FC<AdjustSliderProps> = props => {
	const {label, max, min, onChange, resetLabel, resetTo, step, value} = props;

	return (
		<div className="adjust-slider">
			<label>
				<span className="adjust-slider-label">
					<span>{label}</span>
					<span className="adjust-slider-value">{value}</span>
				</span>
				<input
					max={max}
					min={min}
					onChange={event => onChange(Number(event.target.value))}
					step={step}
					type="range"
					value={value}
				/>
			</label>
			<IconButton
				disabled={value === resetTo}
				icon={<IconArrowBackUp />}
				iconOnly
				label={resetLabel}
				onClick={() => onChange(resetTo)}
			/>
		</div>
	);
};
