import {IconPackage} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {FileInput} from '../../components/control/file-input';
import {Story} from '../../store/stories';
import {importStories} from '../../util/import';
import {storyFromTwee} from '../../util/twee';
import {UploadButton} from '../sliders-assets/upload-button';

export interface FileChooserProps {
	onChange: (file: File, stories: Story[]) => void;
	/** A `.sliders.zip`, which carries assets and so has its own flow. */
	onChooseBundle: (file: File) => void;
}

export const FileChooser: React.FC<FileChooserProps> = props => {
	const {onChange, onChooseBundle} = props;
	const {t} = useTranslation();

	function handleChange(file: File, data: string) {
		if (/\.html$/.test(file.name)) {
			onChange(file, importStories(data));
		} else {
			onChange(file, [storyFromTwee(data)]);
		}
	}

	return (
		<div className="file-chooser">
			<p>
				<FileInput
					accept=".html,.twee,.tw"
					onChange={handleChange}
					orientation="vertical"
				>
					{t('dialogs.storyImport.filePrompt')}
				</FileInput>
			</p>
			<p>
				{/*
				  A bundle is binary, and FileInput only reads text. It also needs no reading
				  here at all — the zip reader takes the File itself.
				*/}
				{t('dialogs.storyImport.bundlePrompt')}{' '}
				<UploadButton
					accept=".zip"
					icon={<IconPackage />}
					label={t('dialogs.storyImport.bundleButton')}
					multiple={false}
					onUpload={files => onChooseBundle(files[0])}
					variant="primary"
				/>
			</p>
		</div>
	);
};
