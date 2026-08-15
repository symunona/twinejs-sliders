import * as React from 'react';
import {useTranslation} from 'react-i18next';
import './build-info.css';

// These are replaced at build time by Vite--see `define` in vite.config.mts.
// They're undefined in tests and any other non-Vite context, in which case this
// component renders nothing.

const buildTime = process.env.VITE_BUILD_TIME;
const commitHash = process.env.VITE_COMMIT_HASH;

// How often the relative time is recalculated, so it doesn't go stale in a
// long-lived tab.

const updateInterval = 60000;

/**
 * Chooses a translation key and value describing how long ago a build happened.
 */
function elapsedSince(
	builtAt: number,
	now: number
): {key: string; value: number} {
	const minutes = Math.floor(Math.max(0, now - builtAt) / 60000);

	if (minutes < 1) {
		return {key: 'routes.storyEdit.buildInfo.justNow', value: 0};
	}

	if (minutes < 60) {
		return {key: 'routes.storyEdit.buildInfo.minutesAgo', value: minutes};
	}

	const hours = Math.floor(minutes / 60);

	if (hours < 24) {
		return {key: 'routes.storyEdit.buildInfo.hoursAgo', value: hours};
	}

	return {
		key: 'routes.storyEdit.buildInfo.daysAgo',
		value: Math.floor(hours / 24)
	};
}

export const BuildInfo: React.FC = React.memo(() => {
	const {t} = useTranslation();
	const builtAt = React.useMemo(
		() => (buildTime ? new Date(buildTime) : undefined),
		[]
	);
	const [now, setNow] = React.useState(() => Date.now());

	React.useEffect(() => {
		const interval = window.setInterval(
			() => setNow(Date.now()),
			updateInterval
		);

		return () => window.clearInterval(interval);
	}, []);

	if (!builtAt || isNaN(builtAt.getTime())) {
		return null;
	}

	const elapsed = elapsedSince(builtAt.getTime(), now);

	return (
		<span
			className="build-info"
			title={t('routes.storyEdit.buildInfo.details', {
				commit: commitHash || t('routes.storyEdit.buildInfo.unknownCommit'),
				time: builtAt.toLocaleString()
			})}
		>
			{t(elapsed.key, {value: elapsed.value})}
		</span>
	);
});

BuildInfo.displayName = 'BuildInfo';
