import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {
	HashRouter,
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

	// Right-button presses not dismissing it: browser-checked only. focus-trap never
	// arms its outside-click listener under jsdom, so a left press does not dismiss either.

	describe('under a hash router', () => {
		// The browser has moved the URL before anyone asks. Start the router on the
		// editor so history has never seen the story list -- what a reload leaves.
		beforeEach(() => {
			window.location.hash = '#/';
			window.location.hash = '#/edit';
		});

		function renderHash() {
			const Harness: React.FC = () => {
				const {getUserConfirmation, request} = useNavConfirm();

				return (
					<HashRouter getUserConfirmation={getUserConfirmation}>
						<NavConfirm request={request} />
						<Switch>
							<Route path="/edit">
								<Editor blocked />
							</Route>
							<Route path="/">
								<div>mock-story-list</div>
							</Route>
						</Switch>
					</HashRouter>
				);
			};

			return render(<Harness />);
		}

		it('puts the URL back when the author stays, and asks again next time', async () => {
			renderHash();
			goBack();
			await screen.findByRole('dialog', {name: 'mock-leave-message'});
			expect(window.location.hash).toBe('#/');
			fireEvent.click(
				screen.getByRole('button', {name: 'routes.navConfirm.stay'})
			);
			expect(window.location.hash).toBe('#/edit');
			expect(screen.getByText('mock-editor')).toBeInTheDocument();
			goBack();
			await screen.findByRole('dialog', {name: 'mock-leave-message'});
		});

		it('leaves when the author confirms', async () => {
			renderHash();
			goBack();
			await screen.findByRole('dialog', {name: 'mock-leave-message'});
			fireEvent.click(
				screen.getByRole('button', {name: 'routes.navConfirm.leave'})
			);
			await waitFor(() =>
				expect(screen.getByText('mock-story-list')).toBeInTheDocument()
			);
			expect(window.location.hash).toBe('#/');
		});
	});
});
