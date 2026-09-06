import classNames from 'classnames';
import * as React from 'react';
import './badge.css';

export interface BadgeProps {
	label: string;
	/** Hover text, when the label alone doesn't explain itself. */
	title?: string;
	variant?: 'neutral' | 'warning';
}

export const Badge: React.FC<BadgeProps> = ({
	label,
	title,
	variant = 'neutral'
}) => (
	<span className={classNames('badge', `variant-${variant}`)} title={title}>
		{label}
	</span>
);
