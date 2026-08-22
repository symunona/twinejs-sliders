import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {fakeStory} from '../../../../../test-util';
import {SyncStoryButton, SyncStoryButtonProps} from '../sync-story-button';

describe('<SyncStoryButton>', () => {
	async function renderComponent(props?: Partial<SyncStoryButtonProps>) {
		const result = render(
			<SyncStoryButton onSetSync={jest.fn()} story={fakeStory()} {...props} />
		);

		await act(() => Promise.resolve());
		return result;
	}

	it('is disabled when no story is selected', async () => {
		await renderComponent({story: undefined});
		expect(screen.getByTestId('story-sync-toggle')).toBeDisabled();
	});

	it('is unchecked when the story does not sync', async () => {
		await renderComponent({story: fakeStory()});
		expect(screen.getByTestId('story-sync-toggle')).toHaveAttribute(
			'aria-checked',
			'false'
		);
	});

	it('is checked when the story syncs', async () => {
		await renderComponent({story: {...fakeStory(), sync: true}});
		expect(screen.getByTestId('story-sync-toggle')).toHaveAttribute(
			'aria-checked',
			'true'
		);
	});

	it('turns syncing on when clicked', async () => {
		const onSetSync = jest.fn();
		const story = fakeStory();

		await renderComponent({onSetSync, story});
		fireEvent.click(screen.getByTestId('story-sync-toggle'));
		expect(onSetSync).toHaveBeenCalledWith(story, true);
	});

	it('turns syncing off when clicked again', async () => {
		const onSetSync = jest.fn();
		const story = {...fakeStory(), sync: true};

		await renderComponent({onSetSync, story});
		fireEvent.click(screen.getByTestId('story-sync-toggle'));
		expect(onSetSync).toHaveBeenCalledWith(story, false);
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
