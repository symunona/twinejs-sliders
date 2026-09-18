import {AssetId} from '@sliders/scene-types';
import {IconPlayerPlay, IconPlayerStop} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../components/control/icon-button';
import {useAssetUrl} from './asset-store-context';
import './sound-preview.css';

export interface SoundPreviewProps {
	assetId?: AssetId;
	/** Seconds, as measured at upload. Absent when nothing could read the file's headers. */
	duration?: number;
	name: string;
}

/**
 * `1:04` for a bed, `0.4s` for a door slam.
 *
 * Two shapes because sounds come in two sizes and one shape lies about the other: a
 * one-shot is routinely under a second, and rounding it to `0:00` reads as "this file is
 * broken" on exactly the assets that are working. Minutes take over at ten seconds, which
 * is past every sfx and short of every bed.
 */
export function formatDuration(seconds: number): string {
	const safe = Math.max(0, seconds);

	if (safe < 10) {
		// One decimal: 0.45 and 0.5 are the same sound to a listener, and a second digit
		// would just make the column noisy.
		return `${safe.toFixed(1)}s`;
	}

	const whole = Math.round(safe);

	return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * A sound's tile art: hear it, here.
 *
 * This is the whole reason the Sounds tab is worth building rather than telling authors to
 * name files carefully. `rain-heavy` and `rain-heavy-2` are indistinguishable in a list and
 * obvious the moment you play them, and an author who cannot audition in the library will
 * audition by writing a beat, running the scene, and deleting the beat again.
 */
export const SoundPreview: React.FC<SoundPreviewProps> = props => {
	const {assetId, duration, name} = props;
	const audio = React.useRef<HTMLAudioElement>(null);
	const [playing, setPlaying] = React.useState(false);
	const url = useAssetUrl(assetId);
	const {t} = useTranslation();

	// A tile whose sound is still playing when the dialog closes, the tab changes or the
	// asset is deleted would go on playing with nothing on screen to stop it.
	React.useEffect(() => () => audio.current?.pause(), []);

	function handleToggle() {
		const el = audio.current;

		if (!el) {
			return;
		}

		if (playing) {
			el.pause();
			el.currentTime = 0;
			setPlaying(false);
			return;
		}

		// Nothing else here needs a promise: this is a click, so the autoplay policy is
		// already satisfied. A rejection means the file will not decode, and the button
		// coming back up says so more usefully than a console line.
		void el.play().catch(() => setPlaying(false));
		setPlaying(true);
	}

	return (
		<span className="sound-preview">
			<IconButton
				disabled={!url}
				icon={playing ? <IconPlayerStop /> : <IconPlayerPlay />}
				iconOnly
				label={
					playing
						? t('dialogs.slidersAssets.stopSound')
						: t('dialogs.slidersAssets.playSound', {name})
				}
				onClick={handleToggle}
			/>
			{url && (
				<audio
					onEnded={() => setPlaying(false)}
					onPause={() => setPlaying(false)}
					preload="metadata"
					ref={audio}
					src={url}
				/>
			)}
			<span className="sound-preview-duration">
				{duration === undefined ? '—' : formatDuration(duration)}
			</span>
		</span>
	);
};
