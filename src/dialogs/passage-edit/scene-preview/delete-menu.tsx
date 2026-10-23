import {IconTrash, IconX} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {EntityId, Vec2} from '@sliders/scene-types';
import {useStageMenu} from './drop-menu';

export interface SceneDeleteMenuProps {
	/** The selected entities that have beats. Named in the heading. */
	ids: EntityId[];
	onCancel: () => void;
	/** `true`: their beats go too. `false`: only the entries, the beats stay. */
	onChoose: (withBeats: boolean) => void;
	point: Vec2;
}

/**
 * Asked when Delete hits an entity that still has beats. A beat is the author's writing —
 * the lines, the moves — so whether it goes with the sprite is theirs to say. Nothing with
 * no beats asks: that delete is the old one, instant.
 */
export function SceneDeleteMenu(props: SceneDeleteMenuProps) {
	const {ids, onCancel, onChoose, point} = props;
	const {t} = useTranslation();
	const {offset, rootRef} = useStageMenu(point, onCancel);
	const key = 'dialogs.passageEdit.scenePreview.deleteMenu';

	return createPortal(
		<div
			className={classNames('scene-drop-menu', 'scene-delete-menu', {
				measured: !!offset
			})}
			data-testid="scene-delete-menu"
			ref={rootRef}
			role="dialog"
			style={{left: (offset ?? point).x, top: (offset ?? point).y}}
		>
			<div className="scene-drop-menu-title">
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
				className="scene-drop-menu-cancel"
				onClick={onCancel}
				type="button"
			>
				<IconX />
				{t('common.cancel')}
			</button>
		</div>,
		document.body
	);
}
