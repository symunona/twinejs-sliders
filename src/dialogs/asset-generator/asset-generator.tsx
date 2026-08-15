import {AssetId} from '@sliders/scene-types';
import {IconWand, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {TextSelect} from '../../components/control/text-select';
import {useCommand} from '../../hotkeys';
import {setPref, usePrefsContext} from '../../store/prefs';
import {AssetEditorDialog} from '../asset-editor';
import {useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {
	refreshAssetLibrary,
	slidersAssetStore,
	useAssetLibrary,
	useAssetUrl
} from '../sliders-assets/asset-store-context';
import {AssetPicker} from './asset-picker';
import {generateImage, GenerateError} from './generate';
import {
	Generation,
	generationId,
	putGeneration,
	removeGeneration,
	updateGeneration
} from './generation-store';
import {GenerationTile} from './generation-tile';
import {GeneratorPreview, GeneratorSelection} from './generator-preview';
import {ModelSelect} from './model-select';
import {aspectRatios, modelFromKey, provider, ProviderId} from './models';
import {SaveTarget, saveGeneration} from './save-generation';
import {refreshGenerations, useGenerations} from './use-generations';
import './asset-generator.css';

export type AssetGeneratorDialogProps = DialogComponentProps;

export const AssetGeneratorDialog: React.FC<
	AssetGeneratorDialogProps
> = props => {
	const {dispatch} = useDialogsContext();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const store = React.useMemo(() => slidersAssetStore(), []);
	const history = useGenerations();
	const cancel = React.useRef<AbortController>();
	const [attachments, setAttachments] = React.useState<AssetId[]>([]);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string>();
	const [notice, setNotice] = React.useState<string>();
	const [prompt, setPrompt] = React.useState('');
	const [saving, setSaving] = React.useState<string>();
	const [selection, setSelection] = React.useState<GeneratorSelection>();
	const library = useAssetLibrary();
	const {t} = useTranslation();

	// Assets live in the store rather than in memory, so the preview has to resolve
	// its own URL; generations already hold one per blob.
	const assetUrl = useAssetUrl(
		selection?.kind === 'asset' ? selection.id : undefined
	);
	const previewed =
		selection?.kind === 'generation'
			? history.generations.find(entry => entry.id === selection.id)
			: undefined;
	const previewedAsset =
		selection?.kind === 'asset'
			? library.all.find(asset => asset.id === selection.id)
			: undefined;
	const preview = previewed
		? {
				detail: `${previewed.model} · ${previewed.aspect} · ${new Date(
					previewed.createdAt
				).toLocaleString()}`,
				name: previewed.prompt,
				url: history.urls[previewed.id]
		  }
		: {
				detail: previewedAsset
					? t('dialogs.assetGenerator.libraryAsset')
					: undefined,
				name: previewedAsset?.name,
				url: previewedAsset ? assetUrl : undefined
		  };

	const hasKey: Record<ProviderId, boolean> = {
		gemini: prefs.geminiApiKey.trim() !== '',
		openai: prefs.openAiApiKey.trim() !== ''
	};
	const anyKey = hasKey.gemini || hasKey.openai;
	const model = modelFromKey(prefs.assetGeneratorModel);
	// A model whose provider lost its key can't run, and silently swapping it for one
	// that can would hide why nothing happens.
	const usable = model !== undefined && hasKey[model.provider];
	const aspect = prefs.assetGeneratorAspect;

	async function handleGenerate() {
		if (!model || !usable || busy || !prompt.trim()) {
			return;
		}

		const controller = new AbortController();

		cancel.current = controller;
		setBusy(true);
		setError(undefined);
		setNotice(undefined);

		try {
			// Only send what this model can actually use--attaching to Imagen would
			// otherwise look like it was taken into account.
			const attached = model.imageInput ? attachments : [];
			const files = [];

			for (const id of attached) {
				const [blob, meta] = await Promise.all([
					store.get(id),
					store.meta(id)
				]);

				if (blob) {
					files.push({blob, name: meta?.name ?? id});
				}
			}

			const image = await generateImage({
				aspect,
				attachments: files,
				key:
					model.provider === 'gemini'
						? prefs.geminiApiKey.trim()
						: prefs.openAiApiKey.trim(),
				model,
				prompt: prompt.trim(),
				signal: controller.signal
			});

			const generation: Generation = {
				aspect,
				attachments: attached,
				blob: image.blob,
				createdAt: Date.now(),
				id: generationId(),
				model: model.id,
				prompt: prompt.trim(),
				provider: model.provider,
				savedAs: []
			};

			await putGeneration(generation);
			refreshGenerations();
			// What was just asked for is what the author wants to look at.
			setSelection({id: generation.id, kind: 'generation'});

			if (image.text) {
				setNotice(image.text);
			}
		} catch (generateError) {
			const failure = generateError as Error;

			if (failure?.name === 'AbortError') {
				// The author asked for this.
			} else if (generateError instanceof GenerateError) {
				setError(failure.message);
			} else {
				console.error('Could not generate an image', generateError);
				setError(
					t('dialogs.assetGenerator.requestError', {
						message: failure?.message ?? String(generateError)
					})
				);
			}
		} finally {
			cancel.current = undefined;
			setBusy(false);
		}
	}

	async function handleSave(
		generation: Generation,
		target: SaveTarget,
		name: string
	) {
		setError(undefined);
		setNotice(undefined);
		setSaving(generation.id);

		try {
			const result = await saveGeneration(store, generation, target, name);

			await updateGeneration(generation.id, {
				savedAs: [...new Set([...generation.savedAs, result.label])]
			});
			refreshAssetLibrary();
			refreshGenerations();
			setNotice(
				result.duplicate
					? t('dialogs.assetGenerator.alreadySaved', {name: result.label})
					: t('dialogs.assetGenerator.saved', {name: result.label})
			);
		} catch (saveError) {
			console.error('Could not save a generated image', saveError);
			setError(t('dialogs.assetGenerator.saveError'));
		} finally {
			setSaving(undefined);
		}
	}

	async function handleDelete(generation: Generation) {
		await removeGeneration(generation.id);
		refreshGenerations();
		setSelection(current =>
			current?.kind === 'generation' && current.id === generation.id
				? undefined
				: current
		);
	}

	/**
	 * The asset editor is the only place background removal, crop and levels live, so
	 * editing a generation opens it on the raw bytes. Applying writes back into the
	 * history rather than the library: nothing is saved as an asset until someone
	 * presses one of the three save buttons.
	 */
	function handleEdit(generation: Generation) {
		dispatch({
			type: 'addDialog',
			component: AssetEditorDialog,
			maximized: true,
			props: {
				onApply: async (blob: Blob) => {
					await updateGeneration(generation.id, {blob});
					refreshGenerations();
				},
				source: {
					blob: generation.blob,
					name: generation.prompt.slice(0, 40)
				}
			}
		});
	}

	/** Double-clicking a library asset edits the asset itself, in place. */
	function handleEditAsset(assetId: AssetId) {
		dispatch({
			type: 'addDialog',
			component: AssetEditorDialog,
			maximized: true,
			props: {assetId}
		});
	}

	function handleReuse(generation: Generation) {
		setPrompt(generation.prompt);
		setAttachments(generation.attachments);
	}

	useCommand({
		allowInInput: true,
		enabled: !busy && usable && prompt.trim() !== '',
		id: 'assetGenerator.generate',
		label: t('hotkeys.commands.assetGenerator.generate'),
		run: handleGenerate,
		scope: 'asset-generator'
	});

	useCommand({
		allowInInput: true,
		enabled: busy,
		id: 'assetGenerator.stop',
		label: t('hotkeys.commands.assetGenerator.stop'),
		run: () => cancel.current?.abort(),
		scope: 'asset-generator'
	});

	return (
		<DialogCard
			{...props}
			className="asset-generator-dialog"
			focusOnOpen
			headerLabel={t('dialogs.assetGenerator.title')}
			hotkeyScope="asset-generator"
			maximizable
		>
			{!anyKey && (
				<p className="asset-generator-warning" role="status">
					{t('dialogs.assetGenerator.noKeys')}
				</p>
			)}
			{error && (
				<p className="asset-editor-error" role="alert">
					{error}
				</p>
			)}
			{notice && (
				<p className="asset-generator-notice" role="status">
					{notice}
				</p>
			)}
			<div className="asset-generator">
				<div className="asset-generator-compose">
					<label className="asset-generator-prompt">
						<span>{t('dialogs.assetGenerator.prompt')}</span>
						<textarea
							onChange={event => setPrompt(event.target.value)}
							placeholder={t('dialogs.assetGenerator.promptPlaceholder')}
							rows={5}
							value={prompt}
						/>
					</label>
					<ButtonBar>
						{/* One button, two jobs: while a request is out there is nothing to
						    press but Stop, so it takes the Generate button's place. */}
						{busy ? (
							<IconButton
								icon={<IconX />}
								label={t('dialogs.assetGenerator.stop')}
								onClick={() => cancel.current?.abort()}
								variant="danger"
							/>
						) : (
							<IconButton
								disabled={!usable || prompt.trim() === ''}
								icon={<IconWand />}
								label={t('dialogs.assetGenerator.generate')}
								onClick={handleGenerate}
								variant="create"
							/>
						)}
					</ButtonBar>
					{busy && (
						<p className="asset-generator-detail" role="status">
							{t('dialogs.assetGenerator.working', {
								model: model?.label ?? ''
							})}
						</p>
					)}
					<div className="asset-generator-settings">
						<ModelSelect
							hasKey={hasKey}
							onChange={key => prefsDispatch(setPref('assetGeneratorModel', key))}
							value={prefs.assetGeneratorModel}
						/>
						<TextSelect
							onChange={event =>
								prefsDispatch(setPref('assetGeneratorAspect', event.target.value))
							}
							options={aspectRatios.map(ratio => ({
								label: ratio,
								value: ratio
							}))}
							value={aspect}
						>
							{t('dialogs.assetGenerator.aspect')}
						</TextSelect>
					</div>
					{model && !usable && (
						<p className="asset-generator-warning">
							{t('dialogs.assetGenerator.needsKey', {
								provider: provider(model.provider).label
							})}
						</p>
					)}
					{!model && (
						<p className="asset-generator-warning">
							{t('dialogs.assetGenerator.pickModel')}
						</p>
					)}
					{model && !model.imageInput && attachments.length > 0 && (
						<p className="asset-generator-detail">
							{t('dialogs.assetGenerator.attachmentsIgnored', {
								model: model.label
							})}
						</p>
					)}
					<AssetPicker
						onChange={setAttachments}
						onEdit={handleEditAsset}
						onPreview={id => setSelection({id, kind: 'asset'})}
						previewId={selection?.kind === 'asset' ? selection.id : undefined}
						value={attachments}
					/>
				</div>
				<div className="asset-generator-side">
					<GeneratorPreview
						detail={preview.detail}
						name={preview.name}
						url={preview.url}
					/>
				</div>
			</div>
			<h3 className="asset-generator-heading">
				{t('dialogs.assetGenerator.history')}
			</h3>
			<div className="asset-generator-history">
				<div className="sliders-tiles">
					{history.generations.map(generation => (
						<GenerationTile
							busy={saving === generation.id}
							generation={generation}
							key={generation.id}
							onDelete={() => handleDelete(generation)}
							onEdit={() => handleEdit(generation)}
							onPreview={() =>
								setSelection({id: generation.id, kind: 'generation'})
							}
							onReuse={() => handleReuse(generation)}
							onSave={(target, name) => handleSave(generation, target, name)}
							selected={
								selection?.kind === 'generation' &&
								selection.id === generation.id
							}
							url={history.urls[generation.id]}
						/>
					))}
				</div>
				{!history.busy && history.generations.length === 0 && (
					<p className="sliders-empty">
						{t('dialogs.assetGenerator.emptyHistory')}
					</p>
				)}
			</div>
			<div className="sliders-note">
				<p className="sliders-backend">
					{t('dialogs.assetGenerator.historyNote')}
				</p>
			</div>
		</DialogCard>
	);
};
