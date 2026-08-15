import {AssetMeta, CharacterFrame} from '@sliders/scene-types';
import {
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
import {UploadDropZone} from '../sliders-assets/upload-drop-zone';

export interface FrameListProps {
	assets: Record<string, AssetMeta>;
	frames: Record<string, CharacterFrame>;
	onAddFiles: (files: File[]) => void;
	onChangeLoop: (name: string, loop: boolean) => void;
	onDelete: (name: string) => void;
	onEdit: (name: string) => void;
	onRename: (name: string, newName: string) => void;
	onSelect: (name: string) => void;
	selected?: string;
}

export const FrameList: React.FC<FrameListProps> = props => {
	const {
		assets,
		frames,
		onAddFiles,
		onChangeLoop,
		onDelete,
		onEdit,
		onRename,
		onSelect,
		selected
	} = props;
	const [renaming, setRenaming] = React.useState('');
	const {t} = useTranslation();

	return (
		<div className="frame-list">
			<h3>{t('dialogs.slidersCharacters.frames')}</h3>
			<UploadButton
				commandId="slidersCharacters.addFrames"
				commandScope="sliders-characters"
				label={t('dialogs.slidersCharacters.addFrames')}
				onUpload={onAddFiles}
			/>
			<UploadDropZone
				label={t('dialogs.slidersCharacters.dropFrames')}
				onDrop={onAddFiles}
			>
				<ul>
					{Object.entries(frames).map(([name, frame]) => {
						const meta = assets[frame.asset];
						const looping = frame.loop !== false;

						return (
							<li
								className={classNames('frame-list-item', {
									selected: name === selected
								})}
								data-frame={name}
								key={name}
							>
								<button
									className="frame-list-select"
									onClick={() => onSelect(name)}
									type="button"
								>
									<AssetPreview alt={name} assetId={frame.asset} />
									<span className="frame-list-name">{name}</span>
									{meta?.animated && (
										<span
											className="frame-list-animated"
											title={t('dialogs.slidersAssets.animated')}
										>
											⟳
										</span>
									)}
								</button>
								<ButtonBar>
									<IconButton
										// Editing an animation would flatten it to one frame.
										disabled={meta?.animated}
										icon={<IconPhotoEdit />}
										iconOnly
										label={
											meta?.animated
												? t('dialogs.slidersAssets.editImageAnimated')
												: t('dialogs.slidersAssets.editImage')
										}
										onClick={() => onEdit(name)}
									/>
									<PromptButton
										icon={<IconPencil />}
										iconOnly
										label={t('dialogs.slidersCharacters.renameFrame')}
										onChange={event => setRenaming(event.target.value)}
										onSubmit={value => onRename(name, value)}
										prompt={t('dialogs.slidersCharacters.renameFramePrompt')}
										value={renaming}
									/>
									{meta?.animated && (
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
										label={t('dialogs.slidersCharacters.deleteFrame')}
										onConfirm={() => onDelete(name)}
										prompt={t('dialogs.slidersCharacters.deleteFramePrompt', {
											name
										})}
									/>
								</ButtonBar>
							</li>
						);
					})}
				</ul>
			</UploadDropZone>
		</div>
	);
};
