import classNames from 'classnames';
import * as React from 'react';

export interface UploadDropZoneProps {
	label: string;
	onDrop: (files: File[]) => void;
}

/** Dropping files onto a tab uploads into that kind (spec 03). */
export const UploadDropZone: React.FC<UploadDropZoneProps> = props => {
	const {children, label, onDrop} = props;
	const [over, setOver] = React.useState(false);

	function handleDragOver(event: React.DragEvent) {
		// Without this, the browser navigates to the dropped file.
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		setOver(true);
	}

	function handleDrop(event: React.DragEvent) {
		event.preventDefault();
		setOver(false);

		const files = Array.from(event.dataTransfer.files);

		if (files.length > 0) {
			onDrop(files);
		}
	}

	return (
		<div
			aria-label={label}
			className={classNames('upload-drop-zone', {'drag-over': over})}
			onDragLeave={() => setOver(false)}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
		>
			{children}
			<div className="upload-drop-zone-hint">{label}</div>
		</div>
	);
};
