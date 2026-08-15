import * as React from 'react';
import {fakeStory} from '../../../test-util';
import {FileChooserProps} from '../file-chooser';

const mockFile = new File([''], 'mock-file.html');
const mockBundle = new File([''], 'mock-file.sliders.zip');
const mockStory = fakeStory();

mockStory.name = 'mock-story';

export const FileChooser: React.FC<FileChooserProps> = ({
	onChange,
	onChooseBundle
}) => (
	<div data-testid="mock-file-chooser">
		<button onClick={() => onChange(mockFile, [mockStory])}>onChange</button>
		<button onClick={() => onChange(mockFile, [])}>onChange no story</button>
		<button onClick={() => onChooseBundle(mockBundle)}>onChooseBundle</button>
	</div>
);
