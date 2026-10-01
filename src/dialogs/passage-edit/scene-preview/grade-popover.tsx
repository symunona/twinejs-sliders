/**
 * The Grade popover: the asset editor's colour sliders, for ONE sprite in ONE scene (spec
 * 02, "Colour grade").
 *
 * Works in whole grades — the value each slider shows is what is on screen — and hands
 * every change up as a whole grade. Where that lands, and as how few keys, is the parent's
 * business (`grade-write.ts`): the same slider means "this beat" or "the whole scene"
 * depending on the scrubber, and the popover should not have to know which.
 *
 * Portalled to the body with a real z-index, like `MenuButton`: the selection row sits in
 * the stage's stacking context and anything drawn in place would paint under the full-screen
 * editor. Its class is in `OWN_PRESS_SELECTOR`, so a press on it never reaches the stage
 * (React bubbles a portal's events up the React tree, `.claude/TRAPS.md`).
 */

import {IconArrowBackUp} from '@tabler/icons';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {usePopper} from 'react-popper';
import {useTranslation} from 'react-i18next';
import {
	GRADE_KEYS,
	GRADE_RANGES,
	gradeLevel,
	gradeNeutral,
	normalizeGrade
} from '@sliders/scene-types';
import type {EntityGrade, GradeKey} from '@sliders/scene-types';
import {IconButton} from '../../../components/control/icon-button';
import {AdjustSlider} from '../../asset-editor/adjust-slider';
import './grade-popover.css';

export interface GradePopoverProps {
	/** What the popover hangs off: the Grade button. */
	anchor: HTMLElement | null;
	/** The grade on screen. Undefined is ungraded. */
	grade: EntityGrade | undefined;
	/** Every slider move, as the WHOLE grade it leaves on screen. */
	onChange: (grade: EntityGrade | undefined) => void;
	/**
	 * A slider let go of, a number typed, a reset clicked: the moment to WRITE. `onChange`
	 * only paints — a drag through forty values is one edit, not forty.
	 */
	onCommit: () => void;
	onClose: () => void;
	/** Where the next write lands, said in words. */
	note?: string;
	/** Extra controls for the footer — the Match bg button. */
	footer?: React.ReactNode;
}

/** The asset editor's own label for each key, where it has one. */
const LABEL_KEYS: Record<GradeKey, string> = {
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

export const GradePopover: React.FC<GradePopoverProps> = props => {
	const {anchor, footer, grade, note, onChange, onClose, onCommit} = props;
	const {t} = useTranslation();
	const [cardEl, setCardEl] = React.useState<HTMLDivElement | null>(null);
	const {attributes, styles} = usePopper(anchor, cardEl, {
		// Beside the button, not below it: the panel is taller than a docked stage, and on
		// a side placement Popper's overflow guard slides it up and down to stay on screen
		// (below, it would only ever slide sideways and hang off the bottom). Left first,
		// because the selection row ends at the stage's right edge.
		modifiers: [
			{name: 'flip', options: {fallbackPlacements: ['right-start', 'bottom-end']}},
			{name: 'preventOverflow', options: {padding: 8}}
		],
		placement: 'left-start',
		strategy: 'fixed'
	});
	// Through refs so the listeners live exactly as long as the popover, whatever the
	// caller passes — see `MenuButton` on inline arrows re-registering mid-dispatch.
	const onCloseRef = React.useRef(onClose);
	const onCommitRef = React.useRef(onCommit);

	onCloseRef.current = onClose;
	onCommitRef.current = onCommit;

	// A range input fires `input` all the way through a drag and `change` once, on release;
	// a number box fires `change` on Enter or blur. Native rather than React's `onChange`,
	// which is `input` in disguise. Deferred a tick so the last `onChange` has landed —
	// React 16 handles its events at the document, after this element's own listeners.
	React.useEffect(() => {
		if (!cardEl) {
			return;
		}

		const later = () => window.setTimeout(() => onCommitRef.current(), 0);
		const onClick = (event: MouseEvent) => {
			if ((event.target as Element | null)?.closest?.('button')) {
				later();
			}
		};

		cardEl.addEventListener('change', later);
		cardEl.addEventListener('click', onClick);

		return () => {
			cardEl.removeEventListener('change', later);
			cardEl.removeEventListener('click', onClick);
		};
	}, [cardEl]);

	React.useEffect(() => {
		const doc = anchor?.ownerDocument ?? document;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				onCloseRef.current();
			}
		};
		const onPress = (event: PointerEvent) => {
			const target = event.target as Node | null;

			if (
				target &&
				(cardEl?.contains(target) || anchor?.contains(target))
			) {
				return;
			}

			onCloseRef.current();
		};

		doc.addEventListener('keydown', onKey, true);
		doc.addEventListener('pointerdown', onPress, true);

		return () => {
			doc.removeEventListener('keydown', onKey, true);
			doc.removeEventListener('pointerdown', onPress, true);
		};
	}, [anchor, cardEl]);

	function change(key: GradeKey, value: number) {
		onChange(normalizeGrade({...grade, [key]: value}));
	}

	return createPortal(
		<div
			aria-label={t('dialogs.passageEdit.scenePreview.grade.title')}
			className="scene-grade-popover"
			data-testid="scene-grade-popover"
			ref={setCardEl}
			role="dialog"
			style={styles.popper}
			{...attributes.popper}
		>
			<div className="scene-grade-popover-head">
				<span className="scene-grade-popover-title">
					{t('dialogs.passageEdit.scenePreview.grade.title')}
				</span>
				{note && <span className="scene-grade-popover-note">{note}</span>}
			</div>
			<div className="scene-grade-popover-sliders">
				{GRADE_KEYS.map(key => (
					<AdjustSlider
						key={key}
						label={t(LABEL_KEYS[key])}
						max={GRADE_RANGES[key].max}
						min={GRADE_RANGES[key].min}
						onChange={value => change(key, value)}
						resetLabel={t('dialogs.assetEditor.reset')}
						resetTo={gradeNeutral(key)}
						step={GRADE_RANGES[key].step}
						value={gradeLevel(grade, key)}
					/>
				))}
			</div>
			<div className="scene-grade-popover-foot">
				{footer}
				<IconButton
					disabled={!normalizeGrade(grade)}
					icon={<IconArrowBackUp />}
					label={t('dialogs.passageEdit.scenePreview.grade.resetAll')}
					onClick={() => onChange(undefined)}
				/>
			</div>
		</div>,
		anchor?.ownerDocument.body ?? document.body
	);
};
