import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {
	MemoryRouter,
	Prompt,
	Route,
	Switch,
	useHistory
} from 'react-router-dom';
import {NavConfirm} from '../nav-confirm';
import {useNavConfirm} from '../use-nav-confirm';

const Editor: React.FC<{blocked: boolean}> = ({blocked}) => {
	const history = useHistory();

	return (
		<>
			<Prompt message="mock-leave-message" when={blocked} />
			<div>mock-editor</div>
			<button onClick={() => history.goBack()}>mock-back</button>
		</>
	);
};

describe('<NavConfirm>', () => {
	function renderComponent(blocked: boolean) {
		const Harness: React.FC = () => {
			const {getUserConfirmation, request} = useNavConfirm();

			return (
				// Index 1 so that going back is a POP to the story list, which is
				// what the browser's own Back button does.
				<MemoryRouter
					getUserConfirmation={getUserConfirmation}
					initialEntries={['/', '/edit']}
					initialIndex={1}
				>
					<NavConfirm request={request} />
					<Switch>
						<Route path="/edit">
							<Editor blocked={blocked} />
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

	function goBack() {
		fireEvent.click(screen.getByText('mock-back'));
	}

	it('navigates without asking when nothing blocks it', () => {
		renderComponent(false);
		goBack();
		expect(screen.getByText('mock-story-list')).toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('shows the blocking message instead of navigating', () => {
		renderComponent(true);
		goBack();
		expect(
			screen.getByRole('dialog', {name: 'mock-leave-message'})
		).toBeInTheDocument();
		expect(screen.getByText('mock-editor')).toBeInTheDocument();
		expect(screen.queryByText('mock-story-list')).not.toBeInTheDocument();
	});

	it('stays put when the author declines', () => {
		renderComponent(true);
		goBack();
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.navConfirm.stay'})
		);
		expect(screen.getByText('mock-editor')).toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('navigates when the author confirms', () => {
		renderComponent(true);
		goBack();
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.navConfirm.leave'})
		);
		expect(screen.getByText('mock-story-list')).toBeInTheDocument();
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('asks again on a second attempt after declining once', () => {
		renderComponent(true);
		goBack();
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.navConfirm.stay'})
		);
		goBack();
		expect(
			screen.getByRole('dialog', {name: 'mock-leave-message'})
		).toBeInTheDocument();
	});

	it('renders nothing when there is no request', () => {
		const {container} = render(<NavConfirm request={null} />);

		expect(container).toBeEmptyDOMElement();
	});

	it('is accessible', async () => {
		const {container} = renderComponent(true);

		goBack();
		expect(await axe(container)).toHaveNoViolations();
	});
});
