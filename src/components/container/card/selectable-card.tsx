import classNames from 'classnames';
import * as React from 'react';
import {Card, CardProps} from './card';
import './selectable-card.css';

export interface SelectableCardProps extends CardProps {
	/**
	 * Inert: no selection, no double-click, out of the tab order. For a card whose story
	 * is still arriving — selecting it would open an editor missing half its art.
	 */
	disabled?: boolean;
	label: string;
	onDoubleClick?: React.MouseEventHandler;
	onSelect: (value: boolean, exclusive: boolean) => void;
	selected?: boolean;
}

export const SelectableCard: React.FC<SelectableCardProps> = props => {
	const {disabled, label, onDoubleClick, onSelect, selected, ...other} = props;
	const onClick = React.useCallback(
		(event: React.MouseEvent) => {
			if (disabled) {
				return;
			}

			if (event.ctrlKey || event.shiftKey) {
				onSelect(!selected, false);
			} else {
				onSelect(true, true);
			}
		},
		[disabled, onSelect, selected]
	);
	const onKeyDown = React.useCallback(
		(event: React.KeyboardEvent) => {
			if (disabled) {
				return;
			}

			if (event.key === ' ' || event.key === 'Enter') {
				event.preventDefault();

				if (event.ctrlKey || event.shiftKey) {
					onSelect(!selected, false);
				} else {
					onSelect(true, true);
				}
			}
		},
		[disabled, onSelect, selected]
	);

	return (
		<div
			className={classNames('selectable-card', {disabled, selected})}
			role="button"
			aria-label={label}
			aria-disabled={disabled}
			aria-pressed={selected}
			onClick={onClick}
			onDoubleClick={disabled ? undefined : onDoubleClick}
			onKeyDown={onKeyDown}
			tabIndex={disabled ? -1 : 0}
		>
			<Card {...other} />
		</div>
	);
};
