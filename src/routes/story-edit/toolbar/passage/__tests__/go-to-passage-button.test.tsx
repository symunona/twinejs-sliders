import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider} from '../../../../../test-util';
import {
	GoToPassageButton,
	GoToPassageButtonProps
} from '../go-to-passage-button';

describe('GoToPassageButton', () => {
	function renderComponent(props?: Partial<GoToPassageButtonProps>) {
		return render(
			<GoToPassageButton onOpenFuzzyFinder={jest.fn()} {...props} />
		);
	}

	it('calls the onOpenFuzzyFinder prop when clicked', () => {
		const onOpenFuzzyFinder = jest.fn();

		renderComponent({onOpenFuzzyFinder});
		expect(onOpenFuzzyFinder).not.toBeCalled();
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.storyEdit.toolbar.goTo'})
		);
		expect(onOpenFuzzyFinder).toBeCalledTimes(1);
	});

	// The command is registered in `global` so that it resolves wherever focus
	// happens to be--in a dialog, in the passage text, or nowhere. Every place it
	// did not resolve was a place `mod+p` opened the browser's print dialog.

	it('opens the finder on mod+p from outside the story map scope, with a text field focused', () => {
		const onOpenFuzzyFinder = jest.fn();

		render(
			<FakeStateProvider>
				<GoToPassageButton onOpenFuzzyFinder={onOpenFuzzyFinder} />
				<input type="text" />
			</FakeStateProvider>
		);

		const input = screen.getByRole('textbox');

		input.focus();
		fireEvent.keyDown(input, {code: 'p', ctrlKey: true, key: 'p'});
		expect(onOpenFuzzyFinder).toBeCalledTimes(1);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
