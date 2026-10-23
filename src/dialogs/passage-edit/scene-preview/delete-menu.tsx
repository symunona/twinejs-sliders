import {IconTrash, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {EntityId} from '@sliders/scene-types';

export interface SceneDeleteMenuProps {
	/** The selected entities that have beats. Named in the heading. */
	ids: EntityId[];
	onCancel: () => void;
	/** `true`: their beats go too. `false`: only the entries, the beats stay. */
	onChoose: (withBeats: boolean) => void;
}

/**
 * Asked when Delete hits an entity that still has beats. A beat is the author's writing —
 * the lines, the moves — so whether it goes with the sprite is theirs to say. Nothing with
 * no beats asks: that delete is the old one, instant.
 *
 * MODAL over the scene editor: rendered inside `.scene-preview`, a backdrop over all of it.
 * Every key stops here (native listener, ahead of the hotkey dispatcher on the document),
 * so nothing behind it runs while it is up — Delete again, a nudge, an undo.
 */
export function SceneDeleteMenu(props: SceneDeleteMenuProps) {
	const {ids, onCancel, onChoose} = props;
	const {t} = useTranslation();
	const rootRef = React.useRef<HTMLDivElement>(null);
	const key = 'dialogs.passageEdit.scenePreview.deleteMenu';

	React.useEffect(() => {
		const root = rootRef.current;

		if (!root) {
			return;
		}

		const buttons = () => [...root.querySelectorAll('button')];

		buttons()[0]?.focus();

		function onKeyDown(event: KeyboardEvent) {
			event.stopPropagation();

			if (event.key === 'Escape') {
				event.preventDefault();
				onCancel();
			} else if (event.key === 'Tab') {
				// Focus stays in the modal: wrap at both ends.
				const all = buttons();
				const at = all.indexOf(document.activeElement as HTMLButtonElement);
				const next = (at + (event.shiftKey ? -1 : 1) + all.length) % all.length;

				event.preventDefault();
				all[next]?.focus();
			}
		}

		root.addEventListener('keydown', onKeyDown);
		return () => root.removeEventListener('keydown', onKeyDown);
	}, [onCancel]);

	return (
		<div
			className="scene-delete-modal"
			data-testid="scene-delete-modal"
			onPointerDown={event => {
				// The press is the modal's: nothing behind it starts a gesture.
				event.stopPropagation();

				if (event.target === event.currentTarget) {
					onCancel();
				}
			}}
			ref={rootRef}
		>
			<div
				aria-label={t(`${key}.title`, {count: ids.length, name: ids.join(', ')})}
				aria-modal="true"
				className="scene-delete-menu"
				data-testid="scene-delete-menu"
				role="dialog"
			>
				<div className="scene-delete-menu-title">
					{t(`${key}.title`, {count: ids.length, name: ids.join(', ')})}
				</div>
				<button
					data-testid="scene-delete-menu-with-beats"
					onClick={() => onChoose(true)}
					type="button"
				>
					<IconTrash />
					{t(`${key}.withBeats`)}
				</button>
				<button
					data-testid="scene-delete-menu-keep-beats"
					onClick={() => onChoose(false)}
					type="button"
				>
					<IconTrash />
					{t(`${key}.keepBeats`)}
				</button>
				<button
					className="scene-delete-menu-cancel"
					onClick={onCancel}
					type="button"
				>
					<IconX />
					{t('common.cancel')}
				</button>
			</div>
		</div>
	);
}
