import {
	AssetMeta,
	CharacterPose,
	poseCover,
	poseHasSteps
} from '@sliders/scene-types';
import {
	IconEye,
	IconEyeOff,
	IconFileImport,
	IconPencil,
	IconPhotoEdit,
	IconRepeat,
	IconRepeatOff,
	IconTrash
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {PromptButton} from '../../components/control/prompt-button';
import {AssetPreview} from '../sliders-assets/asset-preview';
import {UploadButton} from '../sliders-assets/upload-button';

export interface PoseListProps {
	assets: Record<string, AssetMeta>;
	poses: Record<string, CharacterPose>;
	onAddFiles: (files: File[]) => void;
	onChangeLoop: (name: string, loop: boolean) => void;
	onDelete: (name: string) => void;
	onEdit: (name: string) => void;
	/** Opens Import set: many files, a folder or a sprite sheet into poses at once. */
	onImportSet: () => void;
	onRename: (name: string, newName: string) => void;
	onSelect: (name: string) => void;
	/** Turns a pose's ghost on and off. The selected pose is never a ghost. */
	onToggleGhost: (name: string) => void;
	selected?: string;
	/** Poses drawn faintly behind the selected one. */
	visible: string[];
}

export const PoseList: React.FC<PoseListProps> = props => {
	const {
		assets,
		poses,
		onAddFiles,
		onChangeLoop,
		onDelete,
		onEdit,
		onImportSet,
		onRename,
		onSelect,
		onToggleGhost,
		selected,
		visible
	} = props;
	const [renaming, setRenaming] = React.useState('');
	const {t} = useTranslation();

	return (
		<div className="pose-list">
			<h3>{t('dialogs.slidersCharacters.poses')}</h3>
			<UploadButton
				commandId="slidersCharacters.addPoses"
				commandScope="sliders-characters"
				label={t('dialogs.slidersCharacters.addPoses')}
				onUpload={onAddFiles}
			/>
			<IconButton
				icon={<IconFileImport />}
				label={t('dialogs.slidersCharacters.importSet.open')}
				onClick={onImportSet}
			/>
			<ul>
				{Object.entries(poses).map(([name, pose]) => {
					const cover = poseCover(pose);
					const meta = cover ? assets[cover] : undefined;
					// ⟳ means the pose plays by itself: an animated file, or steps.
					const animated = !!meta?.animated || poseHasSteps(pose);
					const looping = pose.loop !== false;
					const ghosted = visible.includes(name);

					return (
						<li
							className={classNames('pose-list-item', {
								ghosted: ghosted && name !== selected,
								selected: name === selected
							})}
							data-pose={name}
							key={name}
						>
							{/* The picture fills the tile and wears its own name: at this size the
							    art tells two poses apart faster than the words do. */}
							<button
								className="pose-list-select"
								onClick={() => onSelect(name)}
								type="button"
							>
								<AssetPreview alt={name} assetId={cover} />
								<span className="pose-list-name">{name}</span>
								{poseHasSteps(pose) && (
									<span className="pose-list-steps">{pose.steps!.length}</span>
								)}
								{animated && (
									<span
										className="pose-list-animated"
										title={t('dialogs.slidersAssets.animated')}
									>
										⟳
									</span>
								)}
							</button>
							{/* One row, never two: the buttons are shrunk in CSS so the widest
							    set--ghost, edit, rename, loop, delete--still fits the column. */}
							<ButtonBar>
								{/* The selected pose is already on screen in full, so it has
								    nothing to show or hide. */}
								{name !== selected && (
									<IconButton
										ariaChecked={ghosted}
										icon={ghosted ? <IconEye /> : <IconEyeOff />}
										iconOnly
										label={
											ghosted
												? t('dialogs.slidersCharacters.hidePose', {name})
												: t('dialogs.slidersCharacters.showPose', {name})
										}
										onClick={() => onToggleGhost(name)}
										role="checkbox"
									/>
								)}
								<IconButton
									// Editing an animation would flatten it to one image, and a
									// pose with steps has no one image to edit.
									disabled={animated}
									icon={<IconPhotoEdit />}
									iconOnly
									label={
										animated
											? t('dialogs.slidersAssets.editImageAnimated')
											: t('dialogs.slidersAssets.editImage')
									}
									onClick={() => onEdit(name)}
								/>
								<PromptButton
									icon={<IconPencil />}
									iconOnly
									label={t('dialogs.slidersCharacters.renamePose')}
									onChange={event => setRenaming(event.target.value)}
									onSubmit={value => onRename(name, value)}
									prompt={t('dialogs.slidersCharacters.renamePosePrompt')}
									value={renaming}
								/>
								{animated && (
									<IconButton
										ariaChecked={looping}
										icon={looping ? <IconRepeat /> : <IconRepeatOff />}
										iconOnly
										label={
											looping
												? t('dialogs.slidersCharacters.loops')
												: t('dialogs.slidersCharacters.playsOnce')
										}
										onClick={() => onChangeLoop(name, !looping)}
										role="checkbox"
									/>
								)}
								<ConfirmButton
									confirmVariant="danger"
									icon={<IconTrash />}
									iconOnly
									label={t('dialogs.slidersCharacters.deletePose')}
									onConfirm={() => onDelete(name)}
									prompt={t('dialogs.slidersCharacters.deletePosePrompt', {
										name
									})}
								/>
							</ButtonBar>
						</li>
					);
				})}
			</ul>
		</div>
	);
};
