import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {RouteToolbar} from '../../../components/route-toolbar';
import {
	AppActions,
	BuildActions,
	SyncActions,
	SyncStatus
} from '../../../route-actions';
import {Story} from '../../../store/stories';
import {Point} from '../../../util/geometry';
import {BuildInfo} from './build-info';
import {PassageActions} from './passage/passage-actions';
import {StoryActions} from './story/story-actions';
import {StoryPresence} from './story-presence';
import {UndoRedoButtons} from './undo-redo-buttons';
import {ZoomButtons} from './zoom-buttons';

export interface StoryEditToolbarProps {
	getCenter: () => Point;
	onOpenFuzzyFinder: () => void;
	story: Story;
}

export const StoryEditToolbar: React.FC<StoryEditToolbarProps> = props => {
	const {getCenter, onOpenFuzzyFinder, story} = props;
	const {t} = useTranslation();

	return (
		<RouteToolbar
			leadingControls={<SyncStatus />}
			pinnedControls={
				<>
					<ZoomButtons story={story} />
					<UndoRedoButtons />
				</>
			}
			statusControls={<StoryPresence storyId={story.id} />}
			trailingControls={<BuildInfo />}
			tabs={{
				[t('common.passage')]: (
					<PassageActions
						getCenter={getCenter}
						onOpenFuzzyFinder={onOpenFuzzyFinder}
						story={story}
					/>
				),
				[t('common.story')]: <StoryActions story={story} />,
				[t('common.build')]: <BuildActions story={story} />,
				[t('common.appName')]: <AppActions />,
				[t('common.sync')]: <SyncActions story={story} />
			}}
		/>
	);
};
