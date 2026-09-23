import {CharacterPose, DEFAULT_STEP_SECONDS} from '@sliders/scene-types';
import {
	IconArrowLeft,
	IconArrowRight,
	IconPlayerPlay,
	IconTrash
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';
import {AssetPreview} from '../sliders-assets/asset-preview';
import {UploadButton} from '../sliders-assets/upload-button';
import {fpsForDur} from './import-set-logic';
import {
	moveStep,
	removeStep,
	setPoseFps,
	setStepDur,
	stepsOf
} from './pose-steps';

/** Carries a step index between thumbnails. Not `Files`, so the drop zones ignore it. */
const STEP_DRAG_TYPE = 'application/x-sliders-step';

export interface StepStripProps {
	name: string;
	pose: CharacterPose;
	/** Which step the preview is drawing right now, selected or playing. */
	shown?: number;
	/** Undefined = the pose plays. */
	selected?: number;
	onAddFiles: (files: File[]) => void;
	onChange: (pose: CharacterPose) => void;
	/** Written out at once — reorder, delete. Timing waits for the usual debounce. */
	onCommit: () => void;
	onSelect: (index: number | undefined) => void;
}

/**
 * The selected pose's images in order. Reorder, time, delete, add. A still shows as a
 * strip of one: dropping more images on it is how a still becomes a pose with steps.
 */
export const StepStrip: React.FC<StepStripProps> = props => {
	const {
		name,
		onAddFiles,
		onChange,
		onCommit,
		onSelect,
		pose,
		selected,
		shown
	} = props;
	const [dragOver, setDragOver] = React.useState(false);
	const {t} = useTranslation();
	const steps = stepsOf(pose);
	const hasSteps = steps.length > 1;
	const step = selected !== undefined ? steps[selected] : undefined;

	function move(from: number, to: number) {
		onChange(moveStep(pose, from, to));
		onSelect(to);
		onCommit();
	}

	function remove(index: number) {
		onChange(removeStep(pose, index));
		onSelect(steps.length > 2 ? Math.min(index, steps.length - 2) : undefined);
		onCommit();
	}

	// Files add steps; a step's own drag reorders. Both stop here, so the editor's big
	// drop zone does not also make a pose out of the same files.
	function handleDragOver(event: React.DragEvent) {
		const types = Array.from(event.dataTransfer.types);

		if (!types.includes('Files') && !types.includes(STEP_DRAG_TYPE)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
		setDragOver(true);
	}

	function handleDrop(event: React.DragEvent, at?: number) {
		const types = Array.from(event.dataTransfer.types);

		if (!types.includes('Files') && !types.includes(STEP_DRAG_TYPE)) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		setDragOver(false);

		if (types.includes('Files')) {
			const files = Array.from(event.dataTransfer.files);

			if (files.length > 0) {
				onAddFiles(files);
			}

			return;
		}

		const from = parseInt(event.dataTransfer.getData(STEP_DRAG_TYPE), 10);

		if (Number.isFinite(from) && at !== undefined) {
			move(from, at);
		}
	}

	return (
		<div
			className={classNames('step-strip', {'drag-over': dragOver})}
			data-pose={name}
			onDragLeave={event => {
				const to = event.relatedTarget as Node | null;

				if (!to?.nodeType || !event.currentTarget.contains(to)) {
					setDragOver(false);
				}
			}}
			onDragOver={handleDragOver}
			onDrop={event => handleDrop(event)}
		>
			<div className="step-strip-header">
				<span className="step-strip-title">
					{t('dialogs.slidersCharacters.steps.title', {count: steps.length})}
				</span>
				{hasSteps && (
					<>
						<IconButton
							disabled={selected === undefined}
							icon={<IconPlayerPlay />}
							label={t('dialogs.slidersCharacters.steps.play')}
							onClick={() => onSelect(undefined)}
						/>
						<label className="step-strip-field">
							{t('dialogs.slidersCharacters.steps.fps')}
							<input
								min={1}
								max={60}
								onChange={event => {
									const fps = parseFloat(event.target.value);

									if (fps > 0) {
										onChange(setPoseFps(pose, fps));
									}
								}}
								step={1}
								type="number"
								value={fpsForDur(steps[0]?.dur)}
							/>
						</label>
					</>
				)}
				<UploadButton
					label={t('dialogs.slidersCharacters.steps.add')}
					onUpload={onAddFiles}
					variant="primary"
				/>
			</div>
			<ol className="step-strip-list">
				{steps.map((item, index) => (
					<li
						className={classNames('step-strip-item', {
							selected: index === selected,
							shown: index === shown
						})}
						data-step={index}
						draggable={hasSteps}
						key={`${index}:${item.asset}`}
						onDragStart={event => {
							event.dataTransfer.setData(STEP_DRAG_TYPE, String(index));
							event.dataTransfer.effectAllowed = 'move';
						}}
						onDrop={event => handleDrop(event, index)}
					>
						<button
							aria-label={t('dialogs.slidersCharacters.steps.select', {
								index: index + 1
							})}
							aria-pressed={index === selected}
							className="step-strip-select"
							onClick={() =>
								onSelect(index === selected || !hasSteps ? undefined : index)
							}
							type="button"
						>
							<AssetPreview alt="" assetId={item.asset} />
							<span className="step-strip-index">{index + 1}</span>
							{hasSteps && (
								<span className="step-strip-dur">
									{(item.dur ?? DEFAULT_STEP_SECONDS).toFixed(2)}s
								</span>
							)}
							{item.fit && <span
									className="step-strip-fit"
									title={t('dialogs.slidersCharacters.steps.hasFit')}
								>
									✥
								</span>}
						</button>
					</li>
				))}
			</ol>
			{!hasSteps && (
				<p className="character-editor-note">
					{t('dialogs.slidersCharacters.steps.stillNote')}
				</p>
			)}
			{hasSteps && step && selected !== undefined && (
				<div className="step-strip-controls">
					<ButtonBar>
						<IconButton
							disabled={selected === 0}
							icon={<IconArrowLeft />}
							iconOnly
							label={t('dialogs.slidersCharacters.steps.moveEarlier')}
							onClick={() => move(selected, selected - 1)}
						/>
						<IconButton
							disabled={selected === steps.length - 1}
							icon={<IconArrowRight />}
							iconOnly
							label={t('dialogs.slidersCharacters.steps.moveLater')}
							onClick={() => move(selected, selected + 1)}
						/>
						<IconButton
							icon={<IconTrash />}
							iconOnly
							label={t('dialogs.slidersCharacters.steps.remove')}
							onClick={() => remove(selected)}
							variant="danger"
						/>
					</ButtonBar>
					<label className="step-strip-field">
						{t('dialogs.slidersCharacters.steps.dur')}
						<input
							min={0.01}
							onChange={event => {
								const dur = parseFloat(event.target.value);

								onChange(
									setStepDur(
										pose,
										selected,
										dur > 0 && dur !== DEFAULT_STEP_SECONDS ? dur : undefined
									)
								);
							}}
							step={0.01}
							type="number"
							value={step.dur ?? DEFAULT_STEP_SECONDS}
						/>
					</label>
					<span className="character-editor-note">
						{t('dialogs.slidersCharacters.steps.onionNote')}
					</span>
				</div>
			)}
		</div>
	);
};
