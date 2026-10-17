import {act, render, screen} from '@testing-library/react';
import {createMemoryHistory} from 'history';
import {axe} from 'jest-axe';
import * as React from 'react';
import {Router} from 'react-router-dom';
import {useStoriesContext} from '../../../../store/stories';
import {FakeStateProvider} from '../../../../test-util';
import {StoryEditToolbar} from '../story-edit-toolbar';

const TestStoryEditToolbar = () => {
	const {stories} = useStoriesContext();

	return (
		<StoryEditToolbar
			getCenter={() => ({left: 0, top: 0})}
			story={stories[0]}
			onOpenFuzzyFinder={jest.fn()}
			setCenter={jest.fn()}
		/>
	);
};

describe('<StoryEditToolbar>', () => {
	async function renderComponent() {
		const result = render(
			<Router history={createMemoryHistory()}>
				<FakeStateProvider>
					<TestStoryEditToolbar />
				</FakeStateProvider>
			</Router>
		);

		await act(() => Promise.resolve());
		return result;
	}

	it('displays a Passage tab', async () => {
		await renderComponent();
		expect(screen.getByText('common.passage')).toBeInTheDocument();
	});

	it('displays a Story tab', async () => {
		await renderComponent();
		expect(screen.getByText('common.story')).toBeInTheDocument();
	});

	it('displays a Build tab', async () => {
		await renderComponent();
		expect(screen.getByText('common.build')).toBeInTheDocument();
	});

	it('displays an app tab', async () => {
		await renderComponent();
		expect(screen.getByText('common.appName')).toBeInTheDocument();
	});

	it('displays an Assets link between the app and Sync tabs', async () => {
		await renderComponent();

		// Links sit beside the tablist in the DOM; CSS `order` places them among the tabs.
		const items = Array.from(
			document.querySelectorAll<HTMLElement>('.route-toolbar-tab')
		)
			.sort((a, b) => Number(a.style.order) - Number(b.style.order))
			.map(item => item.textContent);

		expect(items.slice(-3)).toEqual([
			'common.appName',
			'routes.storyEdit.toolbar.slidersAssets',
			'common.sync'
		]);
	});

	it('displays undo/redo buttons', async () => {
		await renderComponent();
		expect(screen.getByText('common.undo')).toBeInTheDocument();
	});

	it('displays zoom buttons', async () => {
		await renderComponent();
		expect(
			screen.getByText('routes.storyEdit.zoomButtons.legend')
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
