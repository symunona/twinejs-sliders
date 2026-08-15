import {IconChevronDown} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {usePopper} from 'react-popper';
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
 * One line that names the current model, and a panel that drops out of it. The list is
 * long enough to need searching and will only get longer, so the panel is a filtered
 * list rather than a `<select>`. Models whose provider has no key stay visible--seeing
 * that Imagen exists is how you find out you want a Google key--but can't be chosen.
 */
export const ModelSelect: React.FC<ModelSelectProps> = props => {
	const {hasKey, onChange, value} = props;
	const [open, setOpen] = React.useState(false);
	const [search, setSearch] = React.useState('');
	const [buttonEl, setButtonEl] = React.useState<HTMLButtonElement | null>(null);
	const [panelEl, setPanelEl] = React.useState<HTMLDivElement | null>(null);
	const searchEl = React.useRef<HTMLInputElement>(null);
	const {attributes, styles} = usePopper(buttonEl, panelEl, {
		placement: 'bottom-start',
		// The dialog is a transformed ancestor, so an absolute panel would be clipped
		// by it and scroll away from its button.
		strategy: 'fixed'
	});
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

	React.useEffect(() => {
		if (!open) {
			return;
		}

		searchEl.current?.focus();

		const onPointerDown = (event: MouseEvent) => {
			const target = event.target as Node;

			// Clicking the search field must not count as clicking away.
			if (panelEl?.contains(target) || buttonEl?.contains(target)) {
				return;
			}

			setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				// Captured, so Escape closes the list rather than the whole dialog.
				event.preventDefault();
				event.stopPropagation();
				setOpen(false);
				buttonEl?.focus();
			}
		};

		document.addEventListener('mousedown', onPointerDown);
		document.addEventListener('keydown', onKeyDown, true);

		return () => {
			document.removeEventListener('mousedown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	}, [buttonEl, open, panelEl]);

	function handleOpen() {
		setSearch('');
		setOpen(current => !current);
	}

	function handlePick(key: string) {
		onChange(key);
		setOpen(false);
		buttonEl?.focus();
	}

	function renderRow(model: GeneratorModel, isCustom: boolean) {
		const key = modelKey(model);
		const enabled = hasKey[model.provider];

		return (
			<li key={`${isCustom ? 'custom:' : ''}${key}`}>
				<button
					aria-pressed={key === value}
					className={classNames('model-option', {selected: key === value})}
					disabled={!enabled}
					onClick={() => handlePick(key)}
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
			<span className="model-select-label">
				{t('dialogs.assetGenerator.model')}
			</span>
			<button
				aria-expanded={open}
				aria-haspopup="listbox"
				className="model-select-toggle"
				onClick={handleOpen}
				ref={setButtonEl}
				title={selected ? `${provider(selected.provider).label} · ${selected.id}` : undefined}
				type="button"
			>
				<span className="model-select-value">
					{selected?.label ?? t('dialogs.assetGenerator.pickModel')}
				</span>
				{selected && (
					<span className="model-select-provider">
						{provider(selected.provider).label}
					</span>
				)}
				<IconChevronDown />
			</button>
			{open && (
				<div
					className="model-select-panel"
					ref={setPanelEl}
					style={styles.popper}
					{...attributes.popper}
				>
					<TextInput
						onChange={event => setSearch(event.target.value)}
						orientation="vertical"
						placeholder={t('dialogs.assetGenerator.searchModelsPlaceholder')}
						ref={searchEl}
						type="search"
						value={search}
					>
						{t('dialogs.assetGenerator.searchModels')}
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
			)}
		</div>
	);
};
