/**
 * The beat panel: the beat the scrubber is on, edited beside the stage.
 *
 * Takes the layers panel's slot rather than stacking under it -- the view is one stage tall
 * and two lists in it would leave each a few rows. Words first, because they are what an
 * author changes most; then the beat's timing and bubble (`BeatProps` in its panel layout);
 * then the one story-wide act, handing this beat's look up as the story's default.
 *
 * The text box writes as the author types, throttled: one write per `TEXT_WRITE_MS` at most,
 * so the stage keeps up without a reparse per keystroke. The writes carry a `+` origin and
 * merge into one undo step. Ctrl+B / Ctrl+I toggle `**bold**` / `_italic_`
 * (`beat-text-markup.ts`).
 */

import {IconTemplate, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {Beat} from '@sliders/scene-types';
import {ConfirmButton} from '../../../components/control/confirm-button';
import {IconButton} from '../../../components/control/icon-button';
import {BeatProps, BeatPropsProps} from './beat-props';
import {MarkupToggle, toggleMarkup} from './beat-text-markup';
import './beat-panel.css';

export interface BeatPanelProps extends Omit<BeatPropsProps, 'beatCount'> {
	beatCount: number;
	/**
	 * The words, written back. Only called with text that differs from the beat's. `live`
	 * marks a write made mid-typing, which merges with its neighbours in the undo history.
	 */
	onSetText: (text: string, live?: boolean) => void;
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

/** At most one live write this often while typing. */
export const TEXT_WRITE_MS = 300;

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
	/** The words as last rendered, for a throttled write deciding whether it has news. */
	const latestWords = React.useRef(words);

	latestWords.current = words;
	const [draft, setDraft] = React.useState<string>();
	const textArea = React.useRef<HTMLTextAreaElement>(null);
	/**
	 * The write waiting for the throttle. Holds the `onSetText` of the beat it was typed
	 * into, so a scrub mid-wait still lands the words on the right beat.
	 */
	const pending = React.useRef<{send: () => void; timer: number}>();
	/**
	 * The last text sent since the box took focus. A write is news against THIS, not the
	 * rendered words, which may not have caught up with it yet.
	 */
	const lastSent = React.useRef<string>();
	/** The text when the box took focus, for Escape. */
	const original = React.useRef<string>();
	/** Where the caret goes once a Ctrl+B / Ctrl+I edit has rendered. */
	const caret = React.useRef<[number, number]>();

	function flush() {
		const write = pending.current;

		if (write) {
			window.clearTimeout(write.timer);
			pending.current = undefined;
			write.send();
		}
	}

	function schedule(text: string) {
		const send = () => {
			if (text !== (lastSent.current ?? latestWords.current)) {
				lastSent.current = text;
				onSetText(text, true);
			}
		};

		if (pending.current) {
			pending.current.send = send;
			return;
		}

		pending.current = {
			send,
			timer: window.setTimeout(() => {
				const write = pending.current;

				pending.current = undefined;
				write?.send();
			}, TEXT_WRITE_MS)
		};
	}

	function change(text: string) {
		setDraft(text);
		schedule(text);
	}

	// A new beat: land what was typed on the old one, then show the new one's words.
	React.useEffect(() => {
		flush();
		lastSent.current = undefined;
		setDraft(undefined);
	}, [beatNumber]);

	// The text changed under the box. While typing, that is our own write coming back --
	// keep the draft, it is ahead of it. Otherwise it is news: show it.
	React.useEffect(() => {
		if (document.activeElement !== textArea.current) {
			setDraft(undefined);
		}
	}, [beat]);

	React.useEffect(() => () => flush(), []);

	React.useEffect(() => {
		if (focusText) {
			textArea.current?.focus();
			textArea.current?.select();
		}
	}, [focusText]);

	React.useLayoutEffect(() => {
		if (caret.current && textArea.current) {
			textArea.current.setSelectionRange(...caret.current);
			caret.current = undefined;
		}
	}, [draft]);

	function toggle(mark: MarkupToggle) {
		const box = textArea.current;

		if (!box) {
			return;
		}

		const edit = toggleMarkup(
			box.value,
			box.selectionStart,
			box.selectionEnd,
			mark
		);

		caret.current = [edit.start, edit.end];
		change(edit.text);
	}

	function finish() {
		flush();

		if (draft === undefined || draft === words) {
			setDraft(undefined);
		}
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
							onBlur={finish}
							onChange={event => change(event.target.value)}
							onFocus={() => {
								original.current = words;
								lastSent.current = undefined;
							}}
							onKeyDown={event => {
								const mod = event.ctrlKey || event.metaKey;
								const key = event.key.toLowerCase();

								if (mod && !event.altKey && (key === 'b' || key === 'i')) {
									event.preventDefault();
									event.stopPropagation();
									toggle(key === 'b' ? 'bold' : 'italic');
									return;
								}

								// Enter writes now, Shift+Enter is a line break inside the line.
								if (event.key === 'Enter' && !event.shiftKey) {
									event.preventDefault();
									flush();
								}

								if (event.key === 'Escape') {
									// Back to the words the box was entered with. Keep the
									// dialog: Escape is the box's here.
									event.stopPropagation();

									if (original.current !== undefined) {
										change(original.current);
										flush();
									}
								}
							}}
							ref={textArea}
							rows={6}
							value={draft ?? words}
						/>
					</label>
				)}
				<BeatProps
					{...rest}
					beat={beat}
					beatNumber={beatNumber}
					editable={editable}
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
