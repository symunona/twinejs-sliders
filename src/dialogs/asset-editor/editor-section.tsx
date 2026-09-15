import * as React from 'react';
import {NoteButton, NoteState} from './editor-note';

export interface EditorSectionProps {
	children: React.ReactNode;
	/** Shown to the right of the title, e.g. the crop's current rectangle. */
	detail?: React.ReactNode;
	icon: React.ReactNode;
	/**
	 * The section's explanatory note, revealed by an info icon in the header.
	 * Sections whose note belongs beside a button--Background--leave this out
	 * and place their own.
	 */
	note?: NoteState;
	title: string;
}

/**
 * One group of controls. The header is the only thing separating them, so it
 * carries the section's icon, its title, whatever single number sums the
 * section up, and the button that reveals its note.
 */
export const EditorSection: React.FC<EditorSectionProps> = props => {
	const {children, detail, icon, note, title} = props;

	return (
		<section className="asset-editor-section">
			<h3>
				<span className="asset-editor-section-icon">{icon}</span>
				<span className="asset-editor-section-title">{title}</span>
				{detail !== undefined && (
					<span className="asset-editor-section-detail">{detail}</span>
				)}
				{note && <NoteButton kind="info" label={title} note={note} />}
			</h3>
			{children}
		</section>
	);
};
