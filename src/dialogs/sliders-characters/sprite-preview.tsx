import {AssetId, Frac2} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useAssetUrl} from '../sliders-assets/asset-store-context';

/** Handle identity: either the origin cross, or a named anchor dot. */
type HandleId = {kind: 'origin'} | {kind: 'anchor'; name: string};

export interface SpritePreviewProps {
	anchors: Record<string, Frac2>;
	assetId?: AssetId;
	/** Frame drawn faintly underneath, to check registration between poses. */
	onionAssetId?: AssetId;
	onChangeAnchor: (name: string, value: Frac2) => void;
	onChangeOrigin: (value: Frac2) => void;
	/** Called when a drag or nudge finishes, so the change can be written out at once. */
	onCommit: () => void;
	origin: Frac2;
	size: {w: number; h: number};
}

function clamp(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Three decimals is finer than anyone can drag, and keeps the manifest readable. */
function round(value: number): number {
	return Math.round(clamp(value) * 1000) / 1000;
}

function percent(value: number): string {
	return `${clamp(value) * 100}%`;
}

function handleKey(handle: HandleId): string {
	return handle.kind === 'origin' ? 'origin' : `anchor:${handle.name}`;
}

/**
 * The sprite with its draggable origin cross and anchor dots.
 *
 * Everything here is stored as a FRACTION of the frame, never pixels (spec 04). That's
 * what lets uniform sizes today become per-frame sizes tomorrow without the scene YAML
 * changing.
 */
export const SpritePreview: React.FC<SpritePreviewProps> = props => {
	const {
		anchors,
		assetId,
		onChangeAnchor,
		onChangeOrigin,
		onCommit,
		onionAssetId,
		origin,
		size
	} = props;
	const frame = React.useRef<HTMLDivElement>(null);
	const [dragging, setDragging] = React.useState<HandleId>();
	const url = useAssetUrl(assetId);
	const onionUrl = useAssetUrl(onionAssetId);
	const {t} = useTranslation();

	const move = React.useCallback(
		(handle: HandleId, value: Frac2) => {
			if (handle.kind === 'origin') {
				onChangeOrigin(value);
			} else {
				onChangeAnchor(handle.name, value);
			}
		},
		[onChangeAnchor, onChangeOrigin]
	);

	React.useEffect(() => {
		if (!dragging) {
			return;
		}

		function handleMouseMove(event: MouseEvent) {
			const bounds = frame.current?.getBoundingClientRect();

			if (!bounds || bounds.width === 0 || bounds.height === 0) {
				return;
			}

			event.preventDefault();
			move(dragging!, {
				x: round((event.clientX - bounds.left) / bounds.width),
				y: round((event.clientY - bounds.top) / bounds.height)
			});
		}

		function handleMouseUp() {
			setDragging(undefined);
			onCommit();
		}

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);

		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, [dragging, move, onCommit]);

	function handleKeyDown(
		event: React.KeyboardEvent,
		handle: HandleId,
		value: Frac2
	) {
		const step = event.shiftKey ? 0.001 : 0.01;
		const deltas: Record<string, Frac2> = {
			ArrowDown: {x: 0, y: step},
			ArrowLeft: {x: -step, y: 0},
			ArrowRight: {x: step, y: 0},
			ArrowUp: {x: 0, y: -step}
		};
		const delta = deltas[event.key];

		if (!delta) {
			return;
		}

		event.preventDefault();
		move(handle, {x: round(value.x + delta.x), y: round(value.y + delta.y)});
		onCommit();
	}

	function renderHandle(handle: HandleId, value: Frac2, label: string) {
		const key = handleKey(handle);

		return (
			<button
				aria-label={label}
				className={classNames('sprite-handle', `sprite-handle-${handle.kind}`, {
					dragging: dragging && handleKey(dragging) === key
				})}
				data-handle={key}
				data-x={value.x}
				data-y={value.y}
				key={key}
				onKeyDown={event => handleKeyDown(event, handle, value)}
				onMouseDown={event => {
					event.preventDefault();
					setDragging(handle);
				}}
				style={{left: percent(value.x), top: percent(value.y)}}
				title={`${label} ${value.x.toFixed(3)}, ${value.y.toFixed(3)}`}
				type="button"
			>
				<span className="sprite-handle-label">
					{handle.kind === 'origin' ? '' : handle.name}
				</span>
			</button>
		);
	}

	return (
		<div className="sprite-preview">
			<div
				className="sprite-preview-frame"
				ref={frame}
				style={{aspectRatio: `${size.w} / ${size.h}`}}
			>
				{onionUrl && (
					<img alt="" className="sprite-onion" src={onionUrl} />
				)}
				{url ? (
					<img alt={t('dialogs.slidersCharacters.previewAlt')} src={url} />
				) : (
					<div className="sprite-preview-empty">
						{t('dialogs.slidersCharacters.noFrame')}
					</div>
				)}

				{/* Centre and floor guides, so the origin makes visual sense. */}
				<div className="sprite-guide vertical" style={{left: percent(origin.x)}} />
				<div className="sprite-guide floor" style={{top: percent(origin.y)}} />

				{Object.entries(anchors).map(([name, value]) =>
					renderHandle({kind: 'anchor', name}, value, name)
				)}
				{renderHandle(
					{kind: 'origin'},
					origin,
					t('dialogs.slidersCharacters.origin')
				)}
			</div>
		</div>
	);
};
