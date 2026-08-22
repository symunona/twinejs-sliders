import {IconCheck, IconTrash, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../../../components/container/button-bar';
import {CardContent} from '../../../../components/container/card';
import {CardButton} from '../../../../components/control/card-button';
import {CheckboxButton} from '../../../../components/control/checkbox-button';
import {ConfirmButton} from '../../../../components/control/confirm-button';
import {IconButton} from '../../../../components/control/icon-button';
import {useCommand} from '../../../../hotkeys';
import type {SyncRecord} from '../../../../store/persistence/server/server.types';
import {deleteStory, Story, useStoriesContext} from '../../../../store/stories';
import {isElectronRenderer} from '../../../../util/is-electron';
import {TestId} from './test-id';

export interface DeleteStoryButtonProps {
	/** Called after the local delete, only if the person asked for it. */
	onRemoveFromServer?: (story: Story) => Promise<unknown> | unknown;
	story?: Story;
	/** Set if the story is known to the server--controls the extra checkbox. */
	syncRecord?: SyncRecord;
}

export const DeleteStoryButton: React.FC<DeleteStoryButtonProps> = ({
	onRemoveFromServer,
	story,
	syncRecord
}) => {
	// We need to store a local copy of the story name so that after it's deleted,
	// the prompt doesn't change as it transitions out.
	const [storyName, setStoryName] = React.useState(story?.name);
	const [alsoRemoveFromServer, setAlsoRemoveFromServer] = React.useState(false);
	const [confirmOpen, setConfirmOpen] = React.useState(false);
	const {dispatch} = useStoriesContext();
	const {t} = useTranslation();

	useCommand({
		enabled: !!story,
		id: 'story.delete',
		label: t('hotkeys.commands.story.delete'),
		run: () => setConfirmOpen(true),
		scope: 'story-list'
	});

	React.useEffect(() => {
		if (story?.name) {
			setStoryName(story.name);
		}
	}, [story?.name]);

	const prompt = t(
		`routes.storyList.toolbar.deleteStoryButton.warning.${
			isElectronRenderer() ? 'electron' : 'web'
		}`,
		{storyName}
	);

	function handleConfirm() {
		if (!story) {
			return;
		}

		dispatch(deleteStory(story));

		// After the local delete: a failing network must never stop a story leaving this
		// browser.

		if (alsoRemoveFromServer) {
			void onRemoveFromServer?.(story);
		}

		setAlsoRemoveFromServer(false);
		setConfirmOpen(false);
	}

	function handleChangeOpen(value: boolean) {
		setConfirmOpen(value);

		if (!value) {
			setAlsoRemoveFromServer(false);
		}
	}

	// Stories the server has never heard of get the plain confirmation.

	if (!syncRecord) {
		return (
			<ConfirmButton
				confirmIcon={<IconTrash />}
				onChangeOpen={setConfirmOpen}
				open={confirmOpen}
				confirmLabel={t('common.delete')}
				confirmVariant="danger"
				disabled={!story}
				icon={<IconTrash />}
				label={t('common.delete')}
				onConfirm={story ? () => dispatch(deleteStory(story)) : () => {}}
				prompt={prompt}
			/>
		);
	}

	return (
		<span className="confirm-button">
			<CardButton
				ariaLabel={prompt}
				disabled={!story}
				icon={<IconTrash />}
				label={t('common.delete')}
				onChangeOpen={handleChangeOpen}
				open={confirmOpen}
			>
				<div>
					<CardContent>{prompt}</CardContent>
					<CardContent>
						<TestId testId="delete-also-remove-server">
							<CheckboxButton
								label={t('routes.storyList.server.alsoRemoveFromServer')}
								onChange={setAlsoRemoveFromServer}
								value={alsoRemoveFromServer}
							/>
						</TestId>
					</CardContent>
					<ButtonBar>
						<IconButton
							icon={<IconCheck />}
							label={t('common.delete')}
							onClick={handleConfirm}
							variant="danger"
						/>
						<IconButton
							icon={<IconX />}
							label={t('common.cancel')}
							onClick={() => handleChangeOpen(false)}
						/>
					</ButtonBar>
				</div>
			</CardButton>
		</span>
	);
};
