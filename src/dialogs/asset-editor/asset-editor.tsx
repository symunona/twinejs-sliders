import {AssetId, AssetMeta} from '@sliders/scene-types';
import {
	IconCrop,
	IconDeviceFloppy,
	IconEraser,
	IconLink,
	IconWand,
	IconX
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {DialogCard} from '../../components/container/dialog-card';
import {CheckboxButton} from '../../components/control/checkbox-button';
import {IconButton} from '../../components/control/icon-button';
import {TextInput} from '../../components/control/text-input';
import {DialogComponentProps} from '../dialogs.types';
import {
	refreshAssetLibrary,
	slidersAssetStore
} from '../sliders-assets/asset-store-context';
import {AdjustSlider} from './adjust-slider';
import {
	BackgroundSupport,
	backgroundSupport,
	BackgroundUnsupportedError,
	removeBackground
} from './background-engine';
import {EngineProgress} from './engine-types';
import {
	canvasBlob,
	CropRect,
	cropFromDrag,
	defaultEdits,
	drawCropOverlay,
	drawEdited,
	GAMMA_RANGE,
	ImageEdits,
	isUnedited,
	LEVEL_RANGE
} from './image-edits';
import './asset-editor.css';

/** Longest edge the live preview is drawn at. Full size is only used on save. */
const MAX_PREVIEW = 900;

export interface AssetEditorDialogProps extends DialogComponentProps {
	assetId: AssetId;
}

function megabytes(bytes: number): string {
	return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

export const AssetEditorDialog: React.FC<AssetEditorDialogProps> = props => {
	const {assetId} = props;
	const store = React.useMemo(() => slidersAssetStore(), []);
	const [background, setBackground] = React.useState<BackgroundSupport>();
	const cancel = React.useRef<AbortController>();
	const preview = React.useRef<HTMLCanvasElement>(null);
	const [dragFrom, setDragFrom] = React.useState<{x: number; y: number}>();
	const [edits, setEdits] = React.useState<ImageEdits>();
	const [error, setError] = React.useState<string>();
	const [lockAspect, setLockAspect] = React.useState(true);
	const [meta, setMeta] = React.useState<AssetMeta>();
	const [name, setName] = React.useState('');
	/** Kept so removing the background can be undone. */
	const [original, setOriginal] = React.useState<HTMLCanvasElement>();
	const [progress, setProgress] = React.useState<EngineProgress>();
	const [saving, setSaving] = React.useState(false);
	const [source, setSource] = React.useState<HTMLCanvasElement>();
	const {t} = useTranslation();

	// Whether this machine can cut backgrounds out at all. Asking costs a GPU
	// adapter request, so it happens once, here.

	React.useEffect(() => {
		let current = true;

		backgroundSupport().then(result => {
			if (current) {
				setBackground(result);
			}
		});

		return () => {
			current = false;
		};
	}, []);

	// Load the asset's pixels into a canvas we can work on.

	React.useEffect(() => {
		let current = true;

		async function load() {
			const [assetMeta, blob] = await Promise.all([
				store.meta(assetId),
				store.get(assetId)
			]);

			if (!current) {
				return;
			}

			if (!assetMeta || !blob) {
				setError(t('dialogs.assetEditor.loadError'));
				return;
			}

			// Editing an animation would flatten it to its first frame, so don't.

			if (assetMeta.animated) {
				setMeta(assetMeta);
				setError(t('dialogs.assetEditor.animatedError'));
				return;
			}

			const bitmap = await createImageBitmap(blob);
			const canvas = document.createElement('canvas');

			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
			bitmap.close?.();

			if (!current) {
				return;
			}

			setMeta(assetMeta);
			setName(`${assetMeta.name}-edit`);
			setOriginal(canvas);
			setSource(canvas);
			setEdits(defaultEdits(canvas.width, canvas.height));
		}

		load().catch(loadError => {
			console.error('Could not open this asset for editing', loadError);

			if (current) {
				setError(t('dialogs.assetEditor.loadError'));
			}
		});

		return () => {
			current = false;
		};
	}, [assetId, store, t]);

	// Redraw the preview whenever the source or the adjustments change. The crop
	// is drawn as an overlay instead, so that it stays possible to re-crop.

	React.useEffect(() => {
		const canvas = preview.current;

		if (!canvas || !source || !edits) {
			return;
		}

		const scale = Math.min(
			1,
			MAX_PREVIEW / Math.max(source.width, source.height)
		);

		drawEdited(
			source,
			{
				...edits,
				crop: {h: source.height, w: source.width, x: 0, y: 0},
				height: source.height,
				width: source.width
			},
			canvas,
			scale
		);

		if (edits.crop.w !== source.width || edits.crop.h !== source.height) {
			drawCropOverlay(
				canvas,
				edits.crop,
				scale,
				getComputedStyle(canvas).getPropertyValue('--blue').trim() || '#00a'
			);
		}
	}, [edits, source]);

	const busy = saving || progress !== undefined;
	const backgroundRemoved = source !== undefined && source !== original;

	function changeEdits(changes: Partial<ImageEdits>) {
		setEdits(current => (current ? {...current, ...changes} : current));
	}

	/** Cropping resets the output size--it's almost never what you still want. */
	function changeCrop(crop: CropRect) {
		changeEdits({crop, height: crop.h, width: crop.w});
	}

	function changeWidth(value: number) {
		if (!edits) {
			return;
		}

		const width = Math.max(1, Math.round(value || 1));

		changeEdits({
			height: lockAspect
				? Math.max(1, Math.round(width * (edits.crop.h / edits.crop.w)))
				: edits.height,
			width
		});
	}

	function changeHeight(value: number) {
		if (!edits) {
			return;
		}

		const height = Math.max(1, Math.round(value || 1));

		changeEdits({
			height,
			width: lockAspect
				? Math.max(1, Math.round(height * (edits.crop.w / edits.crop.h)))
				: edits.width
		});
	}

	function imagePoint(event: React.PointerEvent) {
		const canvas = preview.current;

		if (!canvas || !source) {
			return undefined;
		}

		const rect = canvas.getBoundingClientRect();

		return {
			x: ((event.clientX - rect.left) / rect.width) * source.width,
			y: ((event.clientY - rect.top) / rect.height) * source.height
		};
	}

	function handlePointerDown(event: React.PointerEvent) {
		const point = imagePoint(event);

		if (!point || busy) {
			return;
		}

		event.currentTarget.setPointerCapture(event.pointerId);
		setDragFrom(point);
	}

	function handlePointerMove(event: React.PointerEvent) {
		const point = imagePoint(event);

		if (!dragFrom || !point || !source) {
			return;
		}

		changeCrop(cropFromDrag(dragFrom, point, source.width, source.height));
	}

	function handlePointerUp() {
		if (!dragFrom || !source || !edits) {
			return;
		}

		setDragFrom(undefined);

		// A click rather than a drag means "never mind".

		if (edits.crop.w < 8 || edits.crop.h < 8) {
			resetCrop();
		}
	}

	function resetCrop() {
		if (source) {
			changeCrop({h: source.height, w: source.width, x: 0, y: 0});
		}
	}

	async function handleRemoveBackground() {
		if (!source) {
			return;
		}

		const controller = new AbortController();

		cancel.current = controller;
		setError(undefined);
		setProgress({stage: 'download'});

		try {
			setSource(
				await removeBackground(source, {
					onProgress: setProgress,
					signal: controller.signal
				})
			);
		} catch (removeError) {
			if ((removeError as Error)?.name === 'AbortError') {
				// The author asked for this; nothing to report.
			} else if (removeError instanceof BackgroundUnsupportedError) {
				setError(t(removeError.reasonKey));
			} else {
				console.error('Could not remove the background', removeError);
				setError(t('dialogs.assetEditor.backgroundError'));
			}
		} finally {
			cancel.current = undefined;
			setProgress(undefined);
		}
	}

	async function handleSave() {
		if (!source || !edits || !meta) {
			return;
		}

		setError(undefined);
		setSaving(true);

		try {
			const canvas = document.createElement('canvas');

			drawEdited(source, edits, canvas);

			// PNG, because the edit may have added transparency. The asset store
			// re-encodes it to WebP on the way in either way.
			const blob = await canvasBlob(canvas);
			const saveName = name.trim() || `${meta.name}-edit`;

			await store.putAsset(new File([blob], `${saveName}.png`, {type: 'image/png'}), {
				kind: meta.kind,
				name: saveName,
				sourceAsset: meta.id,
				tags: meta.tags
			});
			refreshAssetLibrary();
			props.onClose();
		} catch (saveError) {
			console.error('Could not save the edited asset', saveError);
			setError(t('dialogs.assetEditor.saveError'));
			setSaving(false);
		}
	}

	const cropped =
		source !== undefined &&
		edits !== undefined &&
		(edits.crop.w !== source.width || edits.crop.h !== source.height);

	return (
		<DialogCard
			{...props}
			className="asset-editor-dialog"
			headerLabel={t('dialogs.assetEditor.title', {name: meta?.name ?? ''})}
			maximizable
		>
			{error && (
				<p className="asset-editor-error" role="alert">
					{error}
				</p>
			)}
			{source && edits ? (
				<div className="asset-editor">
					<div className="asset-editor-stage">
						<div
							className="asset-editor-canvas"
							onPointerDown={handlePointerDown}
							onPointerMove={handlePointerMove}
							onPointerUp={handlePointerUp}
						>
							<canvas ref={preview} />
						</div>
						<p className="asset-editor-hint">
							{t('dialogs.assetEditor.cropHint')}
						</p>
					</div>
					<div className="asset-editor-controls">
						<section>
							<h3>{t('dialogs.assetEditor.adjust')}</h3>
							<AdjustSlider
								label={t('dialogs.assetEditor.brightness')}
								max={LEVEL_RANGE.max}
								min={LEVEL_RANGE.min}
								onChange={brightness => changeEdits({brightness})}
								resetLabel={t('dialogs.assetEditor.reset')}
								resetTo={0}
								step={LEVEL_RANGE.step}
								value={edits.brightness}
							/>
							<AdjustSlider
								label={t('dialogs.assetEditor.contrast')}
								max={LEVEL_RANGE.max}
								min={LEVEL_RANGE.min}
								onChange={contrast => changeEdits({contrast})}
								resetLabel={t('dialogs.assetEditor.reset')}
								resetTo={0}
								step={LEVEL_RANGE.step}
								value={edits.contrast}
							/>
							<AdjustSlider
								label={t('dialogs.assetEditor.gamma')}
								max={GAMMA_RANGE.max}
								min={GAMMA_RANGE.min}
								onChange={gamma => changeEdits({gamma})}
								resetLabel={t('dialogs.assetEditor.reset')}
								resetTo={1}
								step={GAMMA_RANGE.step}
								value={edits.gamma}
							/>
						</section>
						<section>
							<h3>{t('dialogs.assetEditor.crop')}</h3>
							<p className="asset-editor-detail">
								{t('dialogs.assetEditor.cropDetail', {
									height: edits.crop.h,
									width: edits.crop.w,
									x: edits.crop.x,
									y: edits.crop.y
								})}
							</p>
							<ButtonBar>
								<IconButton
									disabled={!cropped}
									icon={<IconCrop />}
									label={t('dialogs.assetEditor.resetCrop')}
									onClick={resetCrop}
								/>
							</ButtonBar>
						</section>
						<section>
							<h3>{t('dialogs.assetEditor.size')}</h3>
							<div className="asset-editor-size">
								<label className="asset-editor-number">
									<span>{t('dialogs.assetEditor.width')}</span>
									<input
										min={1}
										onChange={event => changeWidth(Number(event.target.value))}
										type="number"
										value={edits.width}
									/>
								</label>
								<label className="asset-editor-number">
									<span>{t('dialogs.assetEditor.height')}</span>
									<input
										min={1}
										onChange={event => changeHeight(Number(event.target.value))}
										type="number"
										value={edits.height}
									/>
								</label>
							</div>
							<ButtonBar>
								<CheckboxButton
									icon={<IconLink />}
									label={t('dialogs.assetEditor.lockAspect')}
									onChange={setLockAspect}
									value={lockAspect}
								/>
								<IconButton
									disabled={
										edits.width === edits.crop.w && edits.height === edits.crop.h
									}
									icon={<IconCrop />}
									label={t('dialogs.assetEditor.resetSize')}
									onClick={() =>
										changeEdits({height: edits.crop.h, width: edits.crop.w})
									}
								/>
							</ButtonBar>
						</section>
						<section>
							<h3>{t('dialogs.assetEditor.background')}</h3>
							<ButtonBar>
								<IconButton
									disabled={busy || backgroundRemoved || !background?.engine}
									icon={<IconWand />}
									label={t('dialogs.assetEditor.removeBackground')}
									onClick={handleRemoveBackground}
								/>
								{progress && (
									<IconButton
										icon={<IconX />}
										label={t('common.cancel')}
										onClick={() => cancel.current?.abort()}
									/>
								)}
								{backgroundRemoved && !progress && (
									<IconButton
										disabled={busy}
										icon={<IconEraser />}
										label={t('dialogs.assetEditor.restoreBackground')}
										onClick={() => setSource(original)}
									/>
								)}
							</ButtonBar>
							{progress ? (
								<p className="asset-editor-detail" role="status">
									{t(`dialogs.assetEditor.stage.${progress.stage}`, {
										percent: Math.round((progress.progress ?? 0) * 100)
									})}
								</p>
							) : (
								<p className="asset-editor-detail">
									{background?.engine
										? t('dialogs.assetEditor.engineNote', {
												license: background.engine.license,
												name: background.engine.label,
												resolution: background.engine.resolution,
												size: megabytes(background.engine.bytes)
										  })
										: background &&
										  t(
												background.support.reasonKey ??
													'dialogs.assetEditor.needsWebGpu'
										  )}
								</p>
							)}
						</section>
						<section>
							<h3>{t('dialogs.assetEditor.save')}</h3>
							<TextInput
								onChange={event => setName(event.target.value)}
								value={name}
							>
								{t('dialogs.assetEditor.name')}
							</TextInput>
							<p className="asset-editor-detail">
								{t('dialogs.assetEditor.saveNote', {
									height: edits.height,
									width: edits.width
								})}
							</p>
							<ButtonBar>
								<IconButton
									disabled={
										busy ||
										(!backgroundRemoved &&
											isUnedited(edits, source.width, source.height))
									}
									icon={<IconDeviceFloppy />}
									label={t('dialogs.assetEditor.saveAsNew')}
									onClick={handleSave}
									variant="create"
								/>
							</ButtonBar>
						</section>
					</div>
				</div>
			) : (
				!error && (
					<p className="sliders-empty">{t('dialogs.assetEditor.loading')}</p>
				)
			)}
		</DialogCard>
	);
};
