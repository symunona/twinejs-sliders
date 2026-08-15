import {IconUpload} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../components/control/icon-button';
import {useCommand} from '../../hotkeys';

export interface UploadButtonProps {
	/**
	 * Command this button publishes, if any. The button owns the hidden file
	 * input, so opening the picker has to happen in here.
	 */
	commandId?: string;
	commandScope?: string;
	label: string;
	onUpload: (files: File[]) => void;
}

/**
 * The existing FileInput reads files as text, which is no use for image bytes. This wraps
 * a plain file input instead, so the button still looks like every other one.
 */
export const UploadButton: React.FC<UploadButtonProps> = props => {
	const {commandId, commandScope, label, onUpload} = props;
	const input = React.useRef<HTMLInputElement>(null);

	const openPicker = React.useCallback(() => input.current?.click(), []);

	useCommand({
		// A command with no ID can't be dispatched, so a null scope parks it.
		id: commandId ?? '',
		label,
		run: openPicker,
		scope: commandId ? commandScope : null
	});

	function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
		const files = Array.from(event.target.files ?? []);

		if (files.length > 0) {
			onUpload(files);
		}

		// Allow the same file to be chosen twice in a row.
		event.target.value = '';
	}

	return (
		<span className="upload-button">
			<IconButton
				icon={<IconUpload />}
				label={label}
				onClick={openPicker}
				variant="create"
			/>
			<input
				accept="image/*"
				aria-label={label}
				multiple
				onChange={handleChange}
				ref={input}
				type="file"
			/>
		</span>
	);
};
