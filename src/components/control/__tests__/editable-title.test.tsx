import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {EditableTitle} from '../editable-title';

describe('<EditableTitle>', () => {
	function renderComponent(
		props?: Partial<React.ComponentProps<typeof EditableTitle>>
	) {
		return render(
			<EditableTitle editable onRename={jest.fn()} value="old name" {...props} />
		);
	}

	function field() {
		return screen.queryByTestId('editable-title-input');
	}

	it('shows the value as text until it is clicked', () => {
		renderComponent();
		expect(screen.getByText('old name')).toBeInTheDocument();
		expect(field()).not.toBeInTheDocument();
	});

	it('opens a field when clicked', () => {
		renderComponent();
		fireEvent.click(screen.getByText('old name'));
		expect(field()).toHaveValue('old name');
	});

	it('ignores clicks when not editable', () => {
		renderComponent({editable: false});
		fireEvent.click(screen.getByText('old name'));
		expect(field()).not.toBeInTheDocument();
	});

	it('renames when the field is submitted', () => {
		const onRename = jest.fn();

		renderComponent({onRename});
		fireEvent.click(screen.getByText('old name'));
		fireEvent.change(field()!, {target: {value: 'new name'}});
		fireEvent.submit(field()!);
		expect(onRename).toBeCalledWith('new name');
	});

	it('renames when the field loses focus', () => {
		const onRename = jest.fn();

		renderComponent({onRename});
		fireEvent.click(screen.getByText('old name'));
		fireEvent.change(field()!, {target: {value: 'new name'}});
		fireEvent.blur(field()!);
		expect(onRename).toBeCalledWith('new name');
	});

	it('abandons the draft when Escape is pressed', () => {
		const onRename = jest.fn();

		renderComponent({onRename});
		fireEvent.click(screen.getByText('old name'));
		fireEvent.change(field()!, {target: {value: 'new name'}});
		fireEvent.keyDown(field()!, {key: 'Escape'});
		expect(onRename).not.toBeCalled();
		expect(field()).not.toBeInTheDocument();
	});

	it('refuses an empty name', () => {
		const onRename = jest.fn();

		renderComponent({onRename});
		fireEvent.click(screen.getByText('old name'));
		fireEvent.change(field()!, {target: {value: '   '}});
		fireEvent.submit(field()!);
		expect(onRename).not.toBeCalled();
		expect(field()).toBeInTheDocument();
	});

	it('refuses a name that is already taken', () => {
		const onRename = jest.fn();

		renderComponent({nameTaken: name => name === 'taken', onRename});
		fireEvent.click(screen.getByText('old name'));
		fireEvent.change(field()!, {target: {value: 'taken'}});
		expect(field()).toHaveAttribute('aria-invalid', 'true');
		fireEvent.submit(field()!);
		expect(onRename).not.toBeCalled();
	});

	describe('when waiting for a double click', () => {
		beforeEach(() => jest.useFakeTimers());
		afterEach(() => jest.useRealTimers());

		it("doesn't open the field until a second click can't be coming", () => {
			renderComponent({waitForDoubleClick: true});
			fireEvent.click(screen.getByText('old name'), {detail: 1});
			expect(field()).not.toBeInTheDocument();
			act(() => {
				jest.runAllTimers();
			});
			expect(field()).toBeInTheDocument();
		});

		it("doesn't open the field at all if a double click arrives", () => {
			renderComponent({waitForDoubleClick: true});

			const title = screen.getByText('old name');

			fireEvent.click(title, {detail: 1});
			fireEvent.doubleClick(title);
			fireEvent.click(title, {detail: 2});
			act(() => {
				jest.runAllTimers();
			});
			expect(field()).not.toBeInTheDocument();
		});
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
