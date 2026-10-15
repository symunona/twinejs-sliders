/**
 * The beat panel: the beat the scrubber is on, edited beside the stage.
 *
 * Takes the layers panel's slot rather than stacking under it -- the view is one stage tall
 * and two lists in it would leave each a few rows. Words first, because they are what an
 * author changes most; then the beat's timing and bubble (`BeatProps` in its panel layout);
 * then the one story-wide act, handing this beat's look up as the story's default.
 *
 * The text box writes on blur and on Enter, never per keystroke: every write is a CodeMirror
 * edit, and one per character would fill the undo stack with half-words.
 */

import {IconTemplate, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {Beat} from '@sliders/scene-types';
import {ConfirmButton} from '../../../components/control/confirm-button';
import {IconButton} from '../../../components/control/icon-button';
import {BeatProps, BeatPropsProps} from './beat-props';
import './beat-panel.css';

export interface BeatPanelProps
	extends Omit<BeatPropsProps, 'layout' | 'beatCount'> {
	beatCount: number;
	/** The words, written back. Only called with text that differs from the beat's. */
	onSetText: (text: string) => void;
	onClose: () => void;
	/**
	 * Bumped to ask for the text box's focus -- a double click on the bubble. A counter so
	 * asking twice answers twice.
	 */
	focusText?: number;
	/**
	 * Hands this beat's bubble style up as the story's defaults. Absent when there is
	 * nothing to hand up, or nowhere to write it (no start passage).
	 */
	onMakeDefault?: () => void;
}

function wordsOf(beat: Beat | undefined): string | undefined {
	return beat?.kind === 'say' || beat?.kind === 'box' ? beat.text : undefined;
}

export const BeatPanel: React.FC<BeatPanelProps> = props => {
	const {
		beat,
		beatNumber,
		editable,
		focusText,
		onClose,
		onMakeDefault,
		onSetText,
		...rest
	} = props;
	const {t} = useTranslation();
	const words = wordsOf(beat);
	const [draft, setDraft] = React.useState<string>();
	const textArea = React.useRef<HTMLTextAreaElement>(null);

	// Whatever was typed is stale once the scrubber moves, or the text changes under it.
	React.useEffect(() => setDraft(undefined), [beat]);

	React.useEffect(() => {
		if (focusText) {
			textArea.current?.focus();
			textArea.current?.select();
		}
	}, [focusText]);

	function commit() {
		if (draft !== undefined && draft !== words) {
			onSetText(draft);
		}

		setDraft(undefined);
	}

	return (
		<div className="beat-panel" data-testid="beat-panel">
			<div className="beat-panel-title">
				<span className="beat-panel-which">
					{beatNumber === 0
						? t('dialogs.passageEdit.beatProps.arrival')
						: t('dialogs.passageEdit.beatProps.beat', {number: beatNumber})}
					{beat?.kind === 'say' && (
						<span className="beat-panel-who"> · {beat.who}</span>
					)}
				</span>
				<IconButton
					icon={<IconX />}
					iconOnly
					label={t('common.close')}
					onClick={onClose}
				/>
			</div>
			<div className="beat-panel-body">
				{words !== undefined && (
					<label className="beat-panel-text">
						<span className="beat-panel-text-label">
							{t('dialogs.passageEdit.beatProps.text')}
						</span>
						<textarea
							data-testid="beat-panel-text"
							disabled={!editable}
							onBlur={commit}
							onChange={event => setDraft(event.target.value)}
							onKeyDown={event => {
								// Enter writes, Shift+Enter is a line break inside the line.
								if (event.key === 'Enter' && !event.shiftKey) {
									event.preventDefault();
									commit();
								}

								if (event.key === 'Escape') {
									// Revert, and keep the dialog: Escape is the box's here.
									event.stopPropagation();
									setDraft(undefined);
								}
							}}
							ref={textArea}
							rows={3}
							value={draft ?? words}
						/>
					</label>
				)}
				<BeatProps
					{...rest}
					beat={beat}
					beatNumber={beatNumber}
					editable={editable}
					layout="panel"
				/>
			</div>
			{editable && (beat?.kind === 'say' || beat?.kind === 'box') && (
				<div className="beat-panel-footer">
					<ConfirmButton
						disabled={!onMakeDefault}
						icon={<IconTemplate />}
						label={t('dialogs.passageEdit.beatProps.makeDefault')}
						onConfirm={() => onMakeDefault?.()}
						prompt={t('dialogs.passageEdit.beatProps.makeDefaultPrompt')}
					/>
				</div>
			)}
		</div>
	);
};
