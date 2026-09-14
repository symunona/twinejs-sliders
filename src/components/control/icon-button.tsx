import * as React from 'react';
import classNames from 'classnames';
import './icon-button-link.css';
import {Tooltip, TooltipProps} from '../tooltip';
import {CommandKeyChip, useCommandKeyString} from '../../hotkeys';

export interface IconButtonProps {
	ariaChecked?: boolean;
	buttonType?: 'button' | 'submit';
	/**
	 * The command this button runs, if it has one. Only used to show the
	 * keyboard shortcut it's bound to in the button's tooltip--the click
	 * handler is still `onClick`, and `useCommand()` is still what makes the
	 * shortcut work.
	 */
	commandId?: string;
	disabled?: boolean;
	/**
	 * Allows overridding the `label` prop as it's rendered onscreen, e.g. to
	 * apply formatting to the label. If omitted, label is used as-is.
	 */
	displayLabel?: React.ReactNode;
	icon: React.ReactNode;
	iconOnly?: boolean;
	iconPosition?: 'start' | 'end';
	label: string;
	onClick?: (e: React.MouseEvent) => void;
	preventDefault?: boolean;
	role?: string;
	selectable?: boolean;
	selected?: boolean;
	tooltipPosition?: TooltipProps['position'];
	variant?: 'create' | 'danger' | 'primary' | 'secondary';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
	(props, ref) => {
		const {
			ariaChecked,
			commandId,
			disabled,
			icon,
			iconOnly,
			iconPosition = 'start',
			onClick,
			preventDefault,
			role,
			selectable = false,
			selected = false,
			tooltipPosition,
			variant = 'secondary'
		} = props;
		const className = classNames(
			'icon-button',
			`icon-position-${iconPosition}`,
			{selected: selected},
			`variant-${variant}`,
			{'icon-only': iconOnly}
		);
		const [button, setButton] = React.useState<HTMLButtonElement | null>(null);
		// A button whose label is already onscreen normally has no tooltip at
		// all. It gets one when it has a shortcut to show, holding the chip
		// alone--repeating a label that's two pixels away would be noise.
		const keyString = useCommandKeyString(commandId);
		React.useImperativeHandle(ref, () => button as HTMLButtonElement);
		const handleOnClick = (e: React.MouseEvent) => {
			onClick && onClick(e);

			if (preventDefault) {
				e.preventDefault();
			}
		};

		return (
			<>
				<button
					aria-checked={ariaChecked}
					aria-label={iconOnly ? props.label : undefined}
					aria-pressed={selectable ? selected : undefined}
					disabled={disabled}
					className={className}
					onClick={handleOnClick}
					ref={setButton}
					role={role}
				>
					<span className="icon">{icon}</span>
					{!iconOnly && (props.displayLabel ?? props.label)}
				</button>
				{(iconOnly || keyString) && (
					<Tooltip
						anchor={button}
						keys={<CommandKeyChip commandId={commandId} />}
						label={iconOnly ? props.label : undefined}
						// A chip-only tooltip goes below by default. Above is where
						// the rest of the toolbar is--the second row's tooltips landed
						// on the tabs--while below is the content, which the author can
						// still read around a chip.
						position={tooltipPosition ?? (iconOnly ? 'top' : 'bottom')}
					/>
				)}
			</>
		);
	}
);
