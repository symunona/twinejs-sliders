import {IconArrowLeft, IconCloudDownload, IconRefresh} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useHistory, useParams} from 'react-router-dom';
import {ButtonBar} from '../../components/container/button-bar';
import {Card, CardContent} from '../../components/container/card';
import {IconButton} from '../../components/control/icon-button';
import {LoadingCurtain} from '../../components/loading-curtain/loading-curtain';
import {
	ServerError,
	useServerSyncContext
} from '../../store/persistence/server';
import {useStoriesContext} from '../../store/stories';
import './cloud-story-gate.css';

type Probe =
	| {state: 'checking'}
	| {state: 'found'; name: string; passageCount: number}
	| {state: 'missing'}
	| {state: 'error'; message: string};

/**
 * A link to a story this browser does not have — shared, or opened on another machine.
 *
 * Stories live in localStorage, so the routes under `/stories/:storyId` used to throw
 * "There is no story with ID …". With a backend set, ask it first and offer the pull.
 * The pull is never automatic: a checkout writes into the local library.
 *
 * No backend, or the story already local: children render untouched.
 */
export const CloudStoryGate: React.FC = ({children}) => {
	const {storyId} = useParams<{storyId: string}>();
	const {stories} = useStoriesContext();
	const {actions, client} = useServerSyncContext();
	const history = useHistory();
	const {t} = useTranslation();
	const [probe, setProbe] = React.useState<Probe>({state: 'checking'});
	const [attempt, setAttempt] = React.useState(0);
	const [pulling, setPulling] = React.useState(false);
	const [pullError, setPullError] = React.useState<string>();
	const isLocal = stories.some(story => story.id === storyId);

	React.useEffect(() => {
		if (isLocal || !client) {
			return;
		}

		let cancelled = false;

		setProbe({state: 'checking'});
		client.getStory(storyId).then(
			fetched => {
				if (cancelled || fetched === 'not-modified') {
					return;
				}

				setProbe({
					name: fetched.story.name,
					passageCount: fetched.story.passages.length,
					state: 'found'
				});
			},
			error => {
				if (cancelled) {
					return;
				}

				if (error instanceof ServerError && error.gone) {
					setProbe({state: 'missing'});
				} else {
					setProbe({
						message: error instanceof Error ? error.message : String(error),
						state: 'error'
					});
				}
			}
		);

		return () => {
			cancelled = true;
		};
	}, [attempt, client, isLocal, storyId]);

	if (isLocal || !client) {
		return <>{children}</>;
	}

	if (probe.state === 'checking') {
		return <LoadingCurtain />;
	}

	async function handlePull() {
		setPulling(true);
		setPullError(undefined);

		try {
			await actions.checkout(storyId);
		} catch (error) {
			setPullError(error instanceof Error ? error.message : String(error));
			setPulling(false);
			return;
		}

		// Boot fresh rather than flip `isLocal` in place: play, proof and test
		// `document.write` over the app, and should not do it while the checkout's
		// refresh is still settling. The story is in localStorage now, so the reload
		// opens it like any local one.
		window.location.reload();
	}

	const back = (
		<IconButton
			icon={<IconArrowLeft />}
			label={t('routes.cloudStoryGate.backToLibrary')}
			onClick={() => history.push('/')}
		/>
	);

	return (
		<div className="cloud-story-gate" data-testid="cloud-story-gate">
			<Card>
				<CardContent>
					{probe.state === 'found' && (
						<>
							<h2>{probe.name}</h2>
							<p>{t('routes.cloudStoryGate.notLocal')}</p>
							<p>
								{t('components.storyCard.passageCount', {
									count: probe.passageCount
								})}
							</p>
							{pullError && <p className="error">{pullError}</p>}
							<ButtonBar>
								<IconButton
									disabled={pulling}
									icon={<IconCloudDownload />}
									label={t(
										pulling
											? 'routes.storyList.server.checkingOut'
											: 'routes.cloudStoryGate.pull'
									)}
									onClick={handlePull}
									variant="primary"
								/>
								{back}
							</ButtonBar>
						</>
					)}
					{probe.state === 'missing' && (
						<>
							<p>{t('routes.cloudStoryGate.missing')}</p>
							<ButtonBar>{back}</ButtonBar>
						</>
					)}
					{probe.state === 'error' && (
						<>
							<p>{t('routes.cloudStoryGate.unreachable')}</p>
							<p className="error">{probe.message}</p>
							<ButtonBar>
								<IconButton
									icon={<IconRefresh />}
									label={t('routes.cloudStoryGate.retry')}
									onClick={() => setAttempt(value => value + 1)}
									variant="primary"
								/>
								{back}
							</ButtonBar>
						</>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
