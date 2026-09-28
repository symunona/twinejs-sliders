import {LibraryEngine, Notice} from '@sliders/asset-library';
import {IconX} from '@tabler/icons';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import {
	useLibraryEngine,
	useLibraryNotices
} from '../../../store/asset-library/library-provider';
import {isAssetOpen} from '../../../store/asset-library/open-assets';
import './library.css';

interface Toast {
	id: number;
	text: string;
}

export const TOAST_MS = 10000;

function nameOf(engine: LibraryEngine, id: string): string {
	const record = engine.get(id);

	return String(record?.name ?? record?.charId ?? id);
}

/**
 * Library toasts (plan 2, "Toasts"), and ONLY these: a name taken on create (saved as
 * `-2`), a remote delete of art open in an editor, a conflict created. Everything else
 * the library does is silent; the chips say it.
 */
export const LibraryToasts: React.FC = () => {
	const engine = useLibraryEngine();
	const {t} = useTranslation();
	const [toasts, setToasts] = React.useState<Toast[]>([]);
	const nextId = React.useRef(1);

	const push = React.useCallback((text: string) => {
		const id = nextId.current++;

		setToasts(current => [...current, {id, text}]);
		setTimeout(
			() => setToasts(current => current.filter(toast => toast.id !== id)),
			TOAST_MS
		);
	}, []);

	useLibraryNotices((notice: Notice) => {
		if (!engine) {
			return;
		}

		if (notice.kind === 'renamed-on-clash') {
			const holder = notice.holder && engine.get(notice.holder.id);

			push(
				t('dialogs.library.toast.renamed', {
					from: notice.from,
					holder: holder?.by
						? t('dialogs.library.toast.renamedBy', {by: holder.by})
						: '',
					to: notice.to
				})
			);
		} else if (notice.kind === 'conflict') {
			push(
				t('dialogs.library.toast.conflict', {
					fields: notice.fields.join(', '),
					name: nameOf(engine, notice.id)
				})
			);
		}
	});

	React.useEffect(
		() =>
			engine?.onChange(event => {
				if (event.source !== 'remote') {
					return;
				}

				for (const id of event.ids) {
					const record = engine.get(id, 'asset');

					if (record?.deleted && isAssetOpen(id)) {
						push(
							t('dialogs.library.toast.remoteDelete', {
								by: record.by || '?',
								name: record.name
							})
						);
					}
				}
			}),
		[engine, push, t]
	);

	if (toasts.length === 0) {
		return null;
	}

	// Portalled: the dialog stack is a stacking context of its own (TRAPS, z-index).
	return createPortal(
		<div className="library-toasts">
			{toasts.map(toast => (
				<div className="library-toast" key={toast.id} role="status">
					<p>{toast.text}</p>
					<IconButton
						icon={<IconX />}
						iconOnly
						label={t('dialogs.library.toast.dismiss')}
						onClick={() =>
							setToasts(current => current.filter(other => other.id !== toast.id))
						}
					/>
				</div>
			))}
		</div>,
		document.body
	);
};
