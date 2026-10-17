import * as React from 'react';
import {TextInput} from '../../../components/control/text-input';
import './beat-props.css';

export interface NumberFieldProps {
	label: string;
	value: number | undefined;
	/** Called with the new number, or `undefined` when the box was emptied. */
	onCommit: (value: number | undefined) => void;
	disabled?: boolean;
	min?: number;
	max?: number;
	step?: number;
	placeholder?: string;
	unit?: string;
}

/**
 * A number box that writes on blur and Enter. Escape puts back what the text says.
 *
 * Refuses rather than writes what the parser would only reject back: not a number, or
 * outside `min`/`max`. An emptied box is a removal, not a zero.
 */
export const NumberField: React.FC<NumberFieldProps> = ({
	disabled,
	label,
	max,
	min,
	onCommit,
	placeholder,
	step,
	unit,
	value
}) => {
	const [draft, setDraft] = React.useState<string>();
	const shown = draft ?? (value === undefined ? '' : String(value));

	// A reparse that changed the value under the box wins over a stale draft.
	React.useEffect(() => setDraft(undefined), [value]);

	function commit() {
		setDraft(undefined);

		const trimmed = shown.trim();

		if (trimmed === '') {
			if (value !== undefined) {
				onCommit(undefined);
			}

			return;
		}

		const next = Number(trimmed);

		if (
			!Number.isFinite(next) ||
			next === value ||
			(min !== undefined && next < min) ||
			(max !== undefined && next > max)
		) {
			return;
		}

		onCommit(next);
	}

	return (
		<>
			<span className="scene-settings-number">
				<TextInput
					disabled={disabled}
					max={max}
					min={min}
					onBlur={commit}
					onChange={event => setDraft(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Enter') {
							commit();
						}

						if (event.key === 'Escape') {
							setDraft(undefined);
						}
					}}
					placeholder={placeholder}
					step={step}
					type="number"
					value={shown}
				>
					{label}
				</TextInput>
			</span>
			{unit && <span className="beat-prop-unit">{unit}</span>}
		</>
	);
};
