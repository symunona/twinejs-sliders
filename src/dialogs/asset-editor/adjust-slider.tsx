import {IconArrowBackUp} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../components/control/icon-button';
import './adjust-slider.css';

export interface AdjustSliderProps {
	/**
	 * Lets the value be typed as well as dragged, and accepts numbers past the slider's own
	 * ends. Use it where the range is a comfortable default rather than a real limit.
	 */
	editable?: boolean;
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
	const {editable, label, max, min, onChange, resetLabel, resetTo, step, value} =
		props;
	/**
	 * What is in the box while it is being typed in. Half-written numbers like `1.` or `-`
	 * are not values yet, and echoing the committed number back would fight the typing.
	 */
	const [draft, setDraft] = React.useState<string>();

	function handleTyped(typed: string) {
		const parsed = Number(typed);

		setDraft(typed);

		if (typed.trim() !== '' && Number.isFinite(parsed)) {
			onChange(parsed);
		}
	}

	return (
		<div className="adjust-slider">
			<label>
				<span className="adjust-slider-label">
					<span>{label}</span>
					{editable ? (
						<input
							aria-label={label}
							className="adjust-slider-number"
							onBlur={() => setDraft(undefined)}
							onChange={event => handleTyped(event.target.value)}
							step={step}
							type="number"
							value={draft ?? value}
						/>
					) : (
						<span className="adjust-slider-value">{value}</span>
					)}
				</span>
				<input
					max={max}
					min={min}
					onChange={event => {
						setDraft(undefined);
						onChange(Number(event.target.value));
					}}
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
				onClick={() => {
					setDraft(undefined);
					onChange(resetTo);
				}}
			/>
		</div>
	);
};
