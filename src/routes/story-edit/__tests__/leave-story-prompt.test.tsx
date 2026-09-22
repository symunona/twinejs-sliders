import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route, Switch, useHistory} from 'react-router-dom';
import {NavConfirm, useNavConfirm} from '../../nav-confirm';
import {
	UndoableStoriesContext,
	UndoableStoriesContextProps
} from '../../../store/undoable-stories';
import {LeaveStoryPrompt} from '../leave-story-prompt';

const BackButton: React.FC = () => {
	const history = useHistory();

	return <button onClick={() => history.goBack()}>mock-back</button>;
};

describe('<LeaveStoryPrompt>', () => {
	function renderComponent(context?: Partial<UndoableStoriesContextProps>) {
		const Harness: React.FC = () => {
			const {getUserConfirmation, request} = useNavConfirm();

			return (
				<MemoryRouter
					getUserConfirmation={getUserConfirmation}
					initialEntries={['/', '/stories/mock-story-id']}
					initialIndex={1}
				>
					<NavConfirm request={request} />
					<Switch>
						<Route path="/stories/:storyId">
							<UndoableStoriesContext.Provider
								value={{
									changeCount: 0,
									dispatch: jest.fn(),
									stories: [],
									...context
								}}
							>
								<LeaveStoryPrompt />
							</UndoableStoriesContext.Provider>
							<div>mock-story-edit</div>
							<BackButton />
						</Route>
						<Route path="/">
							<div>mock-story-list</div>
						</Route>
					</Switch>
				</MemoryRouter>
			);
		};

		return render(<Harness />);
	}

	it('leaves without asking when the session made no changes', () => {
		renderComponent({changeCount: 0});
		fireEvent.click(screen.getByText('mock-back'));
		expect(screen.getByText('mock-story-list')).toBeInTheDocument();
	});

	it('asks before leaving when the session made changes', () => {
		renderComponent({changeCount: 1});
		fireEvent.click(screen.getByText('mock-back'));
		expect(
			screen.getByRole('dialog', {name: 'routes.storyEdit.leaveConfirm'})
		).toBeInTheDocument();
		expect(screen.getByText('mock-story-edit')).toBeInTheDocument();
	});
});
