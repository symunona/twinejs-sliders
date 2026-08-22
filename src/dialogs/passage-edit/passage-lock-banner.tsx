import {IconLock, IconLockOpen, IconUsers} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import type {PassageLock} from '../../store/persistence/server/presence';
import './passage-lock-banner.css';

export interface PassageLockBannerProps {
	/** `undefined` means nobody else is in this passage: render nothing at all. */
	lock?: PassageLock;
	onTakeOver: () => void;
}

/**
 * The soft lock, said out loud (spec 11).
 *
 * Two states, and the difference matters more than it looks. Before a takeover the editor
 * below is read-only and this offers the one button that changes that. After a takeover
 * both editors are writable and this is only a warning — because a takeover that kicked
 * the other person out would throw away whatever sentence they were in the middle of, and
 * with two or three people "we can both see this is happening" is enough.
 */
export const PassageLockBanner: React.FC<PassageLockBannerProps> = props => {
	const {lock, onTakeOver} = props;
	const {t} = useTranslation();

	if (!lock) {
		return null;
	}

	if (lock.shared) {
		return (
			<div
				className="passage-lock-banner shared"
				data-shared-with={lock.by.name}
				data-testid="passage-shared-banner"
			>
				<IconUsers />
				<span className="passage-lock-banner-text">
					{t('dialogs.passageEdit.lock.shared', {name: lock.by.name})}
				</span>
			</div>
		);
	}

	return (
		<div
			className="passage-lock-banner locked"
			data-locked-by={lock.by.name}
			data-testid="passage-lock-banner"
		>
			<IconLock />
			<span className="passage-lock-banner-text">
				{t('dialogs.passageEdit.lock.lockedBy', {name: lock.by.name})}
			</span>
			{/*
				A plain button rather than <IconButton>: the E2E suite clicks this by test
				id, and IconButton does not pass unknown props through to its <button>, so
				the id would land on a wrapper instead of the thing being clicked.
			*/}
			<button
				className="icon-button icon-position-start variant-primary"
				data-testid="passage-lock-takeover"
				onClick={onTakeOver}
				type="button"
			>
				<span className="icon">
					<IconLockOpen />
				</span>
				{t('dialogs.passageEdit.lock.takeOver')}
			</button>
		</div>
	);
};
