import {AssetId, AssetMeta} from '@sliders/scene-types';
import classNames from 'classnames';
import {
	IconArrowsExchange,
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
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {TextInput} from '../../components/control/text-input';
import {useCommand} from '../../hotkeys';
import {DialogComponentProps} from '../dialogs.types';
import {
	refreshAssetLibrary,
	slidersAssetStore
} from '../sliders-assets/asset-store-context';
import {AdjustSlider} from './adjust-slider';
import {
	applyTuning,
	BackgroundSupport,
	backgroundSupport,
	BackgroundTimeoutError,
	BackgroundUnsupportedError,
	CutoutTuning,
	DEFAULT_TUNING,
	removeBackground
} from './background-engine';
import {
	BackgroundOnCpuError,
	EngineProgress,
	keepStorage,
	webGpuDescription
} from './engine-types';
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

/** Which of the four steps a stage is, so the wait has a shape. */
const STAGE_STEPS: Record<EngineProgress['stage'], number> = {
	download: 1,
	refine: 4,
	run: 3,
	start: 2
};

const STAGE_COUNT = 4;

/** Past this, a wait needs explaining rather than just spinning. */
const SLOW_SECONDS = 12;

function elapsedLabel(seconds: number): string {
	if (seconds < 60) {
		return `${seconds}s`;
	}

	return `${Math.floor(seconds / 60)}m ${`${seconds % 60}`.padStart(2, '0')}s`;
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
	/** The cutout's alpha, kept so the tuning sliders don't re-run the model. */
	const [alpha, setAlpha] = React.useState<Float32Array>();
	const [tuning, setTuning] = React.useState<CutoutTuning>(DEFAULT_TUNING);
	const [elapsed, setElapsed] = React.useState(0);
	const [progress, setProgress] = React.useState<EngineProgress>();
	const [replaceOpen, setReplaceOpen] = React.useState(false);
	const [saving, setSaving] = React.useState(false);
	/** Every asset's id and name, to spot a name clash before saving. */
	const [library, setLibrary] = React.useState<{id: string; name: string}[]>([]);
	const [source, setSource] = React.useState<HTMLCanvasElement>();
	const {t} = useTranslation();

	// A cutout can take a while--first run compiles shaders, and the model runs
	// twice. A ticking clock is the difference between "working" and "hung".

	const running = progress !== undefined;

	React.useEffect(() => {
		if (!running) {
			setElapsed(0);
			return;
		}

		const startedAt = Date.now();
		const timer = window.setInterval(
			() => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
			500
		);

		return () => window.clearInterval(timer);
		// Keyed off whether a run is happening at all, not off the stage:
		// restarting the clock at every stage change would defeat the point.
	}, [running]);

	// Whether this machine can cut backgrounds out at all. Asking costs a GPU
	// adapter request, so it happens once, here.

	React.useEffect(() => {
		let current = true;

		backgroundSupport().then(result => {
			if (current) {
				setBackground(result);
			}

			// The weights are 168 MB of otherwise-evictable storage, and losing
			// them means downloading them again.
			if (result.engine) {
				keepStorage();
			}
		});

		return () => {
			current = false;
		};
	}, []);

	React.useEffect(() => {
		let current = true;

		store.list({includeFrames: true}).then(assets => {
			if (current) {
				setLibrary(assets.map(asset => ({id: asset.id, name: asset.name})));
			}
		});

		return () => {
			current = false;
		};
	}, [store]);

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

	/**
	 * Re-applies the tuning without touching the model: the alpha is already
	 * computed, so this is one composite over the original pixels.
	 */
	function retune(next: CutoutTuning) {
		setTuning(next);

		if (alpha && original) {
			setSource(applyTuning(original, alpha, next));
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
			const cutout = await removeBackground(source, {
				onProgress: setProgress,
				signal: controller.signal,
				tuning
			});

			setAlpha(cutout.alpha);
			setSource(cutout.canvas);
		} catch (removeError) {
			const failure = removeError as Error;

			// Anything that isn't a deliberate cancel gets logged with the
			// adapter, because "which GPU" is the first question every one of
			// these raises.
			if (failure?.name !== 'AbortError') {
				console.error(
					`Could not remove the background (WebGPU: ${
						webGpuDescription() ?? 'unknown'
					})`,
					removeError
				);
			}

			if (failure?.name === 'AbortError') {
				// The author asked for this; nothing to report.
			} else if (removeError instanceof BackgroundUnsupportedError) {
				setError(t(removeError.reasonKey));
			} else if (removeError instanceof BackgroundOnCpuError) {
				setError(
					t('dialogs.assetEditor.onCpuError', {
						gpu: removeError.gpu ?? t('dialogs.assetEditor.unknownGpu'),
						seconds: removeError.seconds
					})
				);
			} else if (removeError instanceof BackgroundTimeoutError) {
				setError(
					t('dialogs.assetEditor.timeoutError', {
						gpu: webGpuDescription() ?? t('dialogs.assetEditor.unknownGpu'),
						seconds: removeError.seconds,
						stage: t(`dialogs.assetEditor.stage.${removeError.stage}`, {
							percent: 100
						})
					})
				);
			} else {
				setError(
					t('dialogs.assetEditor.backgroundError', {
						message: failure?.message ?? String(removeError)
					})
				);
			}
		} finally {
			cancel.current = undefined;
			setProgress(undefined);
		}
	}

	/** The edited pixels, as a file the asset store will take. */
	async function editedFile(fileName: string) {
		const canvas = document.createElement('canvas');

		drawEdited(source!, edits!, canvas);

		// PNG, because the edit may have added transparency. The asset store
		// re-encodes it to WebP on the way in either way.
		const blob = await canvasBlob(canvas);

		return new File([blob], `${fileName}.png`, {type: 'image/png'});
	}

	/** Writes the edit back over the asset it came from, keeping its id. */
	async function handleReplace() {
		if (!source || !edits || !meta) {
			return;
		}

		setError(undefined);
		setSaving(true);

		try {
			await store.replace(meta.id, await editedFile(meta.name));
			refreshAssetLibrary();
			props.onClose();
		} catch (saveError) {
			console.error('Could not overwrite the asset', saveError);
			setError(t('dialogs.assetEditor.saveError'));
			setSaving(false);
		}
	}

	async function handleSave() {
		if (!source || !edits || !meta) {
			return;
		}

		setError(undefined);
		setSaving(true);

		try {
			const saveName = name.trim() || `${meta.name}-edit`;

			await store.putAsset(await editedFile(saveName), {
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

	// Names are how scenes refer to assets--`bg: tavern-night`--so two assets
	// sharing one is ambiguous in a way two ids never are.
	const trimmedName = name.trim().toLowerCase();
	const clash = library.find(
		asset => asset.name.toLowerCase() === trimmedName && trimmedName !== ''
	);

	const cropped =
		source !== undefined &&
		edits !== undefined &&
		(edits.crop.w !== source.width || edits.crop.h !== source.height);

	// Nothing to write yet if the image is untouched, which is the same test
	// the two save buttons make.
	const saveDisabled =
		busy ||
		!source ||
		!edits ||
		(!backgroundRemoved && isUnedited(edits, source.width, source.height));

	useCommand({
		enabled: !busy && !backgroundRemoved && !!background?.engine,
		id: 'assetEditor.removeBackground',
		label: t('hotkeys.commands.assetEditor.removeBackground'),
		run: handleRemoveBackground,
		scope: 'asset-editor'
	});

	useCommand({
		enabled: backgroundRemoved && !progress,
		id: 'assetEditor.restoreBackground',
		label: t('hotkeys.commands.assetEditor.restoreBackground'),
		run: () => {
			setAlpha(undefined);
			setSource(original);
		},
		scope: 'asset-editor'
	});

	useCommand({
		enabled: cropped,
		id: 'assetEditor.resetCrop',
		label: t('hotkeys.commands.assetEditor.resetCrop'),
		run: resetCrop,
		scope: 'asset-editor'
	});

	// Both saves are chords, and allowed in inputs, because the name field is
	// where focus normally is by the time either is wanted.

	useCommand({
		allowInInput: true,
		enabled: !saveDisabled,
		id: 'assetEditor.saveAsNew',
		label: t('hotkeys.commands.assetEditor.saveAsNew'),
		run: handleSave,
		scope: 'asset-editor'
	});

	useCommand({
		allowInInput: true,
		enabled: !saveDisabled,
		id: 'assetEditor.replace',
		label: t('hotkeys.commands.assetEditor.replace'),
		run: () => setReplaceOpen(true),
		scope: 'asset-editor'
	});

	return (
		<DialogCard
			{...props}
			className="asset-editor-dialog"
			focusOnOpen
			headerLabel={t('dialogs.assetEditor.title', {name: meta?.name ?? ''})}
			hotkeyScope="asset-editor"
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
										onClick={() => {
											setAlpha(undefined);
											setSource(original);
										}}
									/>
								)}
							</ButtonBar>
							{alpha && !progress && (
								<>
									<AdjustSlider
										label={t('dialogs.assetEditor.threshold')}
										max={0.95}
										min={0.05}
										onChange={threshold => retune({...tuning, threshold})}
										resetLabel={t('dialogs.assetEditor.reset')}
										resetTo={DEFAULT_TUNING.threshold}
										step={0.01}
										value={tuning.threshold}
									/>
									<AdjustSlider
										label={t('dialogs.assetEditor.softness')}
										max={1}
										min={0.02}
										onChange={softness => retune({...tuning, softness})}
										resetLabel={t('dialogs.assetEditor.reset')}
										resetTo={DEFAULT_TUNING.softness}
										step={0.02}
										value={tuning.softness}
									/>
									<p className="asset-editor-detail">
										{t('dialogs.assetEditor.tuningNote')}
									</p>
								</>
							)}
							{progress ? (
								<div className="asset-editor-progress" aria-busy>
									<div
										className={classNames('asset-editor-progress-track', {
											indeterminate: progress.progress === undefined
										})}
									>
										<div
											className="asset-editor-progress-bar"
											style={
												progress.progress === undefined
													? undefined
													: {width: `${Math.round(progress.progress * 100)}%`}
											}
										/>
									</div>
									<p className="asset-editor-detail" role="status">
										<span className="asset-editor-step">
											{t('dialogs.assetEditor.step', {
												step: STAGE_STEPS[progress.stage],
												steps: STAGE_COUNT
											})}
										</span>{' '}
										{t(
											progress.pass === 2 && progress.stage === 'run'
												? 'dialogs.assetEditor.stage.runCloser'
												: `dialogs.assetEditor.stage.${progress.stage}`,
											{percent: Math.round((progress.progress ?? 0) * 100)}
										)}{' '}
										<span className="asset-editor-elapsed">
											{elapsedLabel(elapsed)}
										</span>
									</p>
									{elapsed >= SLOW_SECONDS && (
										<p className="asset-editor-detail">
											{t('dialogs.assetEditor.slowNote')}
										</p>
									)}
								</div>
							) : (
								<p className="asset-editor-detail">
									{background?.engine
										? t('dialogs.assetEditor.engineNote', {
												gpu:
													webGpuDescription() ??
													t('dialogs.assetEditor.unknownGpu'),
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
							{clash && (
								<p className="asset-editor-warning" role="status">
									{t(
										clash.id === meta?.id
											? 'dialogs.assetEditor.clashesWithSelf'
											: 'dialogs.assetEditor.clashesWithOther',
										{name: clash.name}
									)}
								</p>
							)}
							<ButtonBar>
								<IconButton
									disabled={saveDisabled}
									icon={<IconDeviceFloppy />}
									label={t('dialogs.assetEditor.saveAsNew')}
									onClick={handleSave}
									variant="create"
								/>
								<ConfirmButton
									confirmVariant="danger"
									disabled={saveDisabled}
									icon={<IconArrowsExchange />}
									label={t('dialogs.assetEditor.replace')}
									onChangeOpen={setReplaceOpen}
									onConfirm={handleReplace}
									open={replaceOpen}
									prompt={t('dialogs.assetEditor.replacePrompt', {
										name: meta?.name ?? ''
									})}
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
