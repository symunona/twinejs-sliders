import {render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {fakePassage} from '../../../test-util';
import {PassageCardGroup, PassageCardGroupProps} from '../passage-card-group';

jest.mock('../passage-card');
jest.mock('react-transition-group');

describe('<PassageCardGroup>', () => {
	function renderComponent(props?: Partial<PassageCardGroupProps>) {
		return render(
			<PassageCardGroup
				onDeselect={jest.fn()}
				onEdit={jest.fn()}
				passages={[fakePassage(), fakePassage()]}
				onSelect={jest.fn()}
				tagColors={{}}
				tagDisplay="color"
				{...props}
			/>
		);
	}

	it('renders a <PassageCard> for every passage in the passages prop', () => {
		const passages = [fakePassage(), fakePassage()];

		renderComponent({passages});
		expect(
			screen.getByTestId(`mock-passage-card-${passages[0].name}`)
		).toBeInTheDocument();
	});

	it('sorts the passages top to bottom, left to right', () => {
		const passages = [fakePassage(), fakePassage(), fakePassage()];

		passages[0].top = 0;
		passages[0].left = 100;
		passages[1].top = 0;
		passages[1].left = 50;
		passages[2].top = 10;
		passages[2].left = 50;
		renderComponent({passages});

		const rendered = document.querySelectorAll<HTMLElement>('[data-testid]');

		expect(rendered[0].dataset.testid).toBe(
			`mock-passage-card-${passages[1].name}`
		);
		expect(rendered[1].dataset.testid).toBe(
			`mock-passage-card-${passages[0].name}`
		);
		expect(rendered[2].dataset.testid).toBe(
			`mock-passage-card-${passages[2].name}`
		);
	});
	
	// Ghosts are in `passages` like anything else--they sort in with the real cards, so
	// tabbing follows the map rather than the order the two arrays were joined in--and
	// `ghostIds` is the only thing saying which they are.
	it('marks the cards named by ghostIds as ghosts', () => {
		const passages = [fakePassage(), fakePassage()];

		renderComponent({ghostIds: new Set([passages[1].id]), passages});
		expect(
			screen.getByTestId(`mock-passage-card-${passages[0].name}`)
		).toHaveAttribute('data-ghost', 'false');
		expect(
			screen.getByTestId(`mock-passage-card-${passages[1].name}`)
		).toHaveAttribute('data-ghost', 'true');
	});

	it.todo('passes through drag-related props');

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
