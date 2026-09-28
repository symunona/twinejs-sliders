import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {useStoriesContext} from '../../../../store/stories';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory,
	StoryInspector
} from '../../../../test-util';
import {ZoomButtons} from '../zoom-buttons';

const TestZoomButtons: React.FC = () => {
	const {stories} = useStoriesContext();

	return <ZoomButtons story={stories[0]} />;
};

describe('<ZoomButtons>', () => {
	function renderComponent(contexts?: FakeStateProviderProps) {
		return render(
			<FakeStateProvider {...contexts}>
				<TestZoomButtons />
				<StoryInspector />
			</FakeStateProvider>
		);
	}

	function zoom() {
		return screen.getByTestId('story-inspector-default').dataset.zoom;
	}

	function renderAtZoom(zoom: number) {
		const story = fakeStory();

		story.zoom = zoom;
		renderComponent({stories: [story]});
	}

	it('shows the zoom as a percentage', () => {
		renderAtZoom(0.75);
		expect(screen.getByText('75%')).toBeInTheDocument();
	});

	it('resets the zoom to 100% when the percentage is clicked', () => {
		renderAtZoom(0.4);
		fireEvent.click(screen.getByText('40%'));
		expect(zoom()).toBe('1');
	});

	it('steps the zoom in', () => {
		renderAtZoom(1);
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.storyEdit.zoomButtons.zoomIn'})
		);
		expect(zoom()).toBe('1.25');
	});

	it('steps the zoom out', () => {
		renderAtZoom(1);
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.zoomButtons.zoomOut'
			})
		);
		expect(zoom()).toBe('0.9');
	});

	it('disables zoom in at the maximum and zoom out at the minimum', () => {
		renderAtZoom(2);
		expect(
			screen.getByRole('button', {name: 'routes.storyEdit.zoomButtons.zoomIn'})
		).toBeDisabled();
		renderAtZoom(0.2);
		expect(
			screen.getAllByRole('button', {
				name: 'routes.storyEdit.zoomButtons.zoomOut'
			})[1]
		).toBeDisabled();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();
		expect(await axe(container)).toHaveNoViolations();
	});
});
