import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {useStoriesContext} from '../../../../../store/stories';
import {FakeStateProvider, StoryInspector} from '../../../../../test-util';
import type {SyncRecord} from '../../../../../store/persistence/server/server.types';
import {isElectronRenderer} from '../../../../../util/is-electron';
import {
	DeleteStoryButton,
	DeleteStoryButtonProps
} from '../delete-story-button';

function fakeSyncRecord(props?: Partial<SyncRecord>): SyncRecord {
	return {
		pushedHash: 'mock-hash',
		rev: 3,
		state: 'idle',
		storyId: 'mock-story-id',
		...props
	};
}

jest.mock('../../../../../util/is-electron');

const TestDeleteStoryButton: React.FC<DeleteStoryButtonProps> = props => {
	const {stories} = useStoriesContext();

	return <DeleteStoryButton story={stories[0]} {...props} />;
};

describe('<DeleteStoryButton>', () => {
	const isElectronRendererMock = isElectronRenderer as jest.Mock;

	async function renderComponent(props?: Partial<DeleteStoryButtonProps>) {
		const result = render(
			<FakeStateProvider>
				<TestDeleteStoryButton {...props} />
				<StoryInspector />
			</FakeStateProvider>
		);

		// Need this because of <PromptButton>
		await act(() => Promise.resolve());
		return result;
	}

	it('shows an Electron-specific prompt when the delete button is clicked in an Electorn context', async () => {
		isElectronRendererMock.mockReturnValue(true);
		await renderComponent();
		fireEvent.click(screen.getByText('common.delete'));
		expect(
			await screen.findByText(
				'routes.storyList.toolbar.deleteStoryButton.warning.electron'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText(
				'routes.storyList.toolbar.deleteStoryButton.warning.web'
			)
		).not.toBeInTheDocument();
	});

	it('shows a web-specific prompt when the delete button is clicked in a web context', async () => {
		isElectronRendererMock.mockReturnValue(false);
		await renderComponent();
		fireEvent.click(screen.getByText('common.delete'));
		expect(
			await screen.findByText(
				'routes.storyList.toolbar.deleteStoryButton.warning.web'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText(
				'routes.storyList.toolbar.deleteStoryButton.warning.electron'
			)
		).not.toBeInTheDocument();
	});

	it('deletes the story when the delete confirmation button is clicked', async () => {
		await renderComponent();
		expect(screen.getByTestId('story-inspector-default')).toBeInTheDocument();
		fireEvent.click(screen.getByText('common.delete'));
		fireEvent.click(
			await screen.findByText('common.delete', {
				selector: '.card-button-card button'
			})
		);
		expect(
			screen.queryByTestId('story-inspector-default')
		).not.toBeInTheDocument();
	});

	it('does not offer to remove the story from the server when it has no sync record', async () => {
		await renderComponent();
		fireEvent.click(screen.getByText('common.delete'));
		await act(() => Promise.resolve());
		expect(
			screen.queryByTestId('delete-also-remove-server')
		).not.toBeInTheDocument();
	});

	it('offers to remove the story from the server when it has a sync record', async () => {
		await renderComponent({syncRecord: fakeSyncRecord()});
		fireEvent.click(screen.getByText('common.delete'));
		await act(() => Promise.resolve());

		const checkbox = await screen.findByTestId('delete-also-remove-server');

		expect(checkbox).toHaveAttribute('aria-checked', 'false');
	});

	it('does not remove the story from the server unless asked to', async () => {
		const onRemoveFromServer = jest.fn();

		await renderComponent({
			onRemoveFromServer,
			syncRecord: fakeSyncRecord()
		});
		fireEvent.click(screen.getByText('common.delete'));
		fireEvent.click(
			await screen.findByText('common.delete', {
				selector: '.card-button-card button'
			})
		);
		expect(onRemoveFromServer).not.toHaveBeenCalled();
		expect(
			screen.queryByTestId('story-inspector-default')
		).not.toBeInTheDocument();
	});

	it('removes the story from the server when asked to', async () => {
		const onRemoveFromServer = jest.fn();

		await renderComponent({
			onRemoveFromServer,
			syncRecord: fakeSyncRecord()
		});
		fireEvent.click(screen.getByText('common.delete'));
		fireEvent.click(await screen.findByTestId('delete-also-remove-server'));
		fireEvent.click(
			await screen.findByText('common.delete', {
				selector: '.card-button-card button'
			})
		);
		expect(onRemoveFromServer).toHaveBeenCalledTimes(1);
		expect(
			screen.queryByTestId('story-inspector-default')
		).not.toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});

	it('is accessible with a sync record', async () => {
		const {container} = await renderComponent({syncRecord: fakeSyncRecord()});

		expect(await axe(container)).toHaveNoViolations();
	});
});
