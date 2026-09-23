import {
	IconMoodSmile,
	IconPhoto,
	IconUsers,
	IconX
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {Character, Vec2} from '@sliders/scene-types';

/**
 * What the author decided a dropped image is.
 *
 * A file on its own says nothing about its role: the same PNG is a backdrop, a prop, a new
 * cast member or one more pose of a cast member already in the story, and the store has to
 * be told which before the bytes can be written — `kind` decides the asset's tab, a
 * character needs a record of its own, and a pose needs an owner. Guessing it from the
 * drop point was the old behaviour (everything became an object) and it was wrong about
 * three cases in four.
 */
export type DropChoice =
	| {kind: 'bg'}
	| {kind: 'object'}
	| {kind: 'character'}
	| {kind: 'pose'; character: Character};

export interface SceneDropMenuProps {
	/** The cast this story already has, for the "poses of…" branch. */
	characters: Character[];
	/** How many files were dropped. Shown in the heading; the choice applies to all. */
	count: number;
	onCancel: () => void;
	onChoose: (choice: DropChoice) => void;
	/** Where the pointer let go, in client coordinates. */
	point: Vec2;
}

/**
 * The menu a file drop opens on the stage.
 *
 * Positioned at the drop point rather than centred, because the point is the answer to
 * "where does this go" for two of the four choices and the author is already looking there.
 *
 * Portalled to the body and placed `fixed`, NOT absolute inside the stage. Docked, the stage
 * is a couple of hundred pixels tall — shorter than this menu — so a child of it would be
 * cut off at the letterbox however it was clamped. The viewport is the only box that is
 * reliably big enough, so that is what the clamp uses.
 */
export function SceneDropMenu(props: SceneDropMenuProps) {
	const {characters, count, onCancel, onChoose, point} = props;
	const [poses, setPoses] = React.useState(false);
	const {t} = useTranslation();
	const rootRef = React.useRef<HTMLDivElement>(null);
	const [offset, setOffset] = React.useState<Vec2>();

	// Measured after mount, so the clamp knows the menu's real size — and again when the
	// character list opens, since that changes the height it has to fit.
	React.useLayoutEffect(() => {
		const root = rootRef.current;

		if (!root) {
			return;
		}

		const margin = 8;

		setOffset({
			x: Math.max(
				margin,
				Math.min(point.x, window.innerWidth - root.offsetWidth - margin)
			),
			y: Math.max(
				margin,
				Math.min(point.y, window.innerHeight - root.offsetHeight - margin)
			)
		});
	}, [poses, point.x, point.y]);

	// Escape cancels wherever focus is. Bound to the document rather than the menu because
	// the drop leaves focus on whatever the pointer started from, which may be outside it.
	React.useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.stopPropagation();
				onCancel();
			}
		}

		document.addEventListener('keydown', onKeyDown, true);
		return () => document.removeEventListener('keydown', onKeyDown, true);
	}, [onCancel]);

	React.useEffect(() => {
		// A press anywhere else means "not this". Captured on the document so a press on the
		// stage below cannot also begin a gesture.
		function onPointerDown(event: PointerEvent) {
			if (!rootRef.current?.contains(event.target as Node)) {
				event.preventDefault();
				event.stopPropagation();
				onCancel();
			}
		}

		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	}, [onCancel]);

	// The first button takes focus, so the whole menu is reachable by keyboard from a drop
	// that never touched one.
	React.useEffect(() => {
		rootRef.current
			?.querySelector<HTMLButtonElement>('button')
			?.focus();
	}, []);

	const key = 'dialogs.passageEdit.scenePreview.dropMenu';

	return createPortal(
		<div
			className={classNames('scene-drop-menu', {measured: !!offset})}
			data-testid="scene-drop-menu"
			ref={rootRef}
			role="dialog"
			style={{left: (offset ?? point).x, top: (offset ?? point).y}}
		>
			<div className="scene-drop-menu-title">
				{t(`${key}.title`, {count})}
			</div>
			{poses ? (
				<>
					<div className="scene-drop-menu-characters">
						{characters.map(character => (
							<button
								key={character.id}
								onClick={() => onChoose({character, kind: 'pose'})}
								type="button"
							>
								{character.name || character.id}
							</button>
						))}
					</div>
					<button
						className="scene-drop-menu-back"
						onClick={() => setPoses(false)}
						type="button"
					>
						{t('common.back')}
					</button>
				</>
			) : (
				<>
					<button
						data-testid="scene-drop-menu-bg"
						onClick={() => onChoose({kind: 'bg'})}
						type="button"
					>
						<IconPhoto />
						{t(`${key}.bg`)}
					</button>
					<button
						data-testid="scene-drop-menu-object"
						onClick={() => onChoose({kind: 'object'})}
						type="button"
					>
						<IconPhoto />
						{t(`${key}.object`)}
					</button>
					<button
						data-testid="scene-drop-menu-character"
						onClick={() => onChoose({kind: 'character'})}
						type="button"
					>
						<IconMoodSmile />
						{t(`${key}.character`)}
					</button>
					<button
						data-testid="scene-drop-menu-pose"
						disabled={characters.length === 0}
						onClick={() => setPoses(true)}
						type="button"
					>
						<IconUsers />
						{characters.length === 0
							? t(`${key}.poseEmpty`)
							: t(`${key}.pose`)}
					</button>
					<button
						className="scene-drop-menu-cancel"
						onClick={onCancel}
						type="button"
					>
						<IconX />
						{t('common.cancel')}
					</button>
				</>
			)}
		</div>,
		document.body
	);
}
