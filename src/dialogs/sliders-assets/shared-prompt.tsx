import {IconCopy, IconDeviceFloppy, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';
import type {
	EditScope,
	SharedInfo
} from '../../store/asset-library/story-asset-store';

export interface SharedPromptProps {
	info: SharedInfo;
	/** `undefined` = Cancel. */
	onAnswer: (scope: EditScope | undefined) => void;
	/** Delete has no fork: a copy of something being deleted is not deleting it. */
	allowFork?: boolean;
	className?: string;
	/** Replaces the default question. The stories list is appended either way. */
	message?: string;
	testId?: string;
	/** Label of the Update All button, e.g. "Delete for Everyone". */
	updateAllLabel?: string;
}

/** "Used in 3 stories (Ana, Bo)": the stories an Update All reaches, with who. */
export function sharedStoriesText(info: SharedInfo): string {
	return info.stories
		.map(
			story =>
				`${story.storyName ?? story.storyId}${story.by ? ` (${story.by})` : ''}`
		)
		.join(', ');
}

/**
 * Art that other stories use, or that lives in a collection the story only attaches:
 * change it for everyone, fork a copy for this story, or cancel. Locked collections
 * hide Update All. The asset editor and the Library both ask this.
 */
export const SharedPrompt: React.FC<SharedPromptProps> = props => {
	const {
		allowFork = true,
		className = 'shared-art-prompt',
		info,
		message,
		onAnswer,
		testId,
		updateAllLabel
	} = props;
	const {t} = useTranslation();

	return (
		<div
			aria-label={t('dialogs.assetEditor.sharedTitle')}
			className={className}
			data-testid={testId}
			role="alertdialog"
		>
			<p>
				{message ??
					t(
						info.stories.length
							? 'dialogs.assetEditor.sharedPrompt'
							: 'dialogs.assetEditor.sharedPromptForeign',
						{
							collection: info.collection.name,
							count: info.stories.length,
							name: info.name,
							stories: sharedStoriesText(info)
						}
					)}
				{info.collection.locked && ` ${t('dialogs.assetEditor.sharedLocked')}`}
			</p>
			<ButtonBar>
				{info.canUpdateAll && (
					<IconButton
						icon={<IconDeviceFloppy />}
						label={updateAllLabel ?? t('dialogs.assetEditor.sharedUpdateAll')}
						onClick={() => onAnswer('all')}
						variant="danger"
					/>
				)}
				{allowFork && info.canFork && (
					<IconButton
						icon={<IconCopy />}
						label={t('dialogs.assetEditor.sharedFork')}
						onClick={() => onAnswer('fork')}
						variant="create"
					/>
				)}
				<IconButton
					icon={<IconX />}
					label={t('common.cancel')}
					onClick={() => onAnswer(undefined)}
				/>
			</ButtonBar>
		</div>
	);
};
