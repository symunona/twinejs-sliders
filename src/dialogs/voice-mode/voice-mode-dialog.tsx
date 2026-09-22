import {IconPlayerPlay, IconTrash, IconArrowBackUp} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogCard} from '../../components/container/dialog-card';
import {ButtonBar} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';
import {storyWithId} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {useVoiceSession, parseToolLine} from '../../voice/use-voice-session';
import {useVoiceToolEnv} from '../../voice/use-voice-tool-env';
import {voiceTools} from '../../voice/tools';
import type {Point} from '../../util/geometry';
import {DialogComponentProps} from '../dialogs.types';
import {TranscriptList} from './transcript-list';
import './voice-mode-dialog.css';

export interface VoiceModeDialogProps extends DialogComponentProps {
	/** From the route's `useViewCenter`, so `goto` can actually scroll the map. */
	setCenter: (point: Point) => void;
	storyId: string;
}

/**
 * The voice panel.
 *
 * Step 2 of the plan ships it WITHOUT audio, driven by typed tool calls, and that is not a
 * placeholder — it is the debugger. Everything a model will be able to do to the story is
 * reachable here by hand, in the same order, against the same runner, so a session that
 * goes wrong is reproduced by typing the calls back in. The socket adapter is a third
 * caller of `session.call`, not a different code path.
 *
 * The transcript is the audit trail (§3). Nothing else records what the microphone did.
 */
export const VoiceModeDialog: React.FC<VoiceModeDialogProps> = props => {
	const {setCenter, storyId, ...other} = props;
	const {stories} = useUndoableStoriesContext();
	const story = storyWithId(stories, storyId);
	const env = useVoiceToolEnv({setCenter, story});
	const session = useVoiceSession(env);
	const [line, setLine] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const {t} = useTranslation();

	const handleRun = React.useCallback(async () => {
		const parsed = parseToolLine(line);

		if ('error' in parsed) {
			session.say('system', parsed.error);
			return;
		}

		setLine('');
		setBusy(true);

		try {
			await session.call(parsed.name, parsed.args);
		} finally {
			setBusy(false);
		}
	}, [line, session]);

	return (
		<DialogCard
			{...other}
			className="voice-mode-dialog"
			headerLabel={t('dialogs.voiceMode.title')}
			maximizable
		>
			<TranscriptList
				emptyText={t('dialogs.voiceMode.empty')}
				rows={session.rows}
			/>
			<form
				className="voice-run"
				onSubmit={event => {
					event.preventDefault();
					void handleRun();
				}}
			>
				<input
					// A datalist rather than a select: the names are the model's API, and an
					// author who has read one transcript already knows them.
					list="voice-tool-names"
					onChange={event => setLine(event.target.value)}
					placeholder={t('dialogs.voiceMode.runPlaceholder')}
					type="text"
					value={line}
				/>
				<datalist id="voice-tool-names">
					{voiceTools.map(tool => (
						<option key={tool.name} value={tool.name}>
							{tool.description}
						</option>
					))}
				</datalist>
				<ButtonBar>
					<IconButton
						disabled={busy || line.trim() === ''}
						icon={<IconPlayerPlay />}
						label={t('dialogs.voiceMode.run')}
						onClick={() => void handleRun()}
					/>
					<IconButton
						disabled={!session.undo}
						icon={<IconArrowBackUp />}
						label={t('dialogs.voiceMode.undoLast')}
						onClick={() => session.undo?.()}
					/>
					<IconButton
						disabled={session.rows.length === 0}
						icon={<IconTrash />}
						label={t('dialogs.voiceMode.clear')}
						onClick={session.clear}
					/>
				</ButtonBar>
			</form>
		</DialogCard>
	);
};
