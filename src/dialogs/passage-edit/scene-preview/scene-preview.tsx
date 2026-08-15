import {
	IconAlertTriangle,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconMaximize,
	IconMinimize,
	IconPlayerPause,
	IconPlayerPlay
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../components/control/icon-button';
import {useCommand} from '../../../hotkeys';
import {IndexedPassage} from '@sliders/scene-index';
import {AssetResolver} from '@sliders/scene-types';
import {SceneStage} from './scene-stage';
import {useSceneParse} from './use-scene-parse';
import './scene-preview.css';

export interface ScenePreviewProps {
	assets: AssetResolver;
	text: string;
	/** The whole story. Needed only so `from:` can resolve across passages. */
	passages?: IndexedPassage[];
	/** Called when the user clicks an error, so the editor can jump to that line. */
	onGoToLine?: (line: number) => void;
}

const OPEN_KEY = 'sliders.preview.open';
const SEEN_KEY = 'sliders.preview.seen';

/**
 * Live scene preview under the passage text (spec 06).
 *
 * Collapsible, remembers its state, and opens full screen the very first time so the
 * feature is discoverable.
 */
export const ScenePreview: React.FC<ScenePreviewProps> = ({
	assets,
	text,
	passages,
	onGoToLine
}) => {
	const {t} = useTranslation();
	const parse = useSceneParse(text, passages);
	const [open, setOpen] = React.useState(
		() => window.localStorage.getItem(OPEN_KEY) !== 'false'
	);
	const [fullScreen, setFullScreen] = React.useState(false);
	const [beat, setBeat] = React.useState(0);
	const [playing, setPlaying] = React.useState(false);

	// The first time the user opens the preview it comes up full screen (D12). Tied to
	// the click rather than to "a scene appeared", which would hijack the screen while
	// they're still typing the block out.
	function handleToggle() {
		const next = !open;

		setOpen(next);

		if (next && !window.localStorage.getItem(SEEN_KEY)) {
			window.localStorage.setItem(SEEN_KEY, '1');
			setFullScreen(true);
		}
	}

	function goToPreviousBeat() {
		setPlaying(false);
		setBeat(b => Math.max(0, b - 1));
	}

	function goToNextBeat() {
		setPlaying(false);
		setBeat(b => Math.min(lastBeat, b + 1));
	}

	function togglePlaying() {
		if (!playing && beat >= lastBeat) {
			setBeat(0);
		}

		setPlaying(p => !p);
	}

	/** Clicking the stage itself goes full screen, unless a link was clicked. */
	function handleStageClick(event: React.MouseEvent) {
		if ((event.target as HTMLElement).closest('a')) {
			return;
		}

		setFullScreen(f => !f);
	}

	React.useEffect(() => {
		window.localStorage.setItem(OPEN_KEY, String(open));
	}, [open]);

	const lastBeat = Math.max(0, parse.states.length - 1);

	// Keep the scrubber in range when the author edits beats out from under it.
	React.useEffect(() => {
		setBeat(current => Math.min(current, lastBeat));
	}, [lastBeat]);

	React.useEffect(() => {
		if (!playing) {
			return;
		}

		if (beat >= lastBeat) {
			setPlaying(false);
			return;
		}

		const timer = window.setTimeout(() => setBeat(b => b + 1), 900);

		return () => window.clearTimeout(timer);
	}, [beat, lastBeat, playing]);

	React.useEffect(() => {
		if (!fullScreen) {
			return;
		}

		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setFullScreen(false);
			}
		};

		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [fullScreen]);

	// Viewer keys, unmodified, in the preview's own scope: they only fire once
	// focus is inside the preview, so left and right still move the cursor
	// while the author is writing the scene above.

	useCommand({
		id: 'scene.togglePreview',
		label: t('hotkeys.commands.scene.togglePreview'),
		run: handleToggle,
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && beat > 0,
		id: 'scene.previousBeat',
		label: t('hotkeys.commands.scene.previousBeat'),
		run: goToPreviousBeat,
		scope: 'scene-preview'
	});

	useCommand({
		allowRepeat: true,
		enabled: open && beat < lastBeat,
		id: 'scene.nextBeat',
		label: t('hotkeys.commands.scene.nextBeat'),
		run: goToNextBeat,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open,
		id: 'scene.play',
		label: t('hotkeys.commands.scene.play'),
		run: togglePlaying,
		scope: 'scene-preview'
	});

	useCommand({
		enabled: open,
		id: 'scene.fullScreen',
		label: t('hotkeys.commands.scene.fullScreen'),
		run: () => setFullScreen(f => !f),
		scope: 'scene-preview'
	});

	if (!parse.hasScene) {
		return null;
	}

	const errors = parse.errors.filter(e => e.severity === 'error');
	const warnings = parse.errors.filter(e => e.severity === 'warning');

	const body = (
		<div
			className={classNames('scene-preview', {
				open,
				'full-screen': fullScreen
			})}
			data-hotkey-scope="scene-preview"
			data-testid="scene-preview"
		>
			<div className="scene-preview-bar">
				<IconButton
					icon={
						open ? <IconChevronDown /> : <IconChevronRight />
					}
					iconOnly
					label={t('dialogs.passageEdit.scenePreview.toggle')}
					onClick={handleToggle}
					selectable
					selected={open}
				/>
				<span className="scene-preview-title">
					{t('dialogs.passageEdit.scenePreview.title')}
				</span>
				{(errors.length > 0 || warnings.length > 0) && (
					<span
						className={classNames('scene-preview-badge', {
							error: errors.length > 0
						})}
						data-testid="scene-preview-badge"
					>
						<IconAlertTriangle />
						{errors.length > 0
							? t('dialogs.passageEdit.scenePreview.errorCount', {
									count: errors.length
							  })
							: t('dialogs.passageEdit.scenePreview.warningCount', {
									count: warnings.length
							  })}
					</span>
				)}
				<span className="scene-preview-spacer" />
				{open && (
					<>
						<IconButton
							disabled={beat <= 0}
							icon={<IconChevronLeft />}
							iconOnly
							label={t('dialogs.passageEdit.scenePreview.previousBeat')}
							onClick={goToPreviousBeat}
						/>
						<span className="scene-preview-beat" data-testid="scene-preview-beat">
							{beat} / {lastBeat}
						</span>
						<IconButton
							disabled={beat >= lastBeat}
							icon={<IconChevronRight />}
							iconOnly
							label={t('dialogs.passageEdit.scenePreview.nextBeat')}
							onClick={goToNextBeat}
						/>
						<IconButton
							icon={playing ? <IconPlayerPause /> : <IconPlayerPlay />}
							iconOnly
							label={t('dialogs.passageEdit.scenePreview.play')}
							onClick={togglePlaying}
						/>
						<IconButton
							icon={fullScreen ? <IconMinimize /> : <IconMaximize />}
							iconOnly
							label={t('dialogs.passageEdit.scenePreview.fullScreen')}
							onClick={() => setFullScreen(f => !f)}
						/>
					</>
				)}
			</div>
			{open && (
				<>
					{/* Full screen is also reachable from the toolbar button, which is the
					    keyboard-accessible path; this is a convenience click target. */}
					<div className="scene-preview-stage-click" onClick={handleStageClick}>
						<SceneStage
							animate={playing}
							assets={assets}
							// State N is produced by beat N-1; S0 has no beat.
							beat={beat > 0 ? parse.result?.scene.beats[beat - 1] : undefined}
							stage={parse.states[Math.min(beat, lastBeat)]}
						/>
					</div>
					{parse.errors.length > 0 && (
						<ul className="scene-preview-errors" data-testid="scene-preview-errors">
							{parse.errors.map((error, index) => (
								<li
									className={error.severity}
									key={`${error.code}-${index}`}
									onClick={() => onGoToLine?.(error.line)}
								>
									<span className="line">{error.line}</span>
									<span className="message">{error.message}</span>
									{error.hint && <span className="hint">{error.hint}</span>}
								</li>
							))}
						</ul>
					)}
				</>
			)}
		</div>
	);

	// The passage dialog stack is a transformed ancestor, which would make
	// `position: fixed` resolve against IT rather than the viewport. Portal to the body
	// so full screen is actually full screen.
	return fullScreen ? createPortal(body, document.body) : body;
};
