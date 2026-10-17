/**
 * The Grade sliders: the asset editor's colour sliders, for ONE sprite in ONE scene (spec
 * 02, "Colour grade"). Drawn inline at the foot of the sidebar's selection tab.
 *
 * Works in whole grades — the value each slider shows is what is on screen — and hands
 * every change up as a whole grade. Where that lands, and as how few keys, is the parent's
 * business (`grade-write.ts`): the same slider means "this beat" or "the whole scene"
 * depending on the scrubber, and the sliders should not have to know which.
 */

import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	GRADE_KEYS,
	GRADE_RANGES,
	gradeLevel,
	gradeNeutral,
	normalizeGrade
} from '@sliders/scene-types';
import type {EntityGrade, GradeKey} from '@sliders/scene-types';
import {AdjustSlider} from '../../asset-editor/adjust-slider';
import './grade-sliders.css';

export interface GradeSlidersProps {
	/** The grade on screen. Undefined is ungraded. */
	grade: EntityGrade | undefined;
	/** Every slider move, as the WHOLE grade it leaves on screen. */
	onChange: (grade: EntityGrade | undefined) => void;
	/**
	 * A slider let go of, a number typed, a slider's own reset clicked: the moment to WRITE.
	 * `onChange` only paints — a drag through forty values is one edit, not forty.
	 */
	onCommit: () => void;
	/** The pointer is over one slider's row, or over none (`null`). */
	onHoverKey?: (key: GradeKey | null) => void;
	/** Where the next write lands, said in words. */
	note?: string;
}

/** The asset editor's own label for each key, where it has one. */
export const GRADE_LABEL_KEYS: Record<GradeKey, string> = {
	blur: 'dialogs.passageEdit.scenePreview.grade.blur',
	brightness: 'dialogs.assetEditor.brightness',
	contrast: 'dialogs.assetEditor.contrast',
	gamma: 'dialogs.assetEditor.gamma',
	highlights: 'dialogs.assetEditor.highlights',
	hue: 'dialogs.assetEditor.hue',
	pop: 'dialogs.assetEditor.pop',
	saturation: 'dialogs.assetEditor.saturation',
	shadows: 'dialogs.assetEditor.shadows',
	tint: 'dialogs.assetEditor.tint',
	warmth: 'dialogs.assetEditor.warmth'
};

export const GradeSliders: React.FC<GradeSlidersProps> = props => {
	const {grade, note, onChange, onCommit, onHoverKey} = props;
	const {t} = useTranslation();
	const [el, setEl] = React.useState<HTMLDivElement | null>(null);
	// Through a ref so the listeners live exactly as long as the element, whatever the
	// caller passes — see `MenuButton` on inline arrows re-registering mid-dispatch.
	const onCommitRef = React.useRef(onCommit);

	onCommitRef.current = onCommit;

	// A range input fires `input` all the way through a drag and `change` once, on release;
	// a number box fires `change` on Enter or blur. Native rather than React's `onChange`,
	// which is `input` in disguise. Deferred a tick so the last `onChange` has landed —
	// React 16 handles its events at the document, after this element's own listeners.
	React.useEffect(() => {
		if (!el) {
			return;
		}

		const later = () => window.setTimeout(() => onCommitRef.current(), 0);
		const onClick = (event: MouseEvent) => {
			if ((event.target as Element | null)?.closest?.('button')) {
				later();
			}
		};

		el.addEventListener('change', later);
		el.addEventListener('click', onClick);

		return () => {
			el.removeEventListener('change', later);
			el.removeEventListener('click', onClick);
		};
	}, [el]);

	function change(key: GradeKey, value: number) {
		onChange(normalizeGrade({...grade, [key]: value}));
	}

	return (
		<div
			aria-label={t('dialogs.passageEdit.scenePreview.grade.title')}
			className="scene-grade-sliders"
			data-testid="scene-grade-sliders"
			onPointerLeave={() => onHoverKey?.(null)}
			ref={setEl}
			role="group"
		>
			<div className="scene-grade-sliders-head">
				<span className="scene-grade-sliders-title">
					{t('dialogs.passageEdit.scenePreview.grade.title')}
				</span>
				{note && <span className="scene-grade-sliders-note">{note}</span>}
			</div>
			{GRADE_KEYS.map(key => (
				<div
					className="scene-grade-sliders-row"
					data-grade-key={key}
					key={key}
					onPointerEnter={() => onHoverKey?.(key)}
				>
					<AdjustSlider
						label={t(GRADE_LABEL_KEYS[key])}
						max={GRADE_RANGES[key].max}
						min={GRADE_RANGES[key].min}
						onChange={value => change(key, value)}
						resetLabel={t('dialogs.assetEditor.reset')}
						resetTo={gradeNeutral(key)}
						step={GRADE_RANGES[key].step}
						value={gradeLevel(grade, key)}
					/>
				</div>
			))}
		</div>
	);
};
