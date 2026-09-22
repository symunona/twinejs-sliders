import {
	IconAlertTriangle,
	IconArrowBackUp,
	IconMicrophone,
	IconMicrophoneOff,
	IconPlayerPlay,
	IconTrash
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {usePrefsContext} from '../../store/prefs';
import {storyWithId} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {useLiveVoice} from '../../voice/live/use-live-voice';
import {sceneIdsOf} from '../../voice/runner';
import {voiceTools} from '../../voice/tools';
import {parseToolLine, useVoiceSession} from '../../voice/use-voice-session';
import {useVoiceToolEnv} from '../../voice/use-voice-tool-env';
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
 * The text box is not a fallback for when audio fails — it is the debugger. Every tool the
 * model gets is reachable here by hand, through the same runner, so a session that goes
 * wrong is reproduced by typing the calls back in. The Live adapter is a third caller of
 * `session.call`, not a second code path.
 *
 * The transcript is the audit trail (§3). Nothing else records what the microphone did.
 */
export const VoiceModeDialog: React.FC<VoiceModeDialogProps> = props => {
	const {setCenter, storyId, ...other} = props;
	const {prefs} = usePrefsContext();
	const {stories} = useUndoableStoriesContext();
	const story = storyWithId(stories, storyId);
	const env = useVoiceToolEnv({setCenter, story});
	const session = useVoiceSession(env);
	const [line, setLine] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const {t} = useTranslation();
	const sceneIds = React.useMemo(
		() => sceneIdsOf(story.passages),
		[story.passages]
	);
	const voice = useLiveVoice({
		apiKey: prefs.geminiApiKey,
		onCall: session.call,
		onSay: session.say,
		sceneIds,
		storyName: story.name
	});
	const hasKey = prefs.geminiApiKey.trim() !== '';

	/**
	 * The session's escape hatch, pinned when the microphone opens rather than when the
	 * panel does: an author who opened the panel to type three tool calls does not need a
	 * revision pinned, and an author who started talking does.
	 */
	const pinned = React.useRef(false);

	React.useEffect(() => {
		if (voice.state !== 'listening' || pinned.current) {
			return;
		}

		pinned.current = true;
		void session.call('checkpoint', {
			label: t('dialogs.voiceMode.checkpointLabel', {
				time: new Date().toLocaleTimeString()
			})
		});
	}, [session, t, voice.state]);

	const handleRun = React.useCallback(async () => {
		const trimmed = line.trim();

		if (trimmed === '') {
			return;
		}

		// With the socket up, the box talks TO the model. With it down, it drives the
		// runner directly. One box, because which one an author wants is exactly whether
		// the microphone is on.
		if (voice.on) {
			setLine('');
			session.say('user', trimmed);
			voice.sendText(trimmed);
			return;
		}

		const parsed = parseToolLine(trimmed);

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
	}, [line, session, voice]);

	const stateLabel = t(`dialogs.voiceMode.${voice.state}`, {
		defaultValue: voice.state
	});

	return (
		<DialogCard
			{...other}
			className="voice-mode-dialog"
			headerLabel={t('dialogs.voiceMode.title')}
			maximizable
		>
			<div className="voice-status">
				<IconButton
					icon={voice.on ? <IconMicrophone /> : <IconMicrophoneOff />}
					label={stateLabel}
					onClick={() => (voice.on ? voice.stop() : void voice.start())}
					preventDefault={false}
					selectable
					selected={voice.on}
				/>
				{/* A live region, so a screen reader hears the state change it cannot see. */}
				<span aria-live="polite" className="voice-state">
					{voice.detail ?? stateLabel}
				</span>
			</div>
			{!hasKey && <p className="voice-note">{t('dialogs.voiceMode.needsKey')}</p>}
			{voice.on && (
				<p className="voice-note">
					<IconAlertTriangle /> {t('dialogs.voiceMode.headphones')}
				</p>
			)}
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
