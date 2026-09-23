import {IconArrowDown} from '@tabler/icons';
import * as React from 'react';
import {IconButton} from '../../components/control/icon-button';
import type {TranscriptRow} from '../../voice/voice.types';
import {ToolCard} from './tool-card';

export interface ChatLogProps {
	emptyText: string;
	jumpLabel: string;
	rows: TranscriptRow[];
}

function timeOf(at: number): string {
	const date = new Date(at);

	return `${String(date.getHours()).padStart(2, '0')}:${String(
		date.getMinutes()
	).padStart(2, '0')}`;
}

/** Distance from the bottom, in px, still counted as "at the bottom". */
const PIN_SLACK = 24;

/**
 * The conversation. Bubbles for what was said, cards for what was done.
 *
 * This is still the audit trail (§3) — it is the only record a voice session leaves, and
 * now the only thing a restored thread replays at the model. Rows are appended for
 * failures too.
 *
 * Scrolled to the bottom on every append, because the interesting row is always the last
 * one. A session that has scrolled up is left alone and offered a button instead: reading
 * back through what happened is the other thing this list is for, and yanking the author
 * away from it mid-sentence because the model called `map` is worse than a button.
 */
export const ChatLog: React.FC<ChatLogProps> = props => {
	const {emptyText, jumpLabel, rows} = props;
	const scroller = React.useRef<HTMLDivElement>(null);
	const pinned = React.useRef(true);
	const [showJump, setShowJump] = React.useState(false);

	const toBottom = React.useCallback(() => {
		const element = scroller.current;

		if (element) {
			element.scrollTop = element.scrollHeight;
			pinned.current = true;
			setShowJump(false);
		}
	}, []);

	React.useEffect(() => {
		if (pinned.current) {
			toBottom();
		} else {
			setShowJump(rows.length > 0);
		}
	}, [rows, toBottom]);

	// Also offered the moment the author scrolls away, not only when a row lands behind
	// their back: the way back down should never be something they have to wait for.
	const handleScroll = React.useCallback(
		(event: React.UIEvent<HTMLDivElement>) => {
			const element = event.currentTarget;
			const atBottom =
				element.scrollHeight - element.scrollTop - element.clientHeight <
				PIN_SLACK;

			pinned.current = atBottom;
			setShowJump(!atBottom);
		},
		[]
	);

	return (
		<div className="voice-chat">
			<div
				aria-live="polite"
				className="voice-chat-scroll"
				onScroll={handleScroll}
				ref={scroller}
			>
				{rows.length === 0 ? (
					<p className="voice-chat-empty">{emptyText}</p>
				) : (
					rows.map(row =>
						row.kind === 'tool' ? (
							<ToolCard key={row.id} row={row} />
						) : (
							<div
								className={`voice-bubble voice-bubble-${row.kind}${
									row.error ? ' voice-bubble-error' : ''
								}`}
								key={row.id}
							>
								<span className="voice-bubble-text">{row.text}</span>
								<span className="voice-bubble-time">{timeOf(row.at)}</span>
							</div>
						)
					)
				)}
			</div>
			{showJump && (
				<div className="voice-chat-jump">
					<IconButton
						icon={<IconArrowDown />}
						label={jumpLabel}
						onClick={toBottom}
						variant="primary"
					/>
				</div>
			)}
		</div>
	);
};
