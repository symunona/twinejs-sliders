import {IconCheck, IconMessages, IconTrash, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {CardButton} from '../../components/control/card-button';
import {IconButton} from '../../components/control/icon-button';
import type {VoiceThread} from '../../voice/voice.types';

export interface ThreadMenuProps {
	currentId: string;
	onDelete: (threadId: string) => void;
	onSelect: (threadId: string) => void;
	threads: VoiceThread[];
}

const when = new Intl.DateTimeFormat(undefined, {
	dateStyle: 'short',
	timeStyle: 'short'
});

/**
 * The saved conversations for this story.
 *
 * A popover rather than a pane: the author is here to talk, and a thread list that eats a
 * third of a panel this narrow costs more than it gives.
 *
 * Delete confirms inline, the way `story-history` does, rather than with a `ConfirmButton`
 * — that is a `CardButton`, and a `CardButton` inside this one nests two focus traps. The
 * confirmation is worth having either way: a transcript is not synced and not on the undo
 * stack, so deleting one is the end of it.
 */
export const ThreadMenu: React.FC<ThreadMenuProps> = props => {
	const {currentId, onDelete, onSelect, threads} = props;
	const [open, setOpen] = React.useState(false);
	const [confirming, setConfirming] = React.useState<string>();
	const {t} = useTranslation();

	return (
		<CardButton
			ariaLabel={t('dialogs.voiceMode.threads')}
			icon={<IconMessages />}
			iconOnly
			label={t('dialogs.voiceMode.threads')}
			onChangeOpen={value => {
				setOpen(value);
				setConfirming(undefined);
			}}
			open={open}
			tooltipPosition="bottom"
		>
			<div className="voice-thread-menu">
				{threads.length === 0 ? (
					<p className="voice-thread-empty">
						{t('dialogs.voiceMode.noThreads')}
					</p>
				) : (
					<ul className="voice-thread-list">
						{threads.map(thread => (
							<li
								className={`voice-thread${
									thread.id === currentId ? ' voice-thread-current' : ''
								}`}
								key={thread.id}
							>
								<button
									className="voice-thread-open"
									onClick={() => {
										onSelect(thread.id);
										setOpen(false);
									}}
									type="button"
								>
									<span className="voice-thread-title">
										{thread.title ?? t('dialogs.voiceMode.untitledThread')}
									</span>
									<span className="voice-thread-detail">
										{when.format(thread.updatedAt)} ·{' '}
										{t('dialogs.voiceMode.threadRows', {
											count: thread.rows.length
										})}
									</span>
								</button>
								{confirming === thread.id ? (
									<ButtonBar>
										<IconButton
											icon={<IconCheck />}
											iconOnly
											label={t('dialogs.voiceMode.deleteThreadPrompt')}
											onClick={() => {
												setConfirming(undefined);
												onDelete(thread.id);
											}}
											variant="danger"
										/>
										<IconButton
											icon={<IconX />}
											iconOnly
											label={t('common.cancel')}
											onClick={() => setConfirming(undefined)}
										/>
									</ButtonBar>
								) : (
									<IconButton
										icon={<IconTrash />}
										iconOnly
										label={t('common.delete')}
										onClick={() => setConfirming(thread.id)}
									/>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</CardButton>
	);
};
