import {IconMoodSmile, IconPhoto, IconShape, IconX} from '@tabler/icons';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {isTextEntry} from '../../hotkeys';
import './paste-image.css';

/**
 * What a pasted image becomes. No pose: a pose needs an owner picked out of the cast, and
 * that is the stage drop menu's job -- a paste is "new art", one question, three answers.
 */
export type PasteKind = 'bg' | 'object' | 'character';

/**
 * A clipboard image has no name worth keeping: the browser calls every one of them
 * `image.png`. Renamed so the upload mints `pasted`, `pasted-2`, ... and the rename box
 * that opens next has something obviously provisional in it.
 */
export const PASTED_NAME = 'pasted';

/** The image files on a paste, renamed. Empty when the clipboard holds no picture. */
export function clipboardImages(data: DataTransfer | null): File[] {
	return Array.from(data?.files ?? [])
		.filter(file => file.type.startsWith('image/'))
		.map(file => {
			const extension = file.type.split('/')[1]?.split('+')[0] || 'png';

			return new File([file], `${PASTED_NAME}.${extension}`, {
				lastModified: file.lastModified,
				type: file.type
			});
		});
}

/**
 * Ctrl+V with a picture on the clipboard, while focus is somewhere `owns` claims.
 *
 * A `paste` event rather than a hotkey: only the event carries the clipboard's files
 * without a permission prompt. Fired at the focused element, so `owns` decides by focus,
 * the same way hotkey scopes do.
 *
 * Typing wins. In a text field, a clipboard that also has text (a picture copied off a web
 * page brings its HTML along) pastes that text as it always did; only a bare image is
 * taken from a text field, since a text field can do nothing with one.
 */
export function useImagePaste(
	owns: (target: Element) => boolean,
	onImages: (files: File[]) => void,
	doc: Document | null = typeof document === 'undefined' ? null : document
) {
	const latest = React.useRef({onImages, owns});

	latest.current = {onImages, owns};

	React.useEffect(() => {
		if (!doc) {
			return;
		}

		function handlePaste(event: ClipboardEvent) {
			const target =
				event.target instanceof Element ? event.target : doc!.activeElement;

			if (event.defaultPrevented || !target || !latest.current.owns(target)) {
				return;
			}

			const files = clipboardImages(event.clipboardData);

			if (files.length === 0) {
				return;
			}

			if (
				isTextEntry(target) &&
				Array.from(event.clipboardData?.types ?? []).includes('text/plain')
			) {
				return;
			}

			event.preventDefault();
			latest.current.onImages(files);
		}

		doc.addEventListener('paste', handlePaste);
		return () => doc.removeEventListener('paste', handlePaste);
	}, [doc]);
}

export interface PasteImageModalProps {
	files: File[];
	/** Takes focus first: the kind the author is already looking at. */
	preferred?: PasteKind;
	onCancel: () => void;
	onChoose: (kind: PasteKind) => void;
}

const CHOICES: {
	icon: React.ReactNode;
	key: string;
	kind: PasteKind;
}[] = [
	{icon: <IconShape />, key: 'o', kind: 'object'},
	{icon: <IconMoodSmile />, key: 'c', kind: 'character'},
	{icon: <IconPhoto />, key: 'b', kind: 'bg'}
];

/**
 * "What is this picture?" Modal over the whole app: portalled to the body with a backdrop,
 * every key stops here (Escape cancels, O / C / B choose, Tab wraps), so nothing behind it
 * runs while it is up.
 */
export const PasteImageModal: React.FC<PasteImageModalProps> = props => {
	const {files, onCancel, onChoose, preferred} = props;
	const {t} = useTranslation();
	const rootRef = React.useRef<HTMLDivElement>(null);
	const [preview, setPreview] = React.useState<string>();
	// Callers pass fresh arrows every render; the key listener reads the newest ones
	// rather than being re-bound, which would also re-run the initial focus.
	const handlers = React.useRef({onCancel, onChoose});
	const key = 'dialogs.slidersAssets.pasteImage';

	handlers.current = {onCancel, onChoose};

	React.useEffect(() => {
		if (!files[0] || typeof URL.createObjectURL !== 'function') {
			return;
		}

		const url = URL.createObjectURL(files[0]);

		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [files]);

	React.useEffect(() => {
		const root = rootRef.current;

		if (!root) {
			return;
		}

		const buttons = () => [...root.querySelectorAll('button')];

		(
			root.querySelector<HTMLButtonElement>(
				`[data-paste-kind="${preferred ?? 'object'}"]`
			) ?? buttons()[0]
		)?.focus();

		function onKeyDown(event: KeyboardEvent) {
			event.stopPropagation();

			if (event.key === 'Escape') {
				event.preventDefault();
				handlers.current.onCancel();
				return;
			}

			if (event.key === 'Tab') {
				const all = buttons();
				const at = all.indexOf(document.activeElement as HTMLButtonElement);
				const next = (at + (event.shiftKey ? -1 : 1) + all.length) % all.length;

				event.preventDefault();
				all[next]?.focus();
				return;
			}

			const choice =
				!event.ctrlKey && !event.metaKey && !event.altKey
					? CHOICES.find(entry => entry.key === event.key.toLowerCase())
					: undefined;

			if (choice) {
				event.preventDefault();
				handlers.current.onChoose(choice.kind);
			}
		}

		// The document, not the modal: focus may still be behind the backdrop for a moment.
		document.addEventListener('keydown', onKeyDown, true);
		return () => document.removeEventListener('keydown', onKeyDown, true);
		// Mount only: focus lands once.
	}, []);

	return createPortal(
		<div
			className="paste-image-modal"
			data-testid="paste-image-modal"
			onPointerDown={event => {
				event.stopPropagation();

				if (event.target === event.currentTarget) {
					onCancel();
				}
			}}
			ref={rootRef}
		>
			<div
				aria-label={t(`${key}.title`, {count: files.length})}
				aria-modal="true"
				className="paste-image-menu"
				role="dialog"
			>
				<div className="paste-image-title">
					{t(`${key}.title`, {count: files.length})}
				</div>
				{preview && (
					<img alt="" className="paste-image-preview" src={preview} />
				)}
				{CHOICES.map(choice => (
					<button
						data-paste-kind={choice.kind}
						data-testid={`paste-image-${choice.kind}`}
						key={choice.kind}
						onClick={() => onChoose(choice.kind)}
						type="button"
					>
						{choice.icon}
						<span>{t(`${key}.${choice.kind}`)}</span>
						<kbd>{choice.key.toUpperCase()}</kbd>
					</button>
				))}
				<button className="paste-image-cancel" onClick={onCancel} type="button">
					<IconX />
					<span>{t('common.cancel')}</span>
					<kbd>Esc</kbd>
				</button>
			</div>
		</div>,
		document.body
	);
};
