import {IconAlertTriangle, IconInfoCircle} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';

export type NoteKind = 'info' | 'warning';

export interface NoteState {
	open: boolean;
	toggle: () => void;
}

/**
 * The open/closed state of one explanatory note. Notes are collapsed by default:
 * the editor has more prose in it than controls, and all of it is background
 * reading--true the first time someone opens the dialog, noise every time after.
 */
export function useNote(): NoteState {
	const [open, setOpen] = React.useState(false);

	return {
		open,
		toggle: React.useCallback(() => setOpen(value => !value), [])
	};
}

export interface NoteButtonProps {
	kind: NoteKind;
	/** What the note is about, for the button's tooltip. */
	label: string;
	note: NoteState;
}

/**
 * The icon that reveals a note. Deliberately not an `IconButton`: these sit
 * inside section headers and button bars as a marker, not as another thing to
 * do, and the control-height chrome of a real button would read as one.
 */
export const NoteButton: React.FC<NoteButtonProps> = ({kind, label, note}) => {
	const {t} = useTranslation();

	return (
		<button
			aria-expanded={note.open}
			aria-label={t(
				note.open
					? 'dialogs.assetEditor.hideNote'
					: 'dialogs.assetEditor.showNote',
				{about: label}
			)}
			className={classNames('asset-editor-note-button', kind, {
				open: note.open
			})}
			onClick={note.toggle}
			title={t(
				note.open
					? 'dialogs.assetEditor.hideNote'
					: 'dialogs.assetEditor.showNote',
				{about: label}
			)}
			type="button"
		>
			{kind === 'warning' ? <IconAlertTriangle /> : <IconInfoCircle />}
		</button>
	);
};

export interface NoteBodyProps {
	children: React.ReactNode;
	kind: NoteKind;
	note: NoteState;
}

/**
 * The note itself, shown below whatever its button sits in. No background: the
 * icon already says which kind of note this is, and a coloured box for every
 * paragraph of explanation was most of why this dialog looked loud.
 */
export const NoteBody: React.FC<NoteBodyProps> = ({children, kind, note}) => {
	if (!note.open) {
		return null;
	}

	return (
		<p
			className={classNames('asset-editor-note-body', kind)}
			role={kind === 'warning' ? 'status' : undefined}
		>
			{children}
		</p>
	);
};
