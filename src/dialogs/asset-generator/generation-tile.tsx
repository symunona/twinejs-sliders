import {nameFromFilename} from '@sliders/asset-store';
import classNames from 'classnames';
import {
	IconCopy,
	IconPhotoEdit,
	IconTrash,
	IconUser,
	IconWallpaper,
	IconBox
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../components/badge/badge';
import {ButtonBar} from '../../components/container/button-bar';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {TextInput} from '../../components/control/text-input';
import {Generation} from './generation-store';
import {SaveTarget} from './save-generation';

export interface GenerationTileProps {
	busy: boolean;
	generation: Generation;
	onDelete: () => void;
	onEdit: () => void;
	/** Clicking the image shows it in the preview pane. */
	onPreview: () => void;
	onReuse: () => void;
	onSave: (target: SaveTarget, name: string) => void;
	/** Is the preview pane showing this one? */
	selected?: boolean;
	url?: string;
}

/** Turns a prompt into something usable as an asset name without a lot of typing. */
function nameFromPrompt(prompt: string): string {
	return nameFromFilename(prompt.split(/[.,\n]/)[0].slice(0, 48));
}

export const GenerationTile: React.FC<GenerationTileProps> = props => {
	const {
		busy,
		generation,
		onDelete,
		onEdit,
		onPreview,
		onReuse,
		onSave,
		selected,
		url
	} = props;
	const [name, setName] = React.useState(() => nameFromPrompt(generation.prompt));
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
		<div
			className={classNames('generation-tile', {selected})}
			data-generation-id={generation.id}
		>
			<button
				className="generation-tile-image"
				onClick={onPreview}
				onDoubleClick={onEdit}
				title={t('dialogs.assetGenerator.tileTitle')}
				type="button"
			>
				<span className="asset-preview">
					{url ? (
						<img alt={generation.prompt} src={url} />
					) : (
						<span className="asset-preview-empty" />
					)}
				</span>
			</button>
			<p className="generation-tile-prompt" title={generation.prompt}>
				{generation.prompt}
			</p>
			<p className="sliders-tile-detail">
				{generation.model} · {generation.aspect} ·{' '}
				{new Date(generation.createdAt).toLocaleString()}
			</p>
			{generation.savedAs.length > 0 && (
				<div className="sliders-tile-badges">
					{generation.savedAs.map(saved => (
						<Badge
							key={saved}
							label={t('dialogs.assetGenerator.savedAs', {name: saved})}
						/>
					))}
				</div>
			)}
			<TextInput
				onChange={event => setName(event.target.value)}
				orientation="vertical"
				value={name}
			>
				{t('dialogs.assetGenerator.assetName')}
			</TextInput>
			<ButtonBar>
				{targets.map(entry => (
					<IconButton
						disabled={busy || !name.trim()}
						icon={entry.icon}
						key={entry.target}
						label={entry.label}
						onClick={() => onSave(entry.target, name.trim())}
						variant="create"
					/>
				))}
			</ButtonBar>
			<ButtonBar>
				<IconButton
					disabled={busy}
					icon={<IconPhotoEdit />}
					label={t('dialogs.assetGenerator.edit')}
					onClick={onEdit}
				/>
				<IconButton
					disabled={busy}
					icon={<IconCopy />}
					label={t('dialogs.assetGenerator.reuse')}
					onClick={onReuse}
				/>
				<ConfirmButton
					confirmVariant="danger"
					disabled={busy}
					icon={<IconTrash />}
					label={t('common.delete')}
					onConfirm={onDelete}
					prompt={t('dialogs.assetGenerator.deletePrompt')}
				/>
			</ButtonBar>
		</div>
	);
};
