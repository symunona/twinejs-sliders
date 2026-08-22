import * as React from 'react';
import {ButtonBar} from '../../../../components/container/button-bar';
import {RenameStoryButton} from '../../../../components/story/rename-story-button';
import {useServerSyncContext} from '../../../../store/persistence/server';
import {Story, updateStory, useStoriesContext} from '../../../../store/stories';
import {CreateStoryButton} from './create-story-button';
import {DeleteStoryButton} from './delete-story-button';
import {DuplicateStoryButton} from './duplicate-story-button';
import {EditStoryButton} from './edit-story-button';
import {PublishStoryButton} from './publish-story-button';
import {RemoveFromServerButton} from './remove-from-server-button';
import {RepublishStoryButton} from './republish-story-button';
import {ResolveConflictButton} from './resolve-conflict-button';
import {SyncStoryButton} from './sync-story-button';
import {TagStoryButton} from './tag-story-button';

export interface StoryActionsProps {
	selectedStory?: Story;
}

export const StoryActions: React.FC<StoryActionsProps> = props => {
	const {selectedStory} = props;
	const {dispatch, stories} = useStoriesContext();
	const {actions, index, records} = useServerSyncContext();
	const record = selectedStory ? records[selectedStory.id] : undefined;
	const existsOnServer =
		!!selectedStory && index.some(entry => entry.id === selectedStory.id);

	function handleRemoveFromServer(story: Story) {
		return actions.removeFromServer(story.id);
	}

	return (
		<ButtonBar>
			<CreateStoryButton />
			<EditStoryButton story={selectedStory} />
			<TagStoryButton story={selectedStory} />
			<RenameStoryButton
				existingStories={stories}
				onRename={name =>
					dispatch(updateStory(stories, selectedStory!, {name}))
				}
				story={selectedStory}
			/>
			<DuplicateStoryButton story={selectedStory} />
			{selectedStory?.sync !== true && (
				<PublishStoryButton
					existsOnServer={existsOnServer}
					onPublish={actions.publish}
					story={selectedStory}
				/>
			)}
			<SyncStoryButton onSetSync={actions.setSync} story={selectedStory} />
			{record?.state === 'gone' && (
				<RepublishStoryButton
					onRepublish={actions.republish}
					story={selectedStory}
				/>
			)}
			{record?.state === 'conflict' && (
				<ResolveConflictButton story={selectedStory} />
			)}
			<RemoveFromServerButton
				disabled={!record}
				onRemoveFromServer={handleRemoveFromServer}
				story={selectedStory}
			/>
			<DeleteStoryButton
				onRemoveFromServer={handleRemoveFromServer}
				story={selectedStory}
				syncRecord={record}
			/>
		</ButtonBar>
	);
};
