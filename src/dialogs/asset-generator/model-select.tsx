import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {TextInput} from '../../components/control/text-input';
import {
	customModel,
	generatorModels,
	GeneratorModel,
	modelFromKey,
	modelKey,
	provider,
	ProviderId,
	providers
} from './models';

export interface ModelSelectProps {
	/** Which providers have a key set. Models of the others are listed but dead. */
	hasKey: Record<ProviderId, boolean>;
	onChange: (key: string) => void;
	value: string;
}

/**
 * The model list is long enough to need searching and will only get longer, so it is a
 * filtered list rather than a `<select>`. Models whose provider has no key stay
 * visible--seeing that Imagen exists is how you find out you want a Google key--but
 * can't be chosen.
 */
export const ModelSelect: React.FC<ModelSelectProps> = props => {
	const {hasKey, onChange, value} = props;
	const [search, setSearch] = React.useState('');
	const {t} = useTranslation();

	const selected = modelFromKey(value);
	const query = search.trim().toLowerCase();
	const matches = generatorModels.filter(
		model =>
			!query ||
			model.label.toLowerCase().includes(query) ||
			model.id.toLowerCase().includes(query) ||
			provider(model.provider).label.toLowerCase().includes(query)
	);

	// A model id typed in full that isn't on the list is almost always a new model
	// rather than a typo--they ship faster than this list is updated.
	const custom: GeneratorModel[] =
		query && !generatorModels.some(model => model.id.toLowerCase() === query)
			? providers
					.filter(candidate => hasKey[candidate.id])
					.map(candidate => customModel(candidate.id, search.trim()))
			: [];

	// Whatever is selected has to stay on screen even when it doesn't match the
	// search, or the list looks like nothing is chosen.
	const selectedOffList =
		selected && ![...matches, ...custom].some(model => modelKey(model) === value)
			? selected
			: undefined;

	function renderRow(model: GeneratorModel, isCustom: boolean) {
		const key = modelKey(model);
		const enabled = hasKey[model.provider];

		return (
			<li key={`${isCustom ? 'custom:' : ''}${key}`}>
				<button
					aria-pressed={key === value}
					className={classNames('model-option', {selected: key === value})}
					disabled={!enabled}
					onClick={() => onChange(key)}
					type="button"
				>
					<span className="model-option-label">
						{isCustom
							? t('dialogs.assetGenerator.customModel', {
									id: model.id,
									provider: provider(model.provider).label
							  })
							: model.label}
					</span>
					<span className="model-option-detail">
						{provider(model.provider).label} · {model.id}
						{model.imageInput
							? ` · ${t('dialogs.assetGenerator.takesAttachments')}`
							: ''}
					</span>
					{!enabled && (
						<span className="model-option-warning">
							{t('dialogs.assetGenerator.needsKey', {
								provider: provider(model.provider).label
							})}
						</span>
					)}
					{enabled && model.note && (
						<span className="model-option-detail">{model.note}</span>
					)}
				</button>
			</li>
		);
	}

	return (
		<div className="model-select">
			<TextInput
				onChange={event => setSearch(event.target.value)}
				orientation="vertical"
				placeholder={t('dialogs.assetGenerator.searchModelsPlaceholder')}
				type="search"
				value={search}
			>
				{t('dialogs.assetGenerator.model')}
			</TextInput>
			<ul className="model-options">
				{selectedOffList && renderRow(selectedOffList, false)}
				{matches.map(model => renderRow(model, false))}
				{custom.map(model => renderRow(model, true))}
				{matches.length === 0 && custom.length === 0 && !selectedOffList && (
					<li className="model-options-empty">
						{t('dialogs.assetGenerator.noModels')}
					</li>
				)}
			</ul>
		</div>
	);
};
