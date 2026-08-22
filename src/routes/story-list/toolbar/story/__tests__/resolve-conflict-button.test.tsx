import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider, fakeStory} from '../../../../../test-util';
import {
	ResolveConflictButton,
	ResolveConflictButtonProps
} from '../resolve-conflict-button';

// The dialog itself talks to the server; this button's whole job is opening it.

jest.mock('../../../../../dialogs/server-conflict/server-conflict', () => {
	const react = jest.requireActual('react');

	return {
		ServerConflictDialog: (props: {storyId: string}) =>
			react.createElement('div', {
				'data-testid': `mock-server-conflict-dialog-${props.storyId}`
			})
	};
});

describe('<ResolveConflictButton>', () => {
	async function renderComponent(props?: Partial<ResolveConflictButtonProps>) {
		const result = render(
			<FakeStateProvider>
				<ResolveConflictButton story={fakeStory()} {...props} />
			</FakeStateProvider>
		);

		await act(() => Promise.resolve());
		return result;
	}

	it('is disabled when no story is selected', async () => {
		await renderComponent({story: undefined});
		expect(screen.getByTestId('story-resolve')).toBeDisabled();
	});

	it('opens the conflict dialog when clicked', async () => {
		const story = fakeStory();

		await renderComponent({story});
		fireEvent.click(screen.getByTestId('story-resolve'));
		expect(
			await screen.findByTestId(`mock-server-conflict-dialog-${story.id}`)
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
