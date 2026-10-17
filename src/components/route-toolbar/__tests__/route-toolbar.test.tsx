import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {RouteToolbar, RouteToolbarProps} from '../route-toolbar';

jest.mock('../back-button');

describe('<RouteToolbar>', () => {
	function renderComponent(props?: Partial<RouteToolbarProps>) {
		return render(
			<RouteToolbar
				tabs={{'test-tab': <div>test tab content</div>}}
				{...props}
			/>
		);
	}

	it('displays a back button', () => {
		renderComponent();
		expect(screen.getByTestId('mock-back-button')).toBeInTheDocument();
	});

	// Every tab's content stays mounted, hidden with CSS, so that the keyboard
	// shortcuts its buttons register keep working whichever tab is showing.

	function panelFor(testId: string) {
		return screen.getByTestId(testId).closest('.react-tabs__tab-panel');
	}

	it('displays tabs defined by the tabs prop', () => {
		renderComponent({
			tabs: {
				'mock-tab-1': <div data-testid="mock-tab-content-1" />,
				'mock-tab-2': <div data-testid="mock-tab-content-2" />
			}
		});

		expect(screen.getAllByRole('tab').length).toBe(2);
		expect(panelFor('mock-tab-content-1')).toHaveClass(
			'react-tabs__tab-panel--selected'
		);
		expect(panelFor('mock-tab-content-2')).not.toHaveClass(
			'react-tabs__tab-panel--selected'
		);
		fireEvent.click(screen.getByText('mock-tab-2'));
		expect(panelFor('mock-tab-content-1')).not.toHaveClass(
			'react-tabs__tab-panel--selected'
		);
		expect(panelFor('mock-tab-content-2')).toHaveClass(
			'react-tabs__tab-panel--selected'
		);
	});

	it('keeps unselected tab content mounted', () => {
		renderComponent({
			tabs: {
				'mock-tab-1': <div data-testid="mock-tab-content-1" />,
				'mock-tab-2': <div data-testid="mock-tab-content-2" />
			}
		});

		expect(screen.getByTestId('mock-tab-content-2')).toBeInTheDocument();
	});

	it('renders a link entry in the tab row that runs on one click and has no panel', () => {
		const onClick = jest.fn();

		renderComponent({
			tabs: {
				'mock-tab-1': <div data-testid="mock-tab-content-1" />,
				'mock-link': {commandId: 'sliders.assets', onClick},
				'mock-tab-2': <div data-testid="mock-tab-content-2" />
			}
		});

		expect(screen.getAllByRole('tab').length).toBe(2);
		expect(screen.getAllByRole('tabpanel', {hidden: true}).length).toBe(2);

		const link = screen.getByRole('button', {name: 'mock-link'});
		// Links sit beside the tablist in the DOM; CSS `order` places them among the tabs.
		const items = Array.from(
			document.querySelectorAll<HTMLElement>('.route-toolbar-tab')
		)
			.sort((a, b) => Number(a.style.order) - Number(b.style.order))
			.map(item => item.textContent);

		expect(items).toEqual(['mock-tab-1', 'mock-link', 'mock-tab-2']);
		fireEvent.click(link);
		expect(onClick).toHaveBeenCalledTimes(1);
		// Did not change the selected tab.
		expect(panelFor('mock-tab-content-1')).toHaveClass(
			'react-tabs__tab-panel--selected'
		);
	});

	it('displays a help button that opens the URL given in helpUrl prop in a new tab', () => {
		const openSpy = jest
			.spyOn(window, 'open')
			.mockReturnValue(undefined as any);

		renderComponent({helpUrl: 'mock-help-url'});
		expect(openSpy).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole('button', {name: 'common.help'}));
		expect(openSpy.mock.calls).toEqual([['mock-help-url', '_blank']]);
	});

	it('displays pinned controls', () => {
		renderComponent({pinnedControls: <div data-testid="pinned-control" />});
		expect(screen.getByTestId('pinned-control')).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
