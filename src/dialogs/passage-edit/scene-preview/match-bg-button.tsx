/**
 * "Match bg" in the Grade popover: one click writes a suggested grade that sits the sprite
 * into the backdrop under it. The author tunes from there.
 *
 * Probed on open and whenever the backdrop changes, so a button that cannot work is off
 * before it is pressed, with a tooltip that says why — rather than a click that silently
 * does nothing.
 */

import {IconColorPicker} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {EntityGrade} from '@sliders/scene-types';
import {IconButton} from '../../../components/control/icon-button';
import {probeMatch, type MatchProbe} from './match-bg-dom';

export interface MatchBgButtonProps {
	/** Where the renderer's stage lives. */
	root: HTMLElement | null;
	id: string;
	/** Changes when the backdrop does, so the probe runs again. */
	bgKey?: string | null;
	onApply: (grade: EntityGrade | undefined) => void;
}

const REASON_KEYS: Record<Extract<MatchProbe, {ok: false}>['reason'], string> = {
	noBg: 'dialogs.passageEdit.scenePreview.grade.matchBgNoBg',
	noSprite: 'dialogs.passageEdit.scenePreview.grade.matchBgNoSprite',
	tainted: 'dialogs.passageEdit.scenePreview.grade.matchBgTainted'
};

export const MatchBgButton: React.FC<MatchBgButtonProps> = props => {
	const {bgKey, id, onApply, root} = props;
	const {t} = useTranslation();
	const [probe, setProbe] = React.useState<MatchProbe>();

	React.useEffect(() => {
		setProbe(probeMatch(root, id));
	}, [bgKey, id, root]);

	// A picture still loading reads as "nothing to measure", which is not the author's
	// problem: only a reason that will not go away by itself turns the button off.
	const blocked = probe && !probe.ok && probe.reason !== 'noSprite' ? probe : undefined;

	return (
		<IconButton
			disabled={!!blocked}
			icon={<IconColorPicker />}
			label={t('dialogs.passageEdit.scenePreview.grade.matchBg')}
			onClick={() => {
				const now = probeMatch(root, id);

				setProbe(now);

				if (now.ok) {
					onApply(now.grade);
				}
			}}
			tooltipLabel={t(
				blocked
					? REASON_KEYS[blocked.reason]
					: 'dialogs.passageEdit.scenePreview.grade.matchBgHint'
			)}
		/>
	);
};
