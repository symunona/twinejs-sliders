import {nameFromFilename} from '@sliders/asset-store';
import {
	IconBox,
	IconCopy,
	IconPhotoEdit,
	IconTrash,
	IconUser,
	IconWallpaper
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {PromptButton} from '../../components/control/prompt-button';
import {SaveTarget} from './save-generation';

/** Turns a prompt into something usable as an asset name without a lot of typing. */
export function nameFromPrompt(prompt: string): string {
	return nameFromFilename(prompt.split(/[.,\n]/)[0].slice(0, 48));
}

export interface GenerationActionsProps {
	busy: boolean;
	/** What the name box starts with--the prompt, trimmed to something nameable. */
	defaultName: string;
	/** Icons alone. What a tile in the grid wants; the preview pane has room for words. */
	iconOnly?: boolean;
	onDelete: () => void;
	onEdit: () => void;
	onReuse: () => void;
	onSave: (target: SaveTarget, name: string) => void;
}

/**
 * Everything that can be done with one generated image.
 *
 * Shared by the history tile and the preview pane rather than written twice: the pane is
 * where an author decides, having finally seen the image at a size worth judging, and a
 * pane that could only look would send them back to a thumbnail to act.
 *
 * The name is asked for in a popup, not in a box on the tile. A tile carrying a text field
 * is a tile three times taller than its picture, and the name is wanted once--at the moment
 * of saving--not on every tile in the grid forever.
 */
export const GenerationActions: React.FC<GenerationActionsProps> = props => {
	const {busy, defaultName, iconOnly, onDelete, onEdit, onReuse, onSave} = props;
	const [name, setName] = React.useState(defaultName);
	const {t} = useTranslation();

	const targets: {icon: React.ReactNode; label: string; target: SaveTarget}[] = [
		{
			icon: <IconWallpaper />,
			label: t('dialogs.assetGenerator.saveAsBackground'),
			target: 'bg'
		},
		{
			icon: <IconBox />,
			label: t('dialogs.assetGenerator.saveAsObject'),
			target: 'object'
		},
		{
			icon: <IconUser />,
			label: t('dialogs.assetGenerator.saveAsCharacter'),
			target: 'character'
		}
	];

	return (
		<ButtonBar>
			{targets.map(entry => (
				<PromptButton
					disabled={busy}
					icon={entry.icon}
					iconOnly={iconOnly}
					key={entry.target}
					label={entry.label}
					onChange={event => setName(event.target.value)}
					// A fresh prompt starts from the generation's own name again: a name
					// typed for the background is not a suggestion for the character.
					onChangeOpen={open => open && setName(defaultName)}
					onSubmit={value => onSave(entry.target, value.trim())}
					prompt={t('dialogs.assetGenerator.assetName')}
					submitLabel={entry.label}
					submitVariant="create"
					validate={value =>
						value.trim() === ''
							? {message: t('dialogs.assetGenerator.nameRequired'), valid: false}
							: {valid: true}
					}
					value={name}
					variant="create"
				/>
			))}
			<IconButton
				disabled={busy}
				icon={<IconPhotoEdit />}
				iconOnly={iconOnly}
				label={t('dialogs.assetGenerator.edit')}
				onClick={onEdit}
			/>
			<IconButton
				disabled={busy}
				icon={<IconCopy />}
				iconOnly={iconOnly}
				label={t('dialogs.assetGenerator.reuse')}
				onClick={onReuse}
			/>
			<ConfirmButton
				confirmVariant="danger"
				disabled={busy}
				icon={<IconTrash />}
				iconOnly={iconOnly}
				label={t('common.delete')}
				onConfirm={onDelete}
				prompt={t('dialogs.assetGenerator.deletePrompt')}
			/>
		</ButtonBar>
	);
};
