import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../../../test-util';
import {LinkTargetError} from '../../scene-preview/validate-links';
import {SceneErrors} from '../scene-errors';

function error(overrides: Partial<LinkTargetError> = {}): LinkTargetError {
	return {
		code: 'bad-value',
		col: 1,
		line: 4,
		message: 'Unknown key.',
		severity: 'error',
		...overrides
	};
}

function renderErrors(
	errors: LinkTargetError[],
	onGoToLine = jest.fn(),
	onCreatePassage?: jest.Mock,
	onApplyFix?: jest.Mock
) {
	render(
		<FakeStateProvider>
			<SceneErrors
				errors={errors}
				onApplyFix={onApplyFix}
				onCreatePassage={onCreatePassage}
				onGoToLine={onGoToLine}
			/>
		</FakeStateProvider>
	);

	return {onApplyFix, onCreatePassage, onGoToLine};
}

const FIX = {
	col: 1,
	endCol: 4,
	endLine: 4,
	label: "Change 'bgg' to 'bg'",
	line: 4,
	replaces: 'bgg',
	text: 'bg'
};

// The test i18n stub returns the key, so the header is checked by which key it asks
// for; the count itself is interpolation, which i18next owns.
const VALID = 'dialogs.passageEdit.sceneErrors.valid';
const ERRORS = 'dialogs.passageEdit.sceneErrors.showErrors';
const WARNINGS = 'dialogs.passageEdit.sceneErrors.showWarnings';
const NOTES = 'dialogs.passageEdit.sceneErrors.showNotes';

describe('<SceneErrors>', () => {
	it('says the scene is valid when there is nothing wrong', () => {
		renderErrors([]);
		expect(screen.getByTestId('scene-errors-header')).toHaveTextContent(VALID);
		expect(screen.getByTestId('scene-errors-header')).toBeDisabled();
	});

	it('counts the errors, and keeps the list closed until asked', () => {
		renderErrors([error(), error({line: 7})]);

		expect(screen.getByTestId('scene-errors-header')).toHaveTextContent(ERRORS);
		expect(screen.queryByTestId('scene-preview-errors')).not.toBeInTheDocument();

		fireEvent.click(screen.getByTestId('scene-errors-header'));
		expect(screen.getAllByRole('listitem')).toHaveLength(2);
	});

	it('counts warnings separately when nothing is an error', () => {
		renderErrors([error({severity: 'warning'})]);
		expect(screen.getByTestId('scene-errors-header')).toHaveTextContent(
			WARNINGS
		);
	});

	it('calls a scene with only info findings one with notes, not warnings', () => {
		renderErrors([error({code: 'passage-case', severity: 'info'})]);
		expect(screen.getByTestId('scene-errors-header')).toHaveTextContent(NOTES);
	});

	it('lets a warning outrank a note in the header', () => {
		renderErrors([
			error({code: 'passage-case', severity: 'info'}),
			error({severity: 'warning'})
		]);
		expect(screen.getByTestId('scene-errors-header')).toHaveTextContent(
			WARNINGS
		);
	});

	it('goes to the line an error names', () => {
		const {onGoToLine} = renderErrors([error({line: 9})]);

		fireEvent.click(screen.getByTestId('scene-errors-header'));
		fireEvent.click(screen.getByText('Unknown key.'));
		expect(onGoToLine).toHaveBeenCalledWith(9);
	});

	it('shows the hint alongside the message', () => {
		renderErrors([error({hint: "Did you mean 'cast'?"})]);
		fireEvent.click(screen.getByTestId('scene-errors-header'));
		expect(screen.getByText("Did you mean 'cast'?")).toBeInTheDocument();
	});

	describe('the create passage fix', () => {
		const missing = () =>
			error({
				code: 'unknown-passage',
				hint: "Did you mean 'Tavern'?",
				message: "Link 'on' points at a passage that doesn't exist: 'Tavren'.",
				missingPassage: 'Tavren'
			});

		it('creates the passage the error names', () => {
			const onCreatePassage = jest.fn();

			renderErrors([missing()], jest.fn(), onCreatePassage);
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			fireEvent.click(screen.getByTestId('scene-errors-create-passage'));
			expect(onCreatePassage).toHaveBeenCalledWith('Tavren');
		});

		// A near miss could be either a typo or a passage yet to be written, so the
		// author gets both fixes and picks.
		it('leaves the did-you-mean hint visible beside it', () => {
			renderErrors([missing()], jest.fn(), jest.fn());
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			expect(screen.getByText("Did you mean 'Tavern'?")).toBeInTheDocument();
		});

		it('does not jump the editor to the line as well', () => {
			const onGoToLine = jest.fn();

			renderErrors([missing()], onGoToLine, jest.fn());
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			fireEvent.click(screen.getByTestId('scene-errors-create-passage'));
			expect(onGoToLine).not.toHaveBeenCalled();
		});

		it('is absent on an error that names no missing passage', () => {
			renderErrors([error()], jest.fn(), jest.fn());
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			expect(
				screen.queryByTestId('scene-errors-create-passage')
			).not.toBeInTheDocument();
		});

		it('is absent when the caller offers no way to create one', () => {
			renderErrors([missing()]);
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			expect(
				screen.queryByTestId('scene-errors-create-passage')
			).not.toBeInTheDocument();
		});
	});

	describe('the Fix button', () => {
		it('is offered on an error that carries a fix', async () => {
			const onApplyFix = jest.fn();

			renderErrors([error({fix: FIX})], jest.fn(), undefined, onApplyFix);
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			fireEvent.click(screen.getByTestId('scene-errors-fix').querySelector('button')!);
			expect(onApplyFix).toHaveBeenCalledWith(FIX);
		});

		it('names the repair, so a click is never a guess', () => {
			renderErrors([error({fix: FIX})], jest.fn(), undefined, jest.fn());
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			expect(
				screen.getByTestId('scene-errors-fix').querySelector('button')
			).toHaveAttribute('aria-label', FIX.label);
		});

		it('is absent on an error with no mechanical repair', () => {
			renderErrors([error()], jest.fn(), undefined, jest.fn());
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			expect(screen.queryByTestId('scene-errors-fix')).not.toBeInTheDocument();
		});

		it('is absent when the passage is read-only', () => {
			// `onApplyFix` is what the editor withholds; the fix itself is still on the error.
			renderErrors([error({fix: FIX})]);
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			expect(screen.queryByTestId('scene-errors-fix')).not.toBeInTheDocument();
		});

		it('does not also jump the editor to the line', () => {
			const onGoToLine = jest.fn();

			renderErrors([error({fix: FIX})], onGoToLine, undefined, jest.fn());
			fireEvent.click(screen.getByTestId('scene-errors-header'));
			fireEvent.click(screen.getByTestId('scene-errors-fix').querySelector('button')!);
			expect(onGoToLine).not.toHaveBeenCalled();
		});
	});
});
