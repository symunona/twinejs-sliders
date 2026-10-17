import {IconAlertTriangle, IconMoodSmile, IconX} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {SceneFix} from '@sliders/scene-types';
import {IconButton} from '../../../components/control/icon-button';
import {SceneErrors} from '../scene-errors/scene-errors';
import type {LinkTargetError} from './validate-links';
import './scene-error-badge.css';

export interface SceneErrorBadgeProps {
	errors: LinkTargetError[];
	onToggle: () => void;
	open: boolean;
}

/**
 * The scene's health, in the stage's top-right corner: red count for errors, yellow for
 * warnings, a green smiley when there are neither. Notes (`info`) do not count -- an old
 * spelling that still works is not a reason to look worried.
 *
 * A glance, not the list. The list is the sidebar it opens.
 */
export const SceneErrorBadge: React.FC<SceneErrorBadgeProps> = ({
	errors,
	onToggle,
	open
}) => {
	const {t} = useTranslation();
	const errorCount = errors.filter(one => one.severity === 'error').length;
	const warningCount = errors.filter(one => one.severity === 'warning').length;
	const clean = errorCount === 0 && warningCount === 0;
	const label = clean
		? t('dialogs.passageEdit.scenePreview.errorBadge.none')
		: t('dialogs.passageEdit.scenePreview.errorBadge.some', {
				errors: errorCount,
				warnings: warningCount
		  });

	return (
		<button
			aria-label={label}
			aria-pressed={open}
			className={classNames('scene-error-badge', {
				clean,
				errors: errorCount > 0,
				open
			})}
			data-testid="scene-error-badge"
			onClick={onToggle}
			title={label}
			type="button"
		>
			{clean ? <IconMoodSmile /> : <IconAlertTriangle />}
			{warningCount > 0 && (
				<span
					className="scene-error-badge-count warnings"
					data-testid="scene-error-badge-warnings"
				>
					{warningCount}
				</span>
			)}
			{errorCount > 0 && (
				<span
					className="scene-error-badge-count errors"
					data-testid="scene-error-badge-errors"
				>
					{errorCount}
				</span>
			)}
		</button>
	);
};

export interface SceneErrorPanelProps {
	errors: LinkTargetError[];
	onApplyFix?: (fix: SceneFix) => void;
	onClose: () => void;
	onCreatePassage?: (name: string) => void;
	onGoToLine?: (line: number) => void;
}

/**
 * The scene's error list in the stage's side slot, where the layers and beat panels
 * stand. The same `SceneErrors` the passage editor shows under its text, open from the
 * start: the author asked for it by clicking the badge.
 */
export const SceneErrorPanel: React.FC<SceneErrorPanelProps> = ({
	onClose,
	...other
}) => {
	const {t} = useTranslation();

	return (
		<div className="scene-error-panel" data-testid="scene-error-panel">
			<div className="scene-error-panel-title">
				<span>{t('dialogs.passageEdit.scenePreview.errorBadge.title')}</span>
				<IconButton
					icon={<IconX />}
					iconOnly
					label={t('common.close')}
					onClick={onClose}
				/>
			</div>
			<SceneErrors defaultOpen {...other} />
		</div>
	);
};
