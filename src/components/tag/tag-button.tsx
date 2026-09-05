import * as React from 'react';
import classNames from 'classnames';
import {useTranslation} from 'react-i18next';
import {IconChevronDown, IconX} from '@tabler/icons';
import {IconButton} from '../control/icon-button';
import {MenuButton} from '../control/menu-button';
import {colors, Color} from '../../util/color';
import './tag-button.css';

export interface TagButtonProps {
	color?: Color;
	disabled?: boolean;
	name: string;
	onChangeColor?: (color: Color) => void;
	onRemove: () => void;
}

export const TagButton: React.FC<TagButtonProps> = props => {
	const {t} = useTranslation();

	// No `onChangeColor` means the tag has no color concept (e.g. asset tags,
	// not story/passage tags) -- render a plain chip with a direct remove
	// button instead of the color-picker menu.

	if (!props.onChangeColor) {
		return (
			<span className="tag-button plain">
				<span className="tag-button-label">{props.name}</span>
				<IconButton
					disabled={props.disabled}
					icon={<IconX />}
					iconOnly
					label={t('common.remove')}
					onClick={props.onRemove}
				/>
			</span>
		);
	}

	const onChangeColor = props.onChangeColor;

	return (
		<span className={classNames('tag-button', `color-${props.color}`)}>
			<MenuButton
				disabled={props.disabled}
				icon={<IconChevronDown />}
				iconPosition="end"
				items={[
					...colors.map(color => ({
						checkable: true,
						checked: color === 'none' ? !props.color : color === props.color,
						label: t(`colors.${color}`),
						onClick: () => onChangeColor(color)
					})),
					{
						separator: true
					},
					{
						label: t('common.remove'),
						onClick: props.onRemove
					}
				]}
				label={props.name}
			/>
		</span>
	);
};
