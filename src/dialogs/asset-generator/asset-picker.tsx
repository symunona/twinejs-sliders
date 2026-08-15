import {AssetId} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {TextInput} from '../../components/control/text-input';
import {AssetPreview} from '../sliders-assets/asset-preview';
import {useAssetLibrary} from '../sliders-assets/asset-store-context';

export interface AssetPickerProps {
	disabled?: boolean;
	onChange: (ids: AssetId[]) => void;
	/** Double-clicking an asset opens the asset editor on it. */
	onEdit?: (id: AssetId) => void;
	/** Clicking an asset also shows it in the preview pane. */
	onPreview?: (id: AssetId) => void;
	/** Which asset the preview pane is showing, if it is showing one of these. */
	previewId?: AssetId;
	value: AssetId[];
}

/**
 * Picks library assets to send along with the prompt. Character frames are included,
 * because "the same character, now sitting down" is the main reason to attach anything.
 */
export const AssetPicker: React.FC<AssetPickerProps> = props => {
	const {disabled, onChange, onEdit, onPreview, previewId, value} = props;
	const library = useAssetLibrary();
	const [search, setSearch] = React.useState('');
	const {t} = useTranslation();

	const query = search.trim().toLowerCase();
	const matches = library.all.filter(
		asset => !query || asset.name.toLowerCase().includes(query)
	);

	function toggle(id: AssetId) {
		onChange(
			value.includes(id) ? value.filter(other => other !== id) : [...value, id]
		);
		onPreview?.(id);
	}

	return (
		<div className={classNames('asset-picker', {disabled})}>
			<TextInput
				onChange={event => setSearch(event.target.value)}
				orientation="vertical"
				placeholder={t('dialogs.assetGenerator.searchAssetsPlaceholder')}
				type="search"
				value={search}
			>
				{t('dialogs.assetGenerator.attach')}
			</TextInput>
			<div className="asset-picker-grid">
				{matches.map(asset => (
					<button
						aria-pressed={value.includes(asset.id)}
						className={classNames('asset-picker-item', {
							previewed: previewId === asset.id,
							selected: value.includes(asset.id)
						})}
						disabled={disabled}
						key={asset.id}
						onClick={() => toggle(asset.id)}
						// A double click toggles the attachment twice, ending where it
						// started, so opening the editor is all it does.
						onDoubleClick={() => onEdit?.(asset.id)}
						title={t('dialogs.assetGenerator.assetTitle', {name: asset.name})}
						type="button"
					>
						<AssetPreview alt={asset.name} assetId={asset.id} />
						<span className="asset-picker-name">{asset.name}</span>
					</button>
				))}
			</div>
			{matches.length === 0 && (
				<p className="asset-picker-empty">
					{t('dialogs.assetGenerator.noAssets')}
				</p>
			)}
		</div>
	);
};
