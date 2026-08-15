import {IconUpload} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../components/control/icon-button';

export interface UploadButtonProps {
	label: string;
	onUpload: (files: File[]) => void;
}

/**
 * The existing FileInput reads files as text, which is no use for image bytes. This wraps
 * a plain file input instead, so the button still looks like every other one.
 */
export const UploadButton: React.FC<UploadButtonProps> = props => {
	const {label, onUpload} = props;
	const input = React.useRef<HTMLInputElement>(null);

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
				onClick={() => input.current?.click()}
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
