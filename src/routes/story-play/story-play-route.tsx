import * as React from 'react';
import {useParams} from 'react-router-dom';
import {replaceDom} from '../../util/replace-dom';
import {usePublishing} from '../../store/use-publishing';
import {ErrorMessage} from '../../components/error';

export const StoryPlayRoute: React.FC = () => {
	const [publishError, setPublishError] = React.useState<Error>();
	const [inited, setInited] = React.useState(false);
	const {storyId} = useParams<{storyId: string}>();
	const {publishStory} = usePublishing();

	React.useEffect(() => {
		async function load() {
			try {
				// `blob`, not `data`: replaceDom rewrites this tab's document but keeps its
				// Window, so object URLs minted while publishing stay resolvable — and
				// playing a story should not wait on base64ing its whole art library.
				replaceDom(await publishStory(storyId, {slidersUrls: 'blob'}));
			} catch (error) {
				setPublishError(error as Error);
			}
		}

		if (!inited) {
			setInited(true);
			load();
		}
	}, [inited, publishStory, storyId]);

	if (publishError) {
		return <ErrorMessage>{publishError.message}</ErrorMessage>;
	}

	return null;
};
