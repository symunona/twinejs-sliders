import {AssetId, DEFAULT_FIT, Frac2, FrameFit} from '@sliders/scene-types';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useArtRect} from '../../components/anchor';
import {useAssetUrl} from '../sliders-assets/asset-store-context';
import {containRect, fractionLimits} from './sprite-geometry';

/** Handle identity: either the origin cross, or a named anchor dot. */
type HandleId = {kind: 'origin'} | {kind: 'anchor'; name: string};

/** A frame shown faintly behind the selected one, to check registration between poses. */
export interface SpriteGhost {
	assetId?: AssetId;
	/** The ghost's OWN fit — aligning against an unaligned reference proves nothing. */
	fit?: FrameFit;
	name: string;
}

export interface SpritePreviewProps {
	anchors: Record<string, Frac2>;
	assetId?: AssetId;
	/** The selected frame's registration transform. Absent frame means no panning. */
	fit?: FrameFit;
	/** Other frames to draw behind this one, half faded. */
	ghosts?: SpriteGhost[];
	onChangeAnchor: (name: string, value: Frac2) => void;
	onChangeFit?: (fit: FrameFit) => void;
	onChangeOrigin: (value: Frac2) => void;
	/** Called when a drag or nudge finishes, so the change can be written out at once. */
	onCommit: () => void;
	/** Called after a pick lands, so picking can go back off. One click, one anchor. */
	onPickEnd?: () => void;
	origin: Frac2;
	/**
	 * True while a click anywhere on the sprite places the origin, rather than panning the
	 * frame. Driven by the anchor selector's custom mode, so placing an origin works the
	 * same here as it does in the asset editor.
	 */
	picking?: boolean;
	size: {w: number; h: number};
}

/** Three decimals is finer than anyone can drag, and keeps the manifest readable. */
function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/**
 * Same precision, but a fit offset runs either side of zero, so it cannot use the clamp
 * the box implies. A whole box in each direction is far more than registration ever needs
 * and still stops a stray drag from flinging a frame out of reach.
 */
function roundOffset(value: number): number {
	return Math.round(Math.min(1, Math.max(-1, value)) * 1000) / 1000;
}

function percent(value: number): string {
	return `${value * 100}%`;
}

function handleKey(handle: HandleId): string {
	return handle.kind === 'origin' ? 'origin' : `anchor:${handle.name}`;
}

/** One faded frame behind the selected one. Its own component, because URLs are a hook. */
const GhostFrame: React.FC<{fitStyle: React.CSSProperties; ghost: SpriteGhost}> =
	props => {
		const {fitStyle, ghost} = props;
		const url = useAssetUrl(ghost.assetId);

		if (!url) {
			return null;
		}

		return (
			<img alt="" className="sprite-ghost" src={url} style={fitStyle} />
		);
	};

/**
 * The sprite with its draggable origin cross and anchor dots.
 *
 * Everything here is stored as a FRACTION of the frame, never pixels (spec 04). That's
 * what lets uniform sizes today become per-frame sizes tomorrow without the scene YAML
 * changing. Fractions are not clamped to 0..1: art routinely spills outside the box, and a
 * hat brim or a sword tip is a fair place to pin an anchor. Handles run to the edges of the
 * preview area instead.
 */
export const SpritePreview: React.FC<SpritePreviewProps> = props => {
	const {
		anchors,
		assetId,
		fit,
		ghosts,
		onChangeAnchor,
		onChangeFit,
		onChangeOrigin,
		onCommit,
		onPickEnd,
		origin,
		picking,
		size
	} = props;
	const area = React.useRef<HTMLDivElement>(null);
	const art = React.useRef<HTMLImageElement>(null);
	const frame = React.useRef<HTMLDivElement>(null);
	const [dragging, setDragging] = React.useState<HandleId>();
	/** The selected frame's own pixels, for drawing an outline around the art itself. */
	const [natural, setNatural] = React.useState<{height: number; width: number}>();
	/** Where a pan started: pointer position, and the offset it began from. */
	const [panning, setPanning] = React.useState<{
		from: Frac2;
		x: number;
		y: number;
	}>();
	const url = useAssetUrl(assetId);
	const {t} = useTranslation();

	/**
	 * A cached blob URL can finish loading before React has attached its `onLoad`, so the
	 * size is read here as well — otherwise the outline never appears on a frame the
	 * editor has already shown once.
	 */
	React.useEffect(() => {
		const el = art.current;

		if (!url) {
			setNatural(undefined);
		} else if (el?.complete && el.naturalWidth > 0) {
			setNatural({height: el.naturalHeight, width: el.naturalWidth});
		}
	}, [url]);

	const activeFit = fit ?? DEFAULT_FIT;
	const canFit = !!onChangeFit && !!url;
	const artBox = useArtRect(art, frame);
	const artRect = natural && artBox ? containRect(natural, artBox) : undefined;

	/**
	 * Fit rides on the image alone, so the guides, handles and ghost frames stay put — you
	 * are aligning art to the rig, not dragging the rig around. Scaling about the origin
	 * keeps the feet planted, and the translate percentages read as fractions of the box
	 * because the image is stretched across it. Matches `applyFit` in the DOM renderer.
	 */
	function fitStyle(value: FrameFit): React.CSSProperties {
		return {
			transform: `translate(${value.offset.x * 100}%, ${
				value.offset.y * 100
			}%) scale(${value.scale})`,
			transformOrigin: `${origin.x * 100}% ${origin.y * 100}%`
		};
	}

	/**
	 * A fraction may leave the box, but not the part of the preview the author can see:
	 * a handle dropped past the edge would be unreachable afterwards.
	 */
	const clampToArea = React.useCallback((value: Frac2): Frac2 => {
		const box = frame.current?.getBoundingClientRect();
		const bounds = area.current?.getBoundingClientRect();

		if (!box || !bounds) {
			return value;
		}

		const limits = fractionLimits(box, bounds);

		return {
			x: round(Math.min(limits.maxX, Math.max(limits.minX, value.x))),
			y: round(Math.min(limits.maxY, Math.max(limits.minY, value.y)))
		};
	}, []);

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
			move(
				dragging!,
				clampToArea({
					x: (event.clientX - bounds.left) / bounds.width,
					y: (event.clientY - bounds.top) / bounds.height
				})
			);
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
	}, [clampToArea, dragging, move, onCommit]);

	// Held in a ref so the pan listeners aren't torn down and rebuilt on every mousemove.
	const fitRef = React.useRef(activeFit);

	fitRef.current = activeFit;

	React.useEffect(() => {
		if (!panning || !onChangeFit) {
			return;
		}

		function handleMouseMove(event: MouseEvent) {
			const bounds = frame.current?.getBoundingClientRect();

			if (!bounds || bounds.width === 0 || bounds.height === 0) {
				return;
			}

			event.preventDefault();
			onChangeFit!({
				...fitRef.current,
				offset: {
					x: roundOffset(
						panning!.from.x + (event.clientX - panning!.x) / bounds.width
					),
					y: roundOffset(
						panning!.from.y + (event.clientY - panning!.y) / bounds.height
					)
				}
			});
		}

		function handleMouseUp() {
			setPanning(undefined);
			onCommit();
		}

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);

		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, [onChangeFit, onCommit, panning]);

	/**
	 * Dragging anywhere that isn't a handle pans the frame. No modifier key: the handles
	 * are the only other thing in here, and they take their own mousedown first.
	 */
	function handlePanStart(event: React.MouseEvent) {
		if ((event.target as HTMLElement).closest('.sprite-handle')) {
			return;
		}

		// Picking beats panning, and works with no frame loaded: the origin belongs to the
		// character, and a character with no art still has one.
		if (picking) {
			const bounds = frame.current?.getBoundingClientRect();

			if (!bounds || bounds.width === 0 || bounds.height === 0) {
				return;
			}

			event.preventDefault();
			onChangeOrigin(
				clampToArea({
					x: (event.clientX - bounds.left) / bounds.width,
					y: (event.clientY - bounds.top) / bounds.height
				})
			);
			onCommit();
			onPickEnd?.();
			return;
		}

		if (!canFit) {
			return;
		}

		event.preventDefault();
		setPanning({from: activeFit.offset, x: event.clientX, y: event.clientY});
	}

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
		move(handle, clampToArea({x: value.x + delta.x, y: value.y + delta.y}));
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
		<div className="sprite-preview" ref={area}>
			<div
				className={classNames('sprite-preview-frame', {
					pannable: canFit && !picking,
					panning: !!panning,
					picking
				})}
				onMouseDown={handlePanStart}
				ref={frame}
				style={{aspectRatio: `${size.w} / ${size.h}`}}
			>
				{(ghosts ?? []).map(ghost => (
					<GhostFrame
						fitStyle={fitStyle(ghost.fit ?? DEFAULT_FIT)}
						ghost={ghost}
						key={ghost.name}
					/>
				))}
				{url ? (
					<img
						alt={t('dialogs.slidersCharacters.previewAlt')}
						onLoad={event =>
							setNatural({
								height: event.currentTarget.naturalHeight,
								width: event.currentTarget.naturalWidth
							})
						}
						ref={art}
						src={url}
						style={fitStyle(activeFit)}
					/>
				) : (
					<div className="sprite-preview-empty">
						{t('dialogs.slidersCharacters.noFrame')}
					</div>
				)}

				{/* The art's own edges, which `object-fit: contain` puts inside the box
				    rather than on it. Follows the fit, so it reads as this frame's outline
				    even after a pan or a scale. */}
				{artRect && (
					<div
						className="sprite-art-outline"
						data-testid="sprite-art-outline"
						style={{
							...fitStyle(activeFit),
							height: artRect.height,
							left: artRect.left,
							top: artRect.top,
							width: artRect.width
						}}
					/>
				)}

				{/* The box every frame is registered into: the character's own size, the
				    thing scenes lay out with. Labelled, because a rectangle alone does not
				    say which of the two rectangles on screen it is. */}
				<span className="sprite-box-label">
					{t('dialogs.slidersCharacters.boxLabel', {height: size.h, width: size.w})}
				</span>

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
