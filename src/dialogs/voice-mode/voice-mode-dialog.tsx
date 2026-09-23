import {
	IconAlertTriangle,
	IconArrowBackUp,
	IconMicrophone,
	IconMicrophoneOff,
	IconPlus,
	IconSend
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../../components/container/card';
import {DialogCard} from '../../components/container/dialog-card';
import {IconButton} from '../../components/control/icon-button';
import {setPref, usePrefsContext} from '../../store/prefs';
import {storyWithId} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {liveModels, pickLiveModel} from '../../voice/live/models';
import {useLiveVoice} from '../../voice/live/use-live-voice';
import {sceneIdsOf} from '../../voice/runner';
import {parseToolLine, useVoiceSession} from '../../voice/use-voice-session';
import {useSceneScreenshot} from '../../voice/screenshot/use-scene-screenshot';
import {useVoiceToolEnv} from '../../voice/use-voice-tool-env';
import {useVoiceThreads} from '../../voice/use-voice-threads';
import type {Point} from '../../util/geometry';
import {DialogComponentProps} from '../dialogs.types';
import {ChatLog} from './chat-log';
import {ContextMeter} from './context-meter';
import {ThreadMenu} from './thread-menu';
import './voice-mode-dialog.css';

export interface VoiceModeDialogProps extends DialogComponentProps {
	/** From the route's `useViewCenter`. A created passage lands where the author looks. */
	getCenter: () => Point;
	/** Also `useViewCenter`, so `goto` can actually scroll the map. */
	setCenter: (point: Point) => void;
	storyId: string;
}

/**
 * The voice panel: one conversation at a time, out of a per-story list that survives a
 * reload (`voice/threads.ts`).
 *
 * The transcript is the audit trail (§3). Nothing else records what the microphone did —
 * and since threads restore, it is also the only thing the model is told about a
 * conversation it is being dropped back into.
 *
 * The text box talks to the MODEL and is disabled with the microphone off, because a box
 * whose meaning flips on a mic state the author can barely see is a box they will use
 * wrong. Tool calls are still reachable by hand, behind a `/` — that is how a bad session
 * is reproduced (§ The text box is the debugger), and it is now explicit rather than
 * implied by a mode.
 */
export const VoiceModeDialog: React.FC<VoiceModeDialogProps> = props => {
	const {getCenter, setCenter, storyId, ...other} = props;
	const {dispatch, prefs} = usePrefsContext();
	const {stories} = useUndoableStoriesContext();
	const story = storyWithId(stories, storyId);
	const {capture, host} = useSceneScreenshot(story);
	const env = useVoiceToolEnv({getCenter, screenshot: capture, setCenter, story});
	const session = useVoiceSession(env);
	const [line, setLine] = React.useState('');
	const [busy, setBusy] = React.useState(false);
	const {t} = useTranslation();
	const sceneIds = React.useMemo(
		() => sceneIdsOf(story.passages),
		[story.passages]
	);
	/*
	 * Read when the socket opens rather than captured, so a thread restored while the mic
	 * is off is still the one seeded when the author turns it on.
	 */
	const rowsRef = React.useRef(session.rows);

	rowsRef.current = session.rows;

	const model = pickLiveModel(prefs.voiceLiveModel);
	const voice = useLiveVoice({
		apiKey: prefs.geminiApiKey,
		model: model.id,
		onCall: session.call,
		onSay: session.say,
		onTurnComplete: session.endTurn,
		sceneIds,
		seed: React.useCallback(() => rowsRef.current, []),
		storyName: story.name
	});
	const threads = useVoiceThreads(storyId, session.rows, voice.usage?.prompt);
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

	/**
	 * A compaction is the one thing that happens to a long session without anybody asking,
	 * and it silently drops the middle of the conversation. Say so.
	 */
	const lastPrompt = React.useRef<number>();

	React.useEffect(() => {
		const prompt = voice.usage?.prompt;

		if (prompt === undefined) {
			lastPrompt.current = undefined;
			return;
		}

		if (lastPrompt.current !== undefined && prompt < lastPrompt.current) {
			session.say('system', t('dialogs.voiceMode.compacted'));
		}

		lastPrompt.current = prompt;
	}, [session, t, voice.usage]);

	const handleNewThread = React.useCallback(() => {
		// A new thread over a live socket is the old context wearing a new name: the model
		// still remembers everything, and the panel says otherwise.
		voice.stop();
		threads.start();
		session.reset();
		setLine('');
	}, [session, threads, voice]);

	const handleSelectThread = React.useCallback(
		(threadId: string) => {
			// Same reason, plus: the socket has to reopen to be seeded with the thread the
			// author just picked, or the model answers thread A inside thread B.
			voice.stop();
			session.restore(threads.select(threadId));
			setLine('');
		},
		[session, threads, voice]
	);

	const handleDeleteThread = React.useCallback(
		(threadId: string) => {
			if (threadId === threads.current.id) {
				voice.stop();
				session.reset();
			}

			threads.remove(threadId);
		},
		[session, threads, voice]
	);

	const handleSend = React.useCallback(async () => {
		const trimmed = line.trim();

		if (trimmed === '' || !voice.on) {
			return;
		}

		// `/tool {json}` runs the tool directly, exactly as the old box did. The whole
		// surface stays reachable by hand; it just no longer depends on guessing which
		// mode the box is in.
		if (trimmed.startsWith('/')) {
			const parsed = parseToolLine(trimmed.slice(1));

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

			return;
		}

		setLine('');
		session.say('user', trimmed);
		voice.sendText(trimmed);
	}, [line, session, voice]);

	/**
	 * Grows with its text up to the CSS `max-height`, then scrolls. Measured rather than
	 * left to `field-sizing: content`, which Firefox does not ship.
	 */
	const box = React.useRef<HTMLTextAreaElement>(null);

	React.useLayoutEffect(() => {
		const node = box.current;

		if (!node) {
			return;
		}

		node.style.height = 'auto';
		node.style.height = `${node.scrollHeight}px`;
	}, [line]);

	const stateLabel = t(`dialogs.voiceMode.${voice.state}`, {
		defaultValue: voice.state
	});

	return (
		<DialogCard
			{...other}
			className="voice-mode-dialog"
			headerControls={
				<>
					<IconButton
						icon={<IconPlus />}
						iconOnly
						label={t('dialogs.voiceMode.newThread')}
						onClick={handleNewThread}
						tooltipPosition="bottom"
					/>
					<ThreadMenu
						currentId={threads.current.id}
						onDelete={handleDeleteThread}
						onSelect={handleSelectThread}
						threads={threads.threads}
					/>
				</>
			}
			headerLabel={t('dialogs.voiceMode.title')}
			maximizable
		>
			<CardContent>
				<div className={classNames('voice-status', `voice-status-${voice.state}`)}>
					<IconButton
						icon={voice.on ? <IconMicrophone /> : <IconMicrophoneOff />}
						// The label is next to it in the live region, and printing it twice
						// makes a narrow panel read as a stutter.
						iconOnly
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
					{/*
					 * Locked while the socket is up: the model is fixed at setup, so a
					 * change here would silently apply only to the NEXT session.
					 */}
					<select
						aria-label={t('dialogs.voiceMode.model')}
						className="voice-model"
						disabled={voice.on}
						onChange={event =>
							dispatch(setPref('voiceLiveModel', event.target.value))
						}
						title={model.note}
						value={model.id}
					>
						{liveModels.map(entry => (
							<option key={entry.id} value={entry.id}>
								{entry.label}
							</option>
						))}
					</select>
					<ContextMeter modelId={model.id} usage={voice.usage} />
					<IconButton
						disabled={!session.undo}
						icon={<IconArrowBackUp />}
						iconOnly
						label={t('dialogs.voiceMode.undoLast')}
						onClick={() => session.undo?.()}
					/>
				</div>
				{!hasKey && <p className="voice-note">{t('dialogs.voiceMode.needsKey')}</p>}
				{voice.on && (
					<p className="voice-note">
						<IconAlertTriangle /> {t('dialogs.voiceMode.headphones')}
					</p>
				)}
				<ChatLog
					emptyText={t('dialogs.voiceMode.empty')}
					jumpLabel={t('dialogs.voiceMode.jumpToLatest')}
					rows={session.rows}
				/>
				{host}
				<form
					className="voice-send"
					onSubmit={event => {
						event.preventDefault();
						void handleSend();
					}}
				>
					<textarea
						disabled={!voice.on}
						onChange={event => setLine(event.target.value)}
						// Enter sends, Shift+Enter breaks the line — the chat convention. Not
						// while an IME is composing, or confirming a candidate sends it.
						onKeyDown={event => {
							if (
								event.key === 'Enter' &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing
							) {
								event.preventDefault();
								void handleSend();
							}
						}}
						placeholder={
							voice.on
								? t('dialogs.voiceMode.sendPlaceholder')
								: t('dialogs.voiceMode.sendDisabled')
						}
						ref={box}
						rows={1}
						value={line}
					/>
					<IconButton
						disabled={!voice.on || busy || line.trim() === ''}
						icon={<IconSend />}
						iconOnly
						label={t('dialogs.voiceMode.send')}
						onClick={() => void handleSend()}
					/>
				</form>
			</CardContent>
		</DialogCard>
	);
};
