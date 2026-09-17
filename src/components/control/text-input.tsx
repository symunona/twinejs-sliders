import classNames from 'classnames';
import * as React from 'react';
import './text-input.css';

export interface TextInputProps {
	children: React.ReactNode;
	/** Greyed and unfocusable, for a field whose value is being decided elsewhere. */
	disabled?: boolean;
	id?: string;
	list?: string;
	onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
	onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
	onInput?: (event: React.FormEvent<HTMLInputElement>) => void;
	onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
	orientation?: 'horizontal' | 'vertical';
	placeholder?: string;
	type?: 'number' | 'password' | 'search' | 'text';
	value: string;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
	(props, ref) => {
		const className = classNames(
			'text-input',
			`orientation-${props.orientation}`,
			`type-${props.type}`
		);

		return (
			<span className={className}>
				<label>
					<span className="text-input-label">{props.children}</span>
					<input
						disabled={props.disabled}
						id={props.id}
						list={props.list}
						onBlur={props.onBlur}
						onChange={props.onChange}
						onInput={props.onInput}
						onKeyDown={props.onKeyDown}
						placeholder={props.placeholder}
						ref={ref}
						type={props.type ?? 'text'}
						value={props.value}
					/>
				</label>
			</span>
		);
	}
);
