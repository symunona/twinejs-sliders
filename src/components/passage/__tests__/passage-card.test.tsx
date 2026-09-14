import {faker} from '@faker-js/faker';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import * as detectIt from 'detect-it';
import {axe} from 'jest-axe';
import * as React from 'react';
import {fakePassage} from '../../../test-util';
import {passageIsEmpty} from '../../../util/passage-is-empty';
import {PassageCard, PassageCardProps} from '../passage-card';

jest.mock('../../tag/tag-badges');
jest.mock('../../tag/tag-stripe');
jest.mock('../../../util/passage-is-empty');

describe('<PassageCard>', () => {
	const passageIsEmptyMock = passageIsEmpty as jest.Mock;
	const oldDeviceType = detectIt.deviceType;

	beforeEach(() => passageIsEmptyMock.mockReturnValue(false));

	afterAll(() => {
		(detectIt as any).deviceType = oldDeviceType;
	});

	function renderComponent(props?: Partial<PassageCardProps>) {
		return render(
			<PassageCard
				onDeselect={jest.fn()}
				onEdit={jest.fn()}
				onSelect={jest.fn()}
				passage={fakePassage()}
				tagColors={{}}
				tagDisplay="color"
				{...props}
			/>
		);
	}

	it('should include data-passage-tag attribute with space-separated tags', () => {
		const tags = [faker.lorem.slug(), faker.lorem.slug()];
		const passage = fakePassage({tags});
		renderComponent({passage});

		const passageElement = document.querySelector('.passage-card');
		expect(passageElement).toHaveAttribute('data-passage-tags', tags.join(' '));
	});

	it('should include data-passage-tag with an empty string when passage has no tags', () => {
		const passage = fakePassage({tags: []});
		renderComponent({passage});

		const passageElement = document.querySelector('.passage-card');
		expect(passageElement).toHaveAttribute('data-passage-tags', '');
	});

	it('displays the passage name', () => {
		const passage = fakePassage();

		renderComponent({passage});
		expect(screen.getByText(passage.name)).toBeInTheDocument();
	});

	it('displays an excerpt of the passage text', () => {
		const passage = fakePassage({text: "short text that won't be truncated"});

		renderComponent({passage});
		expect(screen.getByText(passage.text)).toBeInTheDocument();
	});

	it("gives it an 'empty' CSS class if the passage is empty", () => {
		passageIsEmptyMock.mockReturnValue(true);
		renderComponent({passage: fakePassage()});
		expect(document.querySelector('.passage-card.empty')).toBeInTheDocument();
	});

	it("doesn't give it an 'empty' CSS class if the passage is empty", () => {
		passageIsEmptyMock.mockReturnValue(false);
		renderComponent({passage: fakePassage()});
		expect(
			document.querySelector('.passage-card.empty')
		).not.toBeInTheDocument();
	});

	describe('when passage text is empty', () => {
		const passage = fakePassage({text: ''});

		it('displays a touch-oriented placeholder message on a touch device', () => {
			(detectIt as any).deviceType = 'touchOnly';
			renderComponent({passage});
			expect(
				screen.getByText('components.passageCard.placeholderTouch')
			).toBeInTheDocument();
		});

		it('displays mouse-oriented text on any other type of device', () => {
			(detectIt as any).deviceType = 'mouseOnly';
			renderComponent({passage});
			expect(
				screen.getByText('components.passageCard.placeholderClick')
			).toBeInTheDocument();
			(detectIt as any).deviceType = 'hybrid';
			cleanup();
			renderComponent({passage});
			expect(
				screen.getByText('components.passageCard.placeholderClick')
			).toBeInTheDocument();
		});
	});

	describe("When the tagDisplay prop is 'color'", () => {
		it('displays a <TagStripe> of passage tags', () => {
			const passage = fakePassage({tags: ['mock-tag-1', 'mock-tag-2']});

			renderComponent({passage});
			expect(screen.getByTestId('mock-tag-stripe')).toHaveTextContent(
				'mock-tag-1 mock-tag-2'
			);
		});

		it("doesn't display <TagBadges>", () => {
			const passage = fakePassage({tags: ['mock-tag-1', 'mock-tag-2']});

			renderComponent({passage});
			expect(screen.queryByTestId('mock-tag-badges')).not.toBeInTheDocument();
		});
	});

	describe("When the tagDisplay prop is 'name'", () => {
		it('displays <TagBadges> containing passage tags', () => {
			const passage = fakePassage({tags: ['mock-tag-1', 'mock-tag-2']});

			renderComponent({passage, tagDisplay: 'name'});
			expect(screen.queryByTestId('mock-tag-stripe')).not.toBeInTheDocument();
		});

		it("doesn't display a <TagStripe>", () => {
			const passage = fakePassage({tags: ['mock-tag-1', 'mock-tag-2']});

			renderComponent({passage, tagDisplay: 'name'});
			expect(screen.queryByTestId('mock-tag-stripe')).not.toBeInTheDocument();
		});
	});

	it('positions the card based on the passage props', () => {
		const passage = fakePassage({left: 200, top: 400});

		renderComponent({passage});

		const style = window.getComputedStyle(
			document.querySelector('.passage-card')!
		);

		// Zoom does not change positioning. This is handled by <PassageMap>
		// instead.
		expect(style.getPropertyValue('left')).toBe('200px');
		expect(style.getPropertyValue('top')).toBe('400px');
	});

	it('calls the onEdit prop when the card is double-clicked', () => {
		const onEdit = jest.fn();
		const passage = fakePassage();

		renderComponent({onEdit, passage});
		expect(onEdit).not.toHaveBeenCalled();
		fireEvent.dblClick(screen.getByText(passage.name));
		expect(onEdit.mock.calls).toEqual([[passage]]);
	});

	it('calls the onSelect prop when the card is clicked when unselected', () => {
		const onDeselect = jest.fn();
		const onSelect = jest.fn();
		const passage = fakePassage({selected: false});

		renderComponent({onDeselect, onSelect, passage});
		expect(onDeselect).not.toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();
		fireEvent.mouseDown(screen.getByText(passage.name));
		expect(onDeselect).not.toHaveBeenCalled();
		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	it('calls neither onDeselect or onSelect props when the card is clicked when selected', () => {
		const onDeselect = jest.fn();
		const onSelect = jest.fn();
		const passage = fakePassage({selected: true});

		renderComponent({onDeselect, onSelect, passage});
		expect(onDeselect).not.toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();
		fireEvent.mouseDown(screen.getByText(passage.name));
		expect(onDeselect).not.toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('calls the onDeselect prop when the card is clicked with the shift or control key held and the passage is selected', () => {
		['ctrlKey', 'shiftKey'].forEach(key => {
			const onDeselect = jest.fn();
			const onSelect = jest.fn();
			const passage = fakePassage({selected: true});

			renderComponent({onDeselect, onSelect, passage});
			expect(onDeselect).not.toHaveBeenCalled();
			expect(onSelect).not.toHaveBeenCalled();
			fireEvent.mouseDown(screen.getByText(passage.name), {[key]: true});
			expect(onDeselect).toHaveBeenCalledTimes(1);
			expect(onSelect).not.toHaveBeenCalled();
		});
	});

	it('calls the onSelect prop with a nonexclusive argument when the card is clicked with the control key held and the passage is unselected', () => {
		const onDeselect = jest.fn();
		const onSelect = jest.fn();
		const passage = fakePassage({selected: false});

		renderComponent({onDeselect, onSelect, passage});
		expect(onDeselect).not.toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();
		fireEvent.mouseDown(screen.getByText(passage.name), {ctrlKey: true});
		expect(onDeselect).not.toHaveBeenCalled();
		expect(onSelect.mock.calls).toEqual([[passage, false]]);
	});

	describe('when the passage has scene errors', () => {
		it('shows a warning badge', () => {
			renderComponent({errorCount: 2});
			expect(
				screen.getByTestId('passage-card-error-badge')
			).toBeInTheDocument();
		});

		it('marks the card so it can be outlined', () => {
			const passage = fakePassage();

			renderComponent({errorCount: 1, passage});
			expect(
				document.querySelector('.passage-card.has-errors')
			).toBeInTheDocument();
		});
	});

	it('shows no warning badge when the passage has no scene errors', () => {
		renderComponent();
		expect(screen.queryByTestId('passage-card-error-badge')).toBeNull();
		expect(document.querySelector('.passage-card.has-errors')).toBeNull();
	});

	describe('when another editor holds the passage', () => {
		it('marks the card with their initial', () => {
			renderComponent({lockedBy: 'jules'});

			const badge = screen.getByTestId('passage-card-lock');

			expect(badge).toHaveAttribute('data-locked-by', 'jules');
			expect(badge).toHaveTextContent('J');
			expect(
				document.querySelector('.passage-card.is-locked')
			).toBeInTheDocument();
		});
	});

	it('shows no lock badge when nobody else is in the passage', () => {
		renderComponent();
		expect(screen.queryByTestId('passage-card-lock')).toBeNull();
		expect(document.querySelector('.passage-card.is-locked')).toBeNull();
	});

	// A ghost is a link target the story has no passage for yet--the same card, with
	// everything that would touch the store left unwired. See `brokenLinkGhosts`.

	describe('when the card is a ghost', () => {
		const passage = fakePassage({name: 'Cellar', story: '', text: ''});

		it('marks the card so it can be drawn as a proposal', () => {
			renderComponent({ghost: true, passage});
			expect(document.querySelector('.passage-card.ghost')).toBeInTheDocument();
			expect(screen.getByTestId('ghost-passage-Cellar')).toBeInTheDocument();
		});

		it('says the click will create the passage', () => {
			renderComponent({ghost: true, passage});
			expect(
				screen.getByText('components.passageCard.placeholderGhost')
			).toBeInTheDocument();
		});

		it('creates the passage when clicked or double-clicked', () => {
			const onCreate = jest.fn();

			renderComponent({ghost: true, onCreate, passage});
			fireEvent.click(screen.getByText(passage.name));
			expect(onCreate.mock.calls).toEqual([[passage]]);
			fireEvent.dblClick(screen.getByText(passage.name));
			expect(onCreate.mock.calls).toEqual([[passage], [passage]]);
		});

		// `selectPassage` and `deselectPassage` throw on a passage its story does not
		// have, and there is nothing to edit until the passage exists.
		it('never selects, deselects or edits', () => {
			const onDeselect = jest.fn();
			const onEdit = jest.fn();
			const onSelect = jest.fn();

			renderComponent({
				ghost: true,
				onCreate: jest.fn(),
				onDeselect,
				onEdit,
				onSelect,
				passage
			});
			fireEvent.mouseDown(screen.getByText(passage.name));
			fireEvent.mouseDown(screen.getByText(passage.name), {shiftKey: true});
			fireEvent.click(screen.getByText(passage.name));
			fireEvent.dblClick(screen.getByText(passage.name));
			expect(onDeselect).not.toHaveBeenCalled();
			expect(onEdit).not.toHaveBeenCalled();
			expect(onSelect).not.toHaveBeenCalled();
		});

		// It could never look dragged--a ghost is never selected, and only a selected card
		// moves with the drag offset--so the drag would be a gesture with no feedback that
		// ended in a move of a passage that does not exist.
		it('is not draggable', () => {
			const onDragStart = jest.fn();

			renderComponent({ghost: true, onDragStart, passage});
			fireEvent.mouseDown(screen.getByText(passage.name));
			expect(onDragStart).not.toHaveBeenCalled();

			cleanup();
			renderComponent({onDragStart, passage});
			fireEvent.mouseDown(screen.getByText(passage.name));
			expect(onDragStart).toHaveBeenCalled();
		});

		it('is accessible', async () => {
			const {container} = renderComponent({ghost: true, passage});

			expect(await axe(container)).toHaveNoViolations();
		});
	});

	it.todo('passes through drag events');

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
