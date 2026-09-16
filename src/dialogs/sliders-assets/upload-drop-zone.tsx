import classNames from 'classnames';
import * as React from 'react';

export interface UploadDropZoneProps {
	/**
	 * Draws the hint over the zone while a drag is in flight, instead of as a line of text
	 * under its contents. Use it wherever the zone is tall or scrolls: a hint that follows
	 * a long list is below the fold exactly when someone needs to see it.
	 */
	floatingHint?: boolean;
	label: string;
	onDrop: (files: File[]) => void;
}

/**
 * Files only. Tiles inside a zone are themselves draggable, and dragging one across the
 * zone it lives in must not look like it can be dropped there.
 */
function draggingFiles(event: React.DragEvent) {
	return Array.from(event.dataTransfer.types).includes('Files');
}

/** Dropping files onto a tab uploads into that kind (spec 03). */
export const UploadDropZone: React.FC<UploadDropZoneProps> = props => {
	const {children, floatingHint, label, onDrop} = props;
	const [over, setOver] = React.useState(false);

	function handleDragOver(event: React.DragEvent) {
		if (!draggingFiles(event)) {
			return;
		}

		// Without this, the browser navigates to the dropped file--and takes the whole app
		// with it.
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		setOver(true);
	}

	function handleDragLeave(event: React.DragEvent) {
		// Moving onto a child fires dragleave on whatever the pointer left, so without this
		// the highlight blinks off over every tile crossed on the way in.
		const to = event.relatedTarget as Node | null;

		if (to?.nodeType && event.currentTarget.contains(to)) {
			return;
		}

		setOver(false);
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
			className={classNames('upload-drop-zone', {
				'drag-over': over,
				'floating-hint': floatingHint
			})}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
		>
			{children}
			<div className="upload-drop-zone-hint">{label}</div>
		</div>
	);
};
