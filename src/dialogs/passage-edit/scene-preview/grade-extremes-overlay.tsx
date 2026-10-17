/**
 * What one grade slider can do, before it is dragged: the selected sprite drawn twice, at
 * that slider's two ends, every other key left where it is.
 *
 * A slider's name says little — `pop`, `gamma` and `highlights` are three words for
 * "brighter, somehow" — and its range says less. Seeing both ends answers the question the
 * author is actually asking, which is whether this is the slider they want.
 *
 * The picture is the renderer's own `<img>` source with the renderer's own filter
 * (`gradeFilter` / `holdGrade` from `render-dom`), so each thumbnail is exactly what the
 * stage would draw at that value — no second copy of the grade maths to drift from it.
 *
 * Portalled to the body with a real z-index, like `MenuButton`'s menu: the sidebar sits in
 * the stage view's stacking context, and a z-index inside it only sorts against siblings
 * (TRAPS, z-index collapse). `pointer-events: none`, so it can never take the hover that
 * keeps it open, nor a press the stage would otherwise get.
 */

import * as React from 'react';
import {createPortal} from 'react-dom';
import {usePopper} from 'react-popper';
import {useTranslation} from 'react-i18next';
import {GRADE_PX_VAR, gradeFilter, holdGrade} from '@sliders/render-dom';
import {GRADE_RANGES, normalizeGrade} from '@sliders/scene-types';
import type {EntityGrade, GradeKey} from '@sliders/scene-types';
import {GRADE_LABEL_KEYS} from './grade-sliders';
import './grade-extremes-overlay.css';

/** Longest side of one thumbnail, CSS px. */
export const EXTREME_THUMB = 140;

export interface GradeExtremesOverlayProps {
	/** The hovered slider's row. The overlay hangs off its left side. */
	anchor: HTMLElement | null;
	/**
	 * The sprite's live picture on the stage. Absent — a placeholder, art still loading —
	 * draws nothing: a grey box at two grades is two grey boxes.
	 */
	art: HTMLImageElement | undefined;
	/** Drawn mirrored, as on the stage. */
	flip?: boolean;
	/** The grade on screen. The hovered key is overridden, the rest kept. */
	grade: EntityGrade | undefined;
	/** The hovered key. `null` draws nothing. */
	gradeKey: GradeKey | null;
}

/**
 * One end of the slider: the art under the grade it would leave on screen.
 *
 * `gradeFilter` in render for the CSS (pure); `holdGrade` in a layout effect so the SVG half
 * of a curve grade is in the document for as long as the thumbnail shows, and released the
 * moment it changes — the same counted hold the stage uses, so a shared grade is one filter.
 */
const Extreme: React.FC<{
	art: HTMLImageElement;
	flip?: boolean;
	grade: EntityGrade | undefined;
	label: string;
	value: number;
}> = ({art, flip, grade, label, value}) => {
	const css = gradeFilter(grade).css;
	const gradeRef = React.useRef(grade);

	gradeRef.current = grade;

	React.useLayoutEffect(() => {
		const handle = holdGrade(art.ownerDocument, gradeRef.current);

		return () => handle.release();
	}, [art, css]);

	// A grade's blur is in pixels of the art at its own size; this thumbnail draws it at
	// `scale` CSS px per art px, exactly the ratio the renderer writes on a stage sprite.
	const w = art.naturalWidth || EXTREME_THUMB;
	const h = art.naturalHeight || EXTREME_THUMB;
	const scale = Math.min(EXTREME_THUMB / w, EXTREME_THUMB / h);
	const style: React.CSSProperties & Record<string, string> = {
		filter: css || undefined,
		height: `${Math.round(h * scale)}px`,
		transform: flip ? 'scaleX(-1)' : undefined,
		width: `${Math.round(w * scale)}px`,
		[GRADE_PX_VAR]: String(Math.round(scale * 1e4) / 1e4)
	} as React.CSSProperties & Record<string, string>;

	return (
		<figure className="scene-grade-extreme" data-value={value}>
			{/* The checkerboard is the frame's, not the image's: a `filter` grades the
			    element's own background too, and would turn it black at brightness -100. */}
			<span className="scene-grade-extreme-frame">
				<img
					alt=""
					draggable={false}
					src={art.currentSrc || art.src}
					style={style}
				/>
			</span>
			<figcaption>{label}</figcaption>
		</figure>
	);
};

export const GradeExtremesOverlay: React.FC<
	GradeExtremesOverlayProps
> = props => {
	const {anchor, art, flip, grade, gradeKey} = props;
	const {t} = useTranslation();
	const [cardEl, setCardEl] = React.useState<HTMLDivElement | null>(null);
	const {attributes, styles} = usePopper(anchor, cardEl, {
		// Left, over the stage: the sidebar is at the right edge and the sliders are what the
		// author is reaching for, so covering them would defeat the point.
		modifiers: [
			{name: 'offset', options: {offset: [0, 12]}},
			{name: 'flip', options: {fallbackPlacements: ['left-start', 'left-end']}},
			{name: 'preventOverflow', options: {padding: 8}}
		],
		placement: 'left',
		strategy: 'fixed'
	});

	if (!gradeKey || !anchor || !art) {
		return null;
	}

	const {max, min} = GRADE_RANGES[gradeKey];

	return createPortal(
		<div
			aria-hidden="true"
			className="scene-grade-extremes"
			data-grade-key={gradeKey}
			data-testid="scene-grade-extremes"
			ref={setCardEl}
			style={styles.popper}
			{...attributes.popper}
		>
			<div className="scene-grade-extremes-title">
				{t(GRADE_LABEL_KEYS[gradeKey])}
			</div>
			<div className="scene-grade-extremes-pair">
				{(
					[
						['min', min],
						['max', max]
					] as const
				).map(([end, value]) => (
					<Extreme
						art={art}
						flip={flip}
						grade={normalizeGrade({...grade, [gradeKey]: value})}
						key={end}
						label={t(
							end === 'min'
								? 'dialogs.passageEdit.scenePreview.grade.extremeMin'
								: 'dialogs.passageEdit.scenePreview.grade.extremeMax',
							{value}
						)}
						value={value}
					/>
				))}
			</div>
		</div>,
		document.body
	);
};
