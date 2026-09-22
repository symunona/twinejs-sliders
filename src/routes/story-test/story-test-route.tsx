import * as React from 'react';
import {useLocation, useParams} from 'react-router-dom';
import {replaceDom} from '../../util/replace-dom';
import {usePublishing} from '../../store/use-publishing';
import {ErrorMessage} from '../../components/error';

export const StoryTestRoute: React.FC = () => {
	const [publishError, setPublishError] = React.useState<Error>();
	const [inited, setInited] = React.useState(false);
	const {passageId, storyId} = useParams<{
		passageId: string;
		storyId: string;
	}>();
	// "Test from this beat" (Alt+T in the scene preview). A query parameter, so the route
	// pattern is the one it always was and a bookmarked test link still opens.
	const {search} = useLocation();
	const startBeat = Number.parseInt(
		new URLSearchParams(search).get('beat') ?? '',
		10
	);
	const {publishStory} = usePublishing();

	React.useEffect(() => {
		async function load() {
			try {
				replaceDom(
					await publishStory(storyId, {
						formatOptions: 'debug',
						startBeat: Number.isFinite(startBeat) ? startBeat : undefined,
						// See story-play-route: replaceDom keeps this tab's Window, so
						// object URLs survive it.
						slidersUrls: 'blob',
						startId: passageId
					})
				);
			} catch (error) {
				setPublishError(error as Error);
			}
		}

		if (!inited) {
			setInited(true);
			load();
		}
		// `startBeat` is in the list only to satisfy the dependency rule: the effect runs
		// once, guarded by `inited`, and the number cannot change within a mounted route.
	}, [inited, passageId, publishStory, startBeat, storyId]);

	if (publishError) {
		return <ErrorMessage>{publishError.message}</ErrorMessage>;
	}

	return null;
};
