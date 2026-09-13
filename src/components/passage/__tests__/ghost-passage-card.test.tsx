import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {GhostPassageCard, GhostPassageCardProps} from '../ghost-passage-card';
import {GhostPassage} from '../../../util/broken-link-ghosts';

describe('<GhostPassageCard>', () => {
	const ghost: GhostPassage = {
		height: 100,
		left: 40,
		linkedFrom: [],
		name: 'Cellar',
		top: 80,
		width: 100
	};

	function renderComponent(props?: Partial<GhostPassageCardProps>) {
		return render(
			<GhostPassageCard ghost={ghost} onCreate={jest.fn()} {...props} />
		);
	}

	it('names the passage it would create', () => {
		renderComponent();
		expect(
			screen.getByRole('heading', {name: 'Cellar', exact: true})
		).toBeInTheDocument();
	});

	it('is an empty passage card, not a shape of its own', () => {
		const {container} = renderComponent();
		const card = container.querySelector('.ghost-passage-card')!;

		expect(card).toHaveClass('passage-card');
		expect(card).toHaveClass('empty');
	});

	it('sits where the passage would be created', () => {
		const {container} = renderComponent();

		expect(container.querySelector('.ghost-passage-card')).toHaveStyle({
			height: '100px',
			left: '40px',
			top: '80px',
			width: '100px'
		});
	});

	it('creates the passage when clicked', () => {
		const onCreate = jest.fn();

		renderComponent({onCreate});
		fireEvent.click(screen.getByRole('button', {name: 'Cellar'}));
		expect(onCreate).toHaveBeenCalledWith(ghost);
	});

	it('creates the passage when double-clicked', () => {
		const onCreate = jest.fn();

		renderComponent({onCreate});
		fireEvent.doubleClick(screen.getByRole('button', {name: 'Cellar'}));
		expect(onCreate).toHaveBeenCalled();
	});
});
