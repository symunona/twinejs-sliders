import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Generation} from './generation-store';
import {GenerationActions, nameFromPrompt} from './generation-actions';
import {SaveTarget} from './save-generation';

/**
 * The generation's own shape, as CSS writes it.
 *
 * A grid of same-sized squares tells the author nothing about what they asked for: a 16:9
 * backdrop cropped to a square thumbnail is a lie about the picture behind it. Anything
 * unrecognisable falls back to 1:1 rather than collapsing the tile.
 */
export function tileAspect(aspect: string): string {
	const [w, h] = aspect.split(':').map(part => Number(part.trim()));

	return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
		? `${w} / ${h}`
		: '1 / 1';
}

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

/**
 * One generated image in the history.
 *
 * Picture, prompt, buttons -- nothing else. Model, aspect and date are in the preview
 * pane, because they are read when an author is deciding about ONE image and never while
 * scanning the grid, and every line of them made the picture smaller.
 */
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
	const {t} = useTranslation();

	return (
		<div
			className={classNames('generation-tile', {selected})}
			data-generation-id={generation.id}
		>
			<button
				className="generation-tile-image"
				onClick={onPreview}
				onDoubleClick={onEdit}
				style={{aspectRatio: tileAspect(generation.aspect)}}
				title={t('dialogs.assetGenerator.tileTitle')}
				type="button"
			>
				{url ? (
					<img alt={generation.prompt} src={url} />
				) : (
					<span className="asset-preview-empty" />
				)}
			</button>
			<p className="generation-tile-prompt" title={generation.prompt}>
				{generation.prompt}
			</p>
			<GenerationActions
				busy={busy}
				defaultName={nameFromPrompt(generation.prompt)}
				iconOnly
				onDelete={onDelete}
				onEdit={onEdit}
				onReuse={onReuse}
				onSave={onSave}
			/>
		</div>
	);
};
