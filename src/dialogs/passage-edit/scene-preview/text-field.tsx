import * as React from 'react';
import {TextInput} from '../../../components/control/text-input';

export interface TextFieldProps {
	label: string;
	value: string | undefined;
	/** The trimmed text, or `undefined` when the box was emptied. */
	onCommit: (value: string | undefined) => void;
	disabled?: boolean;
	placeholder?: string;
}

/**
 * A text box that writes on blur and Enter. Escape puts back what the scene says.
 *
 * Nothing typed writes nothing, so tabbing through the panel leaves no undo entries — and a
 * mixed selection shown empty is not cleared by passing through it. Same rules as
 * `NumberField`.
 */
export const TextField: React.FC<TextFieldProps> = ({
	disabled,
	label,
	onCommit,
	placeholder,
	value
}) => {
	const [draft, setDraft] = React.useState<string>();
	const shown = draft ?? value ?? '';

	// A reparse that changed the value under the box wins over a stale draft.
	React.useEffect(() => setDraft(undefined), [value]);

	function commit() {
		if (draft === undefined) {
			return;
		}

		setDraft(undefined);

		const trimmed = draft.trim();
		const next = trimmed === '' ? undefined : trimmed;

		if (next !== value) {
			onCommit(next);
		}
	}

	return (
		<TextInput
			disabled={disabled}
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
			value={shown}
		>
			{label}
		</TextInput>
	);
};
