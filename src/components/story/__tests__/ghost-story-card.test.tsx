import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import type {StoryIndexEntry} from '../../../store/persistence/server/server.types';
import {GhostStoryCard, GhostStoryCardProps} from '../ghost-story-card';

// Stable `t` that shows its options, so a prompt can be checked for the story's name.
jest.mock('react-i18next', () => {
	const t = (key: string, options?: Record<string, unknown>) =>
		options ? `${key} ${JSON.stringify(options)}` : key;

	return {useTranslation: () => ({t})};
});

function fakeEntry(props?: Partial<StoryIndexEntry>): StoryIndexEntry {
	return {
		assetBytes: 41221904,
		assetCount: 31,
		bytes: 214880,
		deleted: false,
		id: 'mock-story-id',
		ifid: 'mock-ifid',
		lastClient: 'mira',
		name: 'Lighthouse',
		passageCount: 83,
		rev: 42,
		updatedAt: new Date().toISOString(),
		...props
	};
}

describe('<GhostStoryCard>', () => {
	function renderComponent(props?: Partial<GhostStoryCardProps>) {
		return render(
			<GhostStoryCard entry={fakeEntry()} onCheckOut={jest.fn()} {...props} />
		);
	}

	it('renders the story name in a testable attribute', () => {
		renderComponent();
		expect(screen.getByTestId('ghost-story-card').dataset.storyName).toBe(
			'Lighthouse'
		);
	});

	it('says the story is on the server', () => {
		renderComponent();
		expect(
			screen.getByText('routes.storyList.server.onServer', {exact: false})
		).toBeInTheDocument();
	});

	it('renders the passage count, size and update time', () => {
		renderComponent();
		expect(
			screen.getByText('components.storyCard.passageCount', {exact: false})
		).toBeInTheDocument();
		expect(
			screen.getByText('routes.storyList.server.ghostSize', {exact: false})
		).toBeInTheDocument();
		expect(
			screen.getByText('routes.storyList.server.ghostUpdated', {exact: false})
		).toBeInTheDocument();
	});

	it('checks the story out when its button is clicked', async () => {
		const onCheckOut = jest.fn().mockResolvedValue(undefined);

		renderComponent({onCheckOut});
		fireEvent.click(screen.getByTestId('ghost-checkout'));
		expect(onCheckOut).toHaveBeenCalledTimes(1);
		await act(() => Promise.resolve());
	});

	it('shows progress while a checkout runs', async () => {
		let finish = () => {};
		const onCheckOut = jest.fn(
			() => new Promise<void>(resolve => (finish = resolve))
		);

		renderComponent({onCheckOut});
		expect(
			screen.queryByTestId('ghost-checkout-progress')
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByTestId('ghost-checkout'));
		expect(screen.getByTestId('ghost-checkout-progress')).toBeInTheDocument();
		expect(screen.getByTestId('ghost-checkout')).toBeDisabled();

		await act(async () => {
			finish();
		});

		expect(
			screen.queryByTestId('ghost-checkout-progress')
		).not.toBeInTheDocument();
	});

	it('has no delete button without onDelete', () => {
		renderComponent();
		expect(screen.queryByTestId('ghost-delete')).not.toBeInTheDocument();
	});

	it('deletes only after a confirmation that names the story', async () => {
		const onDelete = jest.fn().mockResolvedValue(undefined);

		renderComponent({onDelete});
		fireEvent.click(screen.getByTestId('ghost-delete'));
		expect(onDelete).not.toHaveBeenCalled();

		const dialog = screen.getByRole('dialog');

		expect(dialog).toHaveTextContent(
			'routes.storyList.server.deleteFromServerWarning'
		);
		expect(dialog).toHaveTextContent('Lighthouse');
		fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'routes.storyList.server.deleteFromServer'
			})
		);
		expect(onDelete).toHaveBeenCalledTimes(1);
		await act(() => Promise.resolve());
	});

	it('does not delete when the confirmation is cancelled', () => {
		const onDelete = jest.fn();

		renderComponent({onDelete});
		fireEvent.click(screen.getByTestId('ghost-delete'));
		fireEvent.click(
			within(screen.getByRole('dialog')).getByRole('button', {
				name: 'common.cancel'
			})
		);
		expect(onDelete).not.toHaveBeenCalled();
	});

	it('says so when the delete fails', async () => {
		const onDelete = jest.fn().mockRejectedValue(new Error('nope'));

		renderComponent({onDelete});
		fireEvent.click(screen.getByTestId('ghost-delete'));
		fireEvent.click(
			within(screen.getByRole('dialog')).getByRole('button', {
				name: 'routes.storyList.server.deleteFromServer'
			})
		);
		expect(await screen.findByRole('alert')).toHaveTextContent('nope');
	});

	it('puts the creation date in the title tooltip', () => {
		const onPeekCreated = jest.fn();

		renderComponent({
			created: {at: '2026-08-01T12:00:00.000Z', exact: true},
			onPeekCreated
		});

		const title = screen.getByTestId('story-card-title');

		expect(title.getAttribute('title')).toContain(
			'components.storyCard.createdOn '
		);
		fireEvent.mouseEnter(title);
		expect(onPeekCreated).toHaveBeenCalledTimes(1);
	});

	it('marks a creation date from a pruned history as an upper bound', () => {
		renderComponent({created: {at: '2026-08-01T12:00:00.000Z', exact: false}});
		expect(
			screen.getByTestId('story-card-title').getAttribute('title')
		).toContain('components.storyCard.createdOnOrBefore');
	});

	it('has no title tooltip before the date is known', () => {
		renderComponent();
		expect(screen.getByTestId('story-card-title')).not.toHaveAttribute('title');
	});

	it('is not selectable', () => {
		renderComponent();
		expect(screen.queryByRole('button', {name: 'Lighthouse'})).toBeNull();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});

	it('is accessible with a delete button', async () => {
		const {container} = renderComponent({onDelete: jest.fn()});

		expect(await axe(container)).toHaveNoViolations();
	});
});
