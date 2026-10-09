/**
 * The layers panel: every entity on the stage, front-most first, as a list the author can
 * select from, reorder, lock and hide.
 *
 * It owns nothing but its own pointer and keyboard. The rows are `layerRows(stage)` and the
 * stage is the one the scrubber is on — the same one `stepZ` reads — so a drag here and a
 * bracket press on the stage are the same edit through the same `commit`, with the same
 * beat-vs-entry target. Not the same origin: a bracket burst merges into one undo step, a
 * drag or a reset is one gesture and one step of its own. The selection is the stage's own,
 * handed down: a row lighting up IS the sprite being selected, never a second selection
 * kept in step with it.
 *
 * Hiding is the one thing here that is not a write. It is the editor asking to see past a
 * sprite, not the scene saying anything, so it lives in the preview's session state and the
 * YAML never hears of it (see `hidden` in `scene-preview.tsx`).
 */

import {
	IconArrowBackUp,
	IconBox,
	IconCircleDashed,
	IconEye,
	IconEyeOff,
	IconLock,
	IconLockOpen,
	IconPhoto,
	IconUser
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {EntityId, Stage} from '@sliders/scene-types';
import {
	autoZWrites,
	layerRows,
	reorderWrites,
	type LayerRow,
	type ZResetBlock
} from './layer-order';
import {lockWrites} from './scene-gestures';
import {roundCoord} from './stage-geometry';
import {EDIT_ORIGIN, type SceneWrite} from './use-scene-writer';
import './layers-panel.css';

/**
 * The drag's own type, so the stage's asset drop and the step strip's reorder never mistake
 * a row for one of theirs — and this list never mistakes a file or an asset tile for a row.
 */
export const LAYER_DRAG_TYPE = 'application/x-sliders-layer';

/** Why a reset is greyed out, said so the author knows where to go to do it. */
const RESET_BLOCK_HINT: Record<ZResetBlock, string> = {
	beat: 'dialogs.passageEdit.scenePreview.layers.resetBlockedBeat',
	entry: 'dialogs.passageEdit.scenePreview.layers.resetBlockedEntry',
	inherited: 'dialogs.passageEdit.scenePreview.layers.resetBlockedInherited',
	seed: 'dialogs.passageEdit.scenePreview.layers.resetBlockedSeed'
};

/**
 * Whether the panel is open. Off by default: it costs the stage a strip of its width, and a
 * scene with two characters does not need a list to find them. An author who opened it is
 * staging a crowded scene, and that outlasts one passage — so it is remembered under the
 * same `sliders.preview.*` family as the grid and the lock.
 */
export const LAYERS_PANEL_KEY = 'sliders.preview.layers';

export function useLayersPanelOpen(): [boolean, () => void] {
	const [open, setOpen] = React.useState(
		() => window.localStorage.getItem(LAYERS_PANEL_KEY) === 'true'
	);
	const toggle = React.useCallback(
		() =>
			setOpen(value => {
				window.localStorage.setItem(LAYERS_PANEL_KEY, String(!value));

				return !value;
			}),
		[]
	);

	return [open, toggle];
}

export interface LayersPanelProps {
	/**
	 * The stage at the scrubber in AUTHORED space — `localStage`, `of:` intact. The same
	 * beat and patch as the one `stepZ` writes against; only `at` and `of` differ, and
	 * `layer-order` resolves those itself to rank. Resolving first would erase `of`, and
	 * with it the only way to know a row rides on another.
	 */
	stage: Stage;
	selection: EntityId[];
	/** The stage's own select: moves the caret too, exactly as a click on the sprite does. */
	onSelect: (ids: EntityId[]) => void;
	/**
	 * False when nothing here may write: no CodeMirror, or the stage is locked (by the author
	 * or by the scene). Selecting and hiding still work — neither is an edit.
	 */
	editable: boolean;
	/** One gesture, one write, through the preview's `commit`. */
	onCommit: (writes: SceneWrite[], origin: string) => void;
	/** Entities the author has hidden in the editor. Never written anywhere. */
	hidden: ReadonlySet<EntityId>;
	onToggleHidden: (id: EntityId) => void;
	/**
	 * Pinned rows whose reset would not make them auto from here — see `zResetBlocks`.
	 * Absent means every reset is taken at its word.
	 */
	resetBlocks?: ReadonlyMap<EntityId, ZResetBlock>;
}

function KindIcon({row}: {row: LayerRow}) {
	if (row.plane) {
		return <IconPhoto />;
	}

	switch (row.kind) {
		case 'cast':
			return <IconUser />;
		case 'prop':
			return <IconBox />;
		default:
			return <IconCircleDashed />;
	}
}

function kindLabel(row: LayerRow): string {
	if (row.plane) {
		return 'dialogs.passageEdit.scenePreview.layers.kindPlane';
	}

	switch (row.kind) {
		case 'cast':
			return 'dialogs.passageEdit.scenePreview.layers.kindCast';
		case 'prop':
			return 'dialogs.passageEdit.scenePreview.layers.kindProp';
		default:
			return 'dialogs.passageEdit.scenePreview.layers.kindAuto';
	}
}

/**
 * Where a drop over `row` would land: the slot above it or the slot below, whichever half
 * the pointer is in. Slots count the front-first list, like `reorderWrites` does.
 */
function slotAt(event: React.DragEvent, index: number): number {
	const rect = event.currentTarget.getBoundingClientRect();

	return event.clientY < rect.top + rect.height / 2 ? index : index + 1;
}

export const LayersPanel: React.FC<LayersPanelProps> = props => {
	const {
		editable,
		hidden,
		onCommit,
		onSelect,
		onToggleHidden,
		resetBlocks,
		selection,
		stage
	} = props;
	const {t} = useTranslation();
	const rows = React.useMemo(() => layerRows(stage), [stage]);
	/**
	 * The far end of a shift-click range. The last row clicked without shift, as in every
	 * file list: a shift-click that moved the anchor would make the second one grow the range
	 * from the wrong end. Only while it is still selected — a pick on the stage replaces the
	 * selection without passing through here, and then the stage's caret is the anchor.
	 */
	const anchor = React.useRef<EntityId>();
	/**
	 * What the drag in flight carries. Kept here as well as on the `DataTransfer` because a
	 * browser only lets `dragover` read the TYPES, not the data, and the indicator has to know
	 * whether this is our drag before the drop.
	 */
	const dragIds = React.useRef<EntityId[]>();
	const [dropSlot, setDropSlot] = React.useState<number>();
	/** The row that holds the tab stop — roving tabindex, so the list is one Tab long. */
	const [focusId, setFocusId] = React.useState<EntityId>();
	const listRef = React.useRef<HTMLUListElement>(null);
	const rowRefs = React.useRef(new Map<EntityId, HTMLLIElement>());
	const rowIds = React.useMemo(() => rows.map(row => row.id), [rows]);
	/**
	 * Rows drawn one step in. The indent says "rides on the row above", so it is only true
	 * when the row above IS the parent, or a sibling already indented under it. A child the
	 * sort put elsewhere (its own y, its own z) names its parent instead of claiming a
	 * neighbour it has nothing to do with.
	 */
	const nestedIds = React.useMemo(() => {
		const nested = new Set<EntityId>();

		rows.forEach((row, index) => {
			const above = rows[index - 1];

			if (
				row.parent !== undefined &&
				above !== undefined &&
				(above.id === row.parent ||
					(above.parent === row.parent && nested.has(above.id)))
			) {
				nested.add(row.id);
			}
		});

		return nested;
	}, [rows]);
	const tabStop =
		focusId !== undefined && rowIds.includes(focusId)
			? focusId
			: selection.find(id => rowIds.includes(id)) ?? rowIds[0];

	// A sprite picked on the stage is very often one scrolled out of a long cast list.
	// `nearest` so a row already in view does not jump; guarded because jsdom has none.
	const primary = selection[0];

	React.useEffect(() => {
		if (primary !== undefined) {
			rowRefs.current.get(primary)?.scrollIntoView?.({block: 'nearest'});
		}
	}, [primary]);

	function handleRowClick(event: React.MouseEvent, id: EntityId) {
		setFocusId(id);

		if (event.shiftKey) {
			const head =
				anchor.current !== undefined && selection.includes(anchor.current)
					? anchor.current
					: selection[0];
			const from = rowIds.indexOf(head ?? id);
			const to = rowIds.indexOf(id);

			if (from >= 0 && to >= 0) {
				const range = rowIds.slice(Math.min(from, to), Math.max(from, to) + 1);
				const start = rowIds[from];

				// The anchor first: `select` puts the caret on the first id, and that is the
				// row the author started the range from.
				onSelect([start, ...range.filter(other => other !== start)]);

				return;
			}
		}

		anchor.current = id;

		// Same modifier the stage uses to extend, so the two lists of muscle memory agree.
		if (event.ctrlKey || event.metaKey) {
			onSelect(
				selection.includes(id)
					? selection.filter(other => other !== id)
					: [...selection, id]
			);

			return;
		}

		onSelect([id]);
	}

	/**
	 * Up and down move the tab stop. Native and on the list itself rather than React's
	 * `onKeyDown`: the hotkey dispatcher listens on the document and skips an event that is
	 * already default-prevented, but React 16 also delivers from the document, so which of
	 * the two ran first would be registration order. Here the arrows are spent before either
	 * sees them, and the stage's nudge and scrub keep their hands off the list.
	 *
	 * ALL four arrows, Left and Right included though they move nothing: a focused row is
	 * the author working the list, and a sideways arrow that nudged the sprite instead would
	 * be an edit made from a place that does not show it. A lock, eye or reset button that
	 * took focus from a click counts as its row for the arrows; Enter and Space stay its own.
	 */
	React.useEffect(() => {
		const list = listRef.current;

		if (!list) {
			return;
		}

		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			const row = target.closest?.('[role="option"]') as HTMLElement | null;

			if (!row) {
				return;
			}

			const index = rowIds.indexOf(row.dataset.layerId ?? '');
			let next: number | undefined;

			switch (event.key) {
				case 'ArrowUp':
					next = Math.max(0, index - 1);
					break;
				case 'ArrowDown':
					next = Math.min(rowIds.length - 1, index + 1);
					break;
				case 'Home':
					next = 0;
					break;
				case 'End':
					next = rowIds.length - 1;
					break;
				case 'ArrowLeft':
				case 'ArrowRight':
					event.preventDefault();
					return;
				case 'Enter':
				case ' ':
					// A focused button's own Enter is its click, and that is the one meant.
					if (row !== target) {
						return;
					}

					event.preventDefault();
					row.click();
					return;
				default:
					return;
			}

			event.preventDefault();

			const id = rowIds[next];

			if (id !== undefined) {
				setFocusId(id);
				rowRefs.current.get(id)?.focus();
			}
		};

		list.addEventListener('keydown', onKey);

		return () => list.removeEventListener('keydown', onKey);
	}, [rowIds]);

	function endDrag() {
		dragIds.current = undefined;
		setDropSlot(undefined);
	}

	// A drag cut short by the panel closing never sees its `dragend`.
	React.useEffect(
		() => () => {
			dragIds.current = undefined;
		},
		[]
	);

	/**
	 * Ours only when the ref AND the transfer agree. The ref alone would take an asset tile
	 * dragged across the list after a row drag that never ended cleanly for a stale reorder.
	 */
	function ownDrag(event: React.DragEvent): EntityId[] | undefined {
		const types = event.dataTransfer?.types;

		return types && Array.from(types).includes(LAYER_DRAG_TYPE)
			? dragIds.current
			: undefined;
	}

	function handleDragStart(event: React.DragEvent, id: EntityId) {
		if (!editable) {
			event.preventDefault();

			return;
		}

		// A row in the selection carries the whole selection, in the order the list shows
		// it, so a block of layers lands as the block it was.
		const ids = selection.includes(id)
			? rowIds.filter(other => selection.includes(other))
			: [id];

		dragIds.current = ids;
		event.dataTransfer.setData(LAYER_DRAG_TYPE, JSON.stringify(ids));
		event.dataTransfer.effectAllowed = 'move';
	}

	function handleDragOver(event: React.DragEvent, index: number) {
		if (!ownDrag(event)) {
			return;
		}

		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';

		const slot = slotAt(event, index);

		setDropSlot(current => (current === slot ? current : slot));
	}

	function handleDrop(event: React.DragEvent, index: number) {
		const ids = ownDrag(event);

		if (!ids) {
			// Not ours; whatever the ref held is over either way.
			endDrag();

			return;
		}

		event.preventDefault();

		const writes = reorderWrites(stage, ids, slotAt(event, index));

		endDrag();

		// EDIT, not Z: a `+` origin merges with the last change inside CodeMirror's history
		// delay, and two drags (or a drag and a bracket burst) are two decisions.
		if (writes.length > 0) {
			onCommit(writes, EDIT_ORIGIN);
		}
	}

	return (
		<div className="layers-panel" data-testid="layers-panel">
			<div className="layers-panel-title">
				{t('dialogs.passageEdit.scenePreview.layers.title')}
			</div>
			{rows.length === 0 ? (
				<p className="layers-panel-empty">
					{t('dialogs.passageEdit.scenePreview.layers.empty')}
				</p>
			) : (
				<ul
					aria-label={t('dialogs.passageEdit.scenePreview.layers.title')}
					aria-multiselectable
					className={classNames('layers-panel-list', {readonly: !editable})}
					onDragLeave={event => {
						const to = event.relatedTarget as Node | null;

						if (!to?.nodeType || !event.currentTarget.contains(to)) {
							setDropSlot(undefined);
						}
					}}
					ref={listRef}
					role="listbox"
				>
					{rows.map((row, index) => {
						const selected = selection.includes(row.id);
						const isHidden = hidden.has(row.id);
						const nested = nestedIds.has(row.id);
						const resetBlock = resetBlocks?.get(row.id);
						const resetHint = t(
							resetBlock
								? RESET_BLOCK_HINT[resetBlock]
								: 'dialogs.passageEdit.scenePreview.layers.resetAuto'
						);

						return (
							<li
								aria-selected={selected}
								className={classNames('layers-panel-row', {
									child: nested,
									'drop-above': dropSlot === index,
									// The slot past the last row has no row of its own to draw on.
									'drop-below':
										dropSlot === rows.length && index === rows.length - 1,
									hidden: isHidden,
									locked: row.locked,
									selected
								})}
								data-layer-id={row.id}
								draggable={editable}
								key={row.id}
								onClick={event => handleRowClick(event, row.id)}
								onDragEnd={endDrag}
								onDragOver={event => handleDragOver(event, index)}
								onDragStart={event => handleDragStart(event, row.id)}
								onDrop={event => handleDrop(event, index)}
								ref={element => {
									if (element) {
										rowRefs.current.set(row.id, element);
									} else {
										rowRefs.current.delete(row.id);
									}
								}}
								role="option"
								tabIndex={row.id === tabStop ? 0 : -1}
							>
								<span className="layers-panel-kind" title={t(kindLabel(row))}>
									<KindIcon row={row} />
								</span>
								<span className="layers-panel-label">
									<span className="layers-panel-id">{row.id}</span>
									{row.ref && row.ref !== row.id && (
										<span className="layers-panel-ref">{row.ref}</span>
									)}
									{row.parent !== undefined && !nested && (
										<span className="layers-panel-ref">↳ {row.parent}</span>
									)}
								</span>
								{row.auto ? (
									<span
										className="layers-panel-auto"
										data-testid="layers-panel-auto"
										title={t(
											'dialogs.passageEdit.scenePreview.layers.autoHint'
										)}
									>
										{t('dialogs.passageEdit.scenePreview.layers.auto')}
									</span>
								) : (
									<span
										className="layers-panel-z"
										// On the wrapper as well: a disabled button gets no pointer
										// events in some browsers, so its own title never shows.
										title={resetBlock ? resetHint : undefined}
									>
										{/* The number it is pinned at, so two rows that look stacked
										    wrongly can be read off without opening the text. Rounded
										    like every gesture writes: a drop's midpoint is a float. */}
										<span className="layers-panel-z-value">
											{roundCoord(row.z)}
										</span>
										<button
											aria-label={resetHint}
											className="layers-panel-action"
											data-testid="layers-panel-reset"
											disabled={!editable || !!resetBlock}
											onClick={event => {
												event.stopPropagation();
												// EDIT, not Z: one click, one undo — see the drop.
												onCommit(autoZWrites(stage, [row.id]), EDIT_ORIGIN);
											}}
											tabIndex={-1}
											title={resetHint}
											type="button"
										>
											<IconArrowBackUp />
										</button>
									</span>
								)}
								{/* Per row, not the selection: a lock is aimed at the row the
								    pointer is on, and a click on it must not select first. */}
								<button
									aria-label={t(
										row.locked
											? 'dialogs.passageEdit.scenePreview.unlockEntity'
											: 'dialogs.passageEdit.scenePreview.lockEntity'
									)}
									aria-pressed={row.locked}
									className={classNames('layers-panel-action', {
										on: row.locked
									})}
									data-testid="layers-panel-lock"
									disabled={!editable}
									onClick={event => {
										event.stopPropagation();
										onCommit(lockWrites(stage, [row.id]), EDIT_ORIGIN);
									}}
									tabIndex={-1}
									title={t(
										row.locked
											? 'dialogs.passageEdit.scenePreview.unlockEntity'
											: 'dialogs.passageEdit.scenePreview.lockEntity'
									)}
									type="button"
								>
									{row.locked ? <IconLock /> : <IconLockOpen />}
								</button>
								{/* Never disabled: hiding writes nothing, so a locked stage has no
								    say in it. */}
								<button
									aria-label={t(
										isHidden
											? 'dialogs.passageEdit.scenePreview.layers.show'
											: 'dialogs.passageEdit.scenePreview.layers.hide'
									)}
									aria-pressed={isHidden}
									className={classNames('layers-panel-action', {on: isHidden})}
									data-testid="layers-panel-eye"
									onClick={event => {
										event.stopPropagation();
										onToggleHidden(row.id);
									}}
									tabIndex={-1}
									title={t(
										isHidden
											? 'dialogs.passageEdit.scenePreview.layers.show'
											: 'dialogs.passageEdit.scenePreview.layers.hide'
									)}
									type="button"
								>
									{isHidden ? <IconEyeOff /> : <IconEye />}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
};
