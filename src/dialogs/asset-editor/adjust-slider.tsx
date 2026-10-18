import {IconArrowBackUp} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {IconButton} from '../../components/control/icon-button';
import './adjust-slider.css';

export interface AdjustSliderProps {
	/** Greys the whole control out. The reset button follows it. */
	disabled?: boolean;
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

/**
 * One labelled adjustment slider, with the reset the sliders all need. Characters, asset
 * effects/masks/tiles and stage grades all use this one. Off its default = `overridden`,
 * the editor's blue "not default" look (`beat-prop-row.overridden`).
 */
export const AdjustSlider: React.FC<AdjustSliderProps> = props => {
	const {
		disabled,
		editable,
		label,
		max,
		min,
		onChange,
		resetLabel,
		resetTo,
		step,
		value
	} = props;
	/**
	 * What is in the box while it is being typed in. Half-written numbers like `1.` or `-`
	 * are not values yet, and echoing the committed number back would fight the typing.
	 */
	const [draft, setDraft] = React.useState<string>();
	const overridden = value !== resetTo;

	function handleTyped(typed: string) {
		const parsed = Number(typed);

		setDraft(typed);

		if (typed.trim() !== '' && Number.isFinite(parsed)) {
			onChange(parsed);
		}
	}

	return (
		<div className={classNames('adjust-slider', {overridden})}>
			<label>
				<span className="adjust-slider-label">
					<span className="adjust-slider-name">{label}</span>
					{editable ? (
						<input
							aria-label={label}
							className="adjust-slider-number"
							disabled={disabled}
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
					disabled={disabled}
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
			{/* Outside the label (a button is labelable too), placed on its name line by
			    the grid in adjust-slider.css. */}
			<IconButton
				disabled={disabled || !overridden}
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
