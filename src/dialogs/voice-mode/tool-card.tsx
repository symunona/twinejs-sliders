import {
	IconAlertTriangle,
	IconArrowsMove,
	IconEye,
	IconPencil
} from '@tabler/icons';
import * as React from 'react';
import type {TranscriptRow} from '../../voice/voice.types';

export interface ToolCardProps {
	row: TranscriptRow;
}

const ICONS = {
	read: <IconEye />,
	ui: <IconArrowsMove />,
	write: <IconPencil />
};

/** `{"ref": "Tavern Night"}` reads as `Tavern Night` on one line. */
function shortArgs(args: Record<string, unknown> | undefined): string {
	const entries = Object.entries(args ?? {});

	if (entries.length === 0) {
		return '';
	}

	if (entries.length === 1 && typeof entries[0][1] === 'string') {
		return entries[0][1];
	}

	return entries
		.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
		.join(', ');
}

/**
 * One tool call in the chat.
 *
 * A call is not a chat message and is deliberately not shaped like one: the author scans
 * past a dozen `map`s looking for the `write_passage` that changed something. Hence the
 * kind stripe down the left, and hence `write` being the only one that is loud.
 *
 * Arguments are collapsed to a line and expand on click. The summary a tool returns is a
 * receipt, not a log (`summariseResult`), so when a session goes wrong the arguments are
 * the only thing that says what was actually asked for.
 */
export const ToolCard: React.FC<ToolCardProps> = props => {
	const {row} = props;
	const [open, setOpen] = React.useState(false);
	const args = shortArgs(row.args);
	const expandable = Object.keys(row.args ?? {}).length > 0;

	return (
		<div
			className={`voice-tool-card voice-tool-${row.toolKind ?? 'read'}${
				row.error ? ' voice-tool-error' : ''
			}`}
		>
			<button
				aria-expanded={expandable ? open : undefined}
				className="voice-tool-head"
				disabled={!expandable}
				onClick={() => setOpen(value => !value)}
				type="button"
			>
				<span className="voice-tool-icon">
					{row.error ? (
						<IconAlertTriangle />
					) : (
						ICONS[row.toolKind ?? 'read']
					)}
				</span>
				<code className="voice-tool-name">{row.tool}</code>
				{args !== '' && <span className="voice-tool-args">{args}</span>}
			</button>
			<div className="voice-tool-result">{row.text}</div>
			{open && (
				<pre className="voice-tool-raw">
					{JSON.stringify(row.args ?? {}, null, 2)}
				</pre>
			)}
		</div>
	);
};
