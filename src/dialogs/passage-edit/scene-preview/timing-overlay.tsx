/**
 * The timing overlay: the whole scene on the player's clock, drawn over the stage.
 *
 * A debugging view for "why does this beat take so long / move at once / wait here". One
 * group per thing that moves, one row per kind of change, the lines as `say` rows. Beat
 * boundaries say how the beat hands over: dashed = auto-advance, double + mouse = waits for
 * a click, plain = a timer or the end of its own animation.
 *
 * Reads `timingLayout(sceneTimeline(…))` — the same schedule the play button runs, so what
 * it draws is what plays. Live: retime a beat in the panel beside it and the bars move.
 */

import {IconMouse, IconX} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import type {TimingLayout} from './timing-layout';
import './timing-overlay.css';

export interface TimingOverlayProps {
	layout: TimingLayout;
	/** Scrubber position: state N is produced by beat N - 1. */
	beat: number;
	onBeatChange: (beat: number) => void;
	onClose: () => void;
}

/** Percent of the scene's length, for `left` / `width`. */
function pct(seconds: number, total: number): string {
	return `${total > 0 ? (seconds / total) * 100 : 0}%`;
}

function seconds(value: number): string {
	return `${Math.round(value * 100) / 100}s`;
}

export const TimingOverlay: React.FC<TimingOverlayProps> = ({
	beat,
	layout,
	onBeatChange,
	onClose
}) => {
	const {t} = useTranslation();
	const {columns, groups, total} = layout;
	const label = (key: string, options?: Record<string, unknown>) =>
		t(`dialogs.passageEdit.scenePreview.timing.${key}`, options);
	const advanceLabel = (advance: string) => label(`advance.${advance}`);

	React.useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				onClose();
			}
		};

		window.addEventListener('keydown', onKey, true);

		return () => window.removeEventListener('keydown', onKey, true);
	}, [onClose]);

	// Behind every row: the beat columns, the current one lit, and the line each one ends on.
	const grid = (
		<div aria-hidden className="timing-grid">
			{columns.map(column => (
				<div
					className={classNames('timing-column', {
						current: column.beat === beat - 1
					})}
					key={column.beat}
					style={{left: pct(column.start, total), width: pct(column.length, total)}}
				>
					<span className={`timing-edge advance-${column.advance}`} />
				</div>
			))}
		</div>
	);

	return (
		<div
			className="timing-overlay"
			data-testid="timing-overlay"
			onPointerDown={event => event.stopPropagation()}
			role="dialog"
			aria-label={label('title')}
		>
			<div className="timing-overlay-head">
				<strong>{label('title')}</strong>
				<span className="timing-overlay-total">{seconds(total)}</span>
				<span className="timing-legend">
					<span className="timing-legend-item">
						<span className="timing-legend-line advance-auto" />
						{advanceLabel('auto')}
					</span>
					<span className="timing-legend-item">
						<span className="timing-legend-line advance-reader" />
						<IconMouse size={14} />
						{advanceLabel('reader')}
					</span>
					<span className="timing-legend-item">
						<span className="timing-legend-line advance-timer" />
						{label('legendPlain')}
					</span>
				</span>
				<IconButton
					icon={<IconX />}
					iconOnly
					label={t('common.close')}
					onClick={onClose}
				/>
			</div>
			{columns.length === 0 ? (
				<p className="timing-overlay-empty">{label('empty')}</p>
			) : (
				<div className="timing-overlay-body">
					<div className="timing-row timing-header">
						<span className="timing-row-label" />
						<div className="timing-track">
							{grid}
							{columns.map(column => (
								<button
									className={classNames('timing-beat', {
										current: column.beat === beat - 1
									})}
									data-testid="timing-beat"
									key={column.beat}
									onClick={() => onBeatChange(column.beat + 1)}
									style={{
										left: pct(column.start, total),
										width: pct(column.length, total)
									}}
									title={label('beatTitle', {
										advance: advanceLabel(column.advance),
										beat: column.beat + 1,
										length: seconds(column.length)
									})}
									type="button"
								>
									{column.beat + 1}
									{column.advance === 'reader' && (
										<IconMouse className="timing-beat-mouse" size={13} />
									)}
								</button>
							))}
						</div>
					</div>
					{groups.map(group => (
						<div
							className="timing-group"
							data-testid="timing-group"
							data-group={group.id}
							key={`${group.special ?? 'e'}:${group.id}`}
						>
							<div className="timing-group-name">
								{group.special ? label(group.special) : group.id}
							</div>
							{group.rows.map(row => (
								<div
									className={`timing-row kind-${row.kind}`}
									data-testid="timing-row"
									data-kind={row.kind}
									key={row.kind}
								>
									<span className="timing-row-label">{row.kind}</span>
									<div className="timing-track">
										{grid}
										{row.bars.map(bar => (
											<span
												className={classNames('timing-bar', {
													snap: bar.duration === 0
												})}
												key={`${bar.beat}:${bar.start}`}
												style={{
													left: pct(bar.start, total),
													width: pct(bar.duration, total)
												}}
												title={
													bar.text ??
													label('barTitle', {
														beat: bar.beat + 1,
														kind: row.kind,
														length: seconds(bar.duration)
													})
												}
											>
												{bar.text}
											</span>
										))}
									</div>
								</div>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
};
