import {
	IconAlertTriangle,
	IconChevronDown,
	IconChevronRight
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {SceneError} from '@sliders/scene-types';
import './scene-errors.css';

export interface SceneErrorsProps {
	errors: SceneError[];
	/** Clicking an error jumps the editor to its line. */
	onGoToLine?: (line: number) => void;
}

/**
 * The scene's problem list, directly under the passage text (spec 06).
 *
 * An accordion, closed by default: a scene is broken for as long as it takes to type the
 * next character, and a list that opened itself would push the editor around while the
 * author writes. Closed, it is one line that says whether the scene is good — which is
 * what an author glances at — and opens on demand for the detail.
 */
export const SceneErrors: React.FC<SceneErrorsProps> = ({
	errors,
	onGoToLine
}) => {
	const [open, setOpen] = React.useState(false);
	const {t} = useTranslation();
	const errorCount = errors.filter(one => one.severity === 'error').length;
	const warningCount = errors.length - errorCount;
	const clean = errors.length === 0;

	// Nothing to open when the scene is clean, so the header stops being a button.
	const label = clean
		? t('dialogs.passageEdit.sceneErrors.valid')
		: errorCount > 0
		? t('dialogs.passageEdit.sceneErrors.showErrors', {count: errorCount})
		: t('dialogs.passageEdit.sceneErrors.showWarnings', {count: warningCount});

	return (
		<div
			className={classNames('scene-errors', {clean, open: open && !clean})}
			data-testid="scene-errors"
		>
			<button
				aria-expanded={clean ? undefined : open}
				className="scene-errors-header"
				data-testid="scene-errors-header"
				disabled={clean}
				onClick={() => setOpen(value => !value)}
				type="button"
			>
				{!clean && (
					<>
						{open ? <IconChevronDown /> : <IconChevronRight />}
						<IconAlertTriangle />
					</>
				)}
				<span className="scene-errors-label">{label}</span>
			</button>
			{open && !clean && (
				<ul className="scene-preview-errors" data-testid="scene-preview-errors">
					{errors.map((error, index) => (
						<li
							className={error.severity}
							key={`${error.code}-${index}`}
							onClick={() => onGoToLine?.(error.line)}
						>
							<span className="line">{error.line}</span>
							<span className="message">{error.message}</span>
							{error.hint && <span className="hint">{error.hint}</span>}
						</li>
					))}
				</ul>
			)}
		</div>
	);
};
