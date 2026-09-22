import * as React from 'react';
import type {TranscriptRow} from '../../voice/voice.types';

export interface TranscriptListProps {
	emptyText: string;
	rows: TranscriptRow[];
}

function timeOf(at: number): string {
	const date = new Date(at);

	return `${String(date.getHours()).padStart(2, '0')}:${String(
		date.getMinutes()
	).padStart(2, '0')}`;
}

/**
 * One row per turn, one row per tool call — the only record a voice session leaves.
 *
 * Scrolled to the bottom on every append, because the interesting row is always the last
 * one and an author watching an edit land should not have to chase it. A session that has
 * scrolled up is left alone: reading back through what happened is the other thing this
 * list is for.
 */
export const TranscriptList: React.FC<TranscriptListProps> = props => {
	const {emptyText, rows} = props;
	const scroller = React.useRef<HTMLOListElement>(null);
	const pinned = React.useRef(true);

	React.useEffect(() => {
		const element = scroller.current;

		if (element && pinned.current) {
			element.scrollTop = element.scrollHeight;
		}
	}, [rows]);

	if (rows.length === 0) {
		return <p className="voice-transcript-empty">{emptyText}</p>;
	}

	return (
		<ol
			aria-live="polite"
			className="voice-transcript"
			onScroll={event => {
				const element = event.currentTarget;

				pinned.current =
					element.scrollHeight - element.scrollTop - element.clientHeight < 24;
			}}
			ref={scroller}
		>
			{rows.map(row => (
				<li
					className={`voice-row voice-row-${row.kind}${
						row.error ? ' voice-row-error' : ''
					}${row.toolKind ? ` voice-row-${row.toolKind}` : ''}`}
					key={row.id}
				>
					<span className="voice-row-time">{timeOf(row.at)}</span>
					{row.tool && <code className="voice-row-tool">{row.tool}</code>}
					<span className="voice-row-text">{row.text}</span>
				</li>
			))}
		</ol>
	);
};
