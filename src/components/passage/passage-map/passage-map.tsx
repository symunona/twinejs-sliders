import * as React from 'react';
import {DraggableData} from 'react-draggable';
import {Passage, Story} from '../../../store/stories';
import {boundingRect, Point} from '../../../util/geometry';
import {PassageConnections} from '../passage-connections';
import {PassageCardGroup} from '../passage-card-group';
import './passage-map.css';
import classnames from 'classnames';

export interface PassageMapProps {
	/** Passage ID -> scene error count, for the cards that have any. */
	errorCounts?: Record<string, number>;
	formatName: string;
	formatVersion: string;
	/**
	 * Link targets with no passage behind them yet, drawn dashed and clickable--synthetic
	 * passages from `brokenLinkGhosts`. They are drawn with the same card and wired into
	 * the same connector pass as a real one, so the two cannot drift apart; keeping them
	 * in their own prop is what tells the card which is which, and keeps them out of
	 * `story.passages`, where they must never go.
	 */
	ghosts?: Passage[];
	onCreateGhost?: (ghost: Passage) => void;
	onDeselect: (passage: Passage) => void;
	onDrag: (change: Point) => void;
	onEdit: (passage: Passage) => void;
	/** Renaming from a card title. Omitted leaves titles inert. */
	onRename?: (passage: Passage, name: string) => void;
	onSelect: (passage: Passage, exclusive: boolean) => void;
	/** Passage ID -> the name of the other editor holding it. Soft locks, spec 11. */
	passageLocks?: Record<string, string>;
	passages: Passage[];
	startPassageId: string;
	tagColors: Story['tagColors'];
	tagDisplay: 'color' | 'name';
	visibleZoom: number;
	zoom: number;
}

interface DragState {
	dragging: boolean;
	dragX: number;
	dragY: number;
	startX: number;
	startY: number;
}

type DragAction =
	| {type: 'start'; x: number; y: number}
	| {type: 'move'; x: number; y: number}
	| {type: 'stop'; callback: (change: Point) => void};

function dragReducer(state: DragState, action: DragAction) {
	switch (action.type) {
		case 'start':
			return {
				dragging: true,
				dragX: action.x,
				dragY: action.y,
				startX: action.x,
				startY: action.y
			};

		case 'move':
			return {...state, dragX: action.x, dragY: action.y};

		case 'stop':
			// This is bad reducer practice, probably—this dispatch causes a side
			// effect. However, it allows us to avoid re-renders as state
			// changes--otherwise state becomes a dependency of the handleDragStop
			// callback below--which have a large performance impact.
			//
			// This also must be deferred to avoid changing state mid-render through
			// the callback.

			Promise.resolve().then(() =>
				action.callback({
					left: state.dragX - state.startX,
					top: state.dragY - state.startY
				})
			);
			return {dragging: false, dragX: 0, dragY: 0, startX: 0, startY: 0};
	}
}

const compactCardZoom = 0.6;

export const PassageMap: React.FC<PassageMapProps> = props => {
	const {
		errorCounts,
		formatName,
		formatVersion,
		ghosts,
		onCreateGhost,
		onDeselect,
		onDrag,
		onEdit,
		onRename,
		onSelect,
		passageLocks,
		passages,
		startPassageId,
		tagColors,
		tagDisplay,
		visibleZoom,
		zoom
	} = props;
	const [compactCards, setCompactCards] = React.useState(
		visibleZoom <= compactCardZoom
	);
	const container = React.useRef<HTMLDivElement>(null);

	// Everything below here works on ghosts and real passages alike: the cards, the
	// canvas size, and the connectors--a link into a ghost resolves in
	// `passageConnections` because the ghost is in the array it searches, so it draws
	// solid instead of as a broken stub.

	const mapPassages = React.useMemo(
		() => (ghosts?.length ? [...passages, ...ghosts] : passages),
		[ghosts, passages]
	);
	const ghostIds = React.useMemo(
		() => new Set((ghosts ?? []).map(ghost => ghost.id)),
		[ghosts]
	);
	// Ghosts are not in this: a link target with no passage behind it is exactly the
	// name a rename should be allowed to claim.
	const passageNames = React.useMemo(
		() => new Set(passages.map(passage => passage.name)),
		[passages]
	);
	const nameTaken = React.useCallback(
		(name: string) => passageNames.has(name),
		[passageNames]
	);
	const passageBounds = React.useMemo(() => {
		// Need to inject a fake rect at the very top-left corner to anchor the
		// bounds there.

		return boundingRect([
			...mapPassages,
			{top: 0, left: 0, width: 0, height: 0}
		]);
	}, [mapPassages]);

	// This is a separate memo so that there's less work when visibleZoom changes
	// during a zoom transition. The max() expression ensures that dialogs will
	// never overlap it--800px is the largest user-selectable dialog width (see
	// dialogs/app-prefs.tsx), so we leave 200px padding around that. We hardcode
	// it here instead of taking a prop mainly for simplicity's sake.

	const style = React.useMemo(() => {
		return {
			height: `calc(${passageBounds.height}px + max(50vh, ${
				1000 / visibleZoom
			}px))`,
			width: `calc(${passageBounds.width}px + max(50vw, ${
				1000 / visibleZoom
			}px))`,
			transform: `scale(${visibleZoom})`
		};
	}, [passageBounds.height, passageBounds.width, visibleZoom]);

	const [state, dispatch] = React.useReducer(dragReducer, {
		dragging: false,
		dragX: 0,
		dragY: 0,
		startX: 0,
		startY: 0
	});

	// Separate from the state above, we need to track whether the user was
	// recently dragging cards so that we maintain the correct card selection
	// after a drag. The issue is that the card fires a select event immediately
	// after a drag finishes, because it sees the mouseup event. We need to ignore
	// this callback, but *only* immediately after a drag.
	//
	// We use a ref to avoid unnecessary re-renders.

	const recentlyDragging = React.useRef(false);

	// Only update the compact card state when visibleZoom and zoom are the same.
	// This avoids re-rendering the cards in the middle of a zoom transition
	// (which causes jank).

	React.useEffect(() => {
		if (zoom === visibleZoom) {
			setCompactCards(zoom <= compactCardZoom);
		}
	}, [visibleZoom, zoom]);

	// Set CSS variables on the container for drag offsets.

	React.useEffect(() => {
		if (!container.current) {
			return;
		}

		container.current.style.setProperty(
			'--drag-offset-left',
			`${(state.dragX - state.startX) / visibleZoom}px`
		);
		container.current.style.setProperty(
			'--drag-offset-top',
			`${(state.dragY - state.startY) / visibleZoom}px`
		);
	}, [state.dragX, state.dragY, state.startX, state.startY, visibleZoom]);

	const handleDragStart = React.useCallback((event, data: DraggableData) => {
		document.body.classList.add('dragging-passages');
		dispatch({type: 'start', x: data.x, y: data.y});
	}, []);
	const handleDrag = React.useCallback(
		(event, data: DraggableData) =>
			dispatch({type: 'move', x: data.x, y: data.y}),
		[]
	);
	const handleDragStop = React.useCallback(() => {
		document.body.classList.remove('dragging-passages');
		dispatch({type: 'stop', callback: onDrag});

		// A 0 timeout is enough to swallow the incoming onSelect callback that the
		// card will send. Promise.resolve() doesn't appear to give us the timing we
		// want.
		//
		// We can't defer the dispatch() call above because it can lead to colliding
		// drags when users click rapidly on a passage. See
		// https://github.com/klembot/twinejs/issues/1426

		recentlyDragging.current = true;
		window.setTimeout(() => {
			recentlyDragging.current = false;
		}, 0);
	}, [onDrag]);
	const handleSelect = React.useCallback(
		(passage: Passage, exclusive: boolean) => {
			// See comments above about recentlyDragging.

			if (!recentlyDragging.current) {
				onSelect(passage, exclusive);
			}
		},
		[onSelect]
	);

	return (
		<div
			className={classnames('passage-map', {
				'compact-passage-cards': compactCards
			})}
			ref={container}
			style={style}
		>
			<PassageConnections
				formatName={formatName}
				formatVersion={formatVersion}
				offset={{
					left: (state.dragX - state.startX) / zoom,
					top: (state.dragY - state.startY) / zoom
				}}
				passages={mapPassages}
				startPassageId={startPassageId}
			/>
			<PassageCardGroup
				errorCounts={errorCounts}
				ghostIds={ghostIds}
				nameTaken={nameTaken}
				onCreate={onCreateGhost}
				onDeselect={onDeselect}
				onDragStart={handleDragStart}
				onDrag={handleDrag}
				onDragStop={handleDragStop}
				onEdit={onEdit}
				onRename={onRename}
				onSelect={handleSelect}
				passageLocks={passageLocks}
				passages={mapPassages}
				tagColors={tagColors}
				tagDisplay={tagDisplay}
			/>
		</div>
	);
};
