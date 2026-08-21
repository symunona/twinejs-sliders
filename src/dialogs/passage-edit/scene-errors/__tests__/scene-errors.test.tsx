import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {SceneError} from '@sliders/scene-types';
import {FakeStateProvider} from '../../../../test-util';
import {SceneErrors} from '../scene-errors';

function error(overrides: Partial<SceneError> = {}): SceneError {
	return {
		code: 'bad-value',
		col: 1,
		line: 4,
		message: 'Unknown key.',
		severity: 'error',
		...overrides
	};
}

function renderErrors(errors: SceneError[], onGoToLine = jest.fn()) {
	render(
		<FakeStateProvider>
			<SceneErrors errors={errors} onGoToLine={onGoToLine} />
		</FakeStateProvider>
	);

	return {onGoToLine};
}

// The test i18n stub returns the key, so the header is checked by which key it asks
// for; the count itself is interpolation, which i18next owns.
const VALID = 'dialogs.passageEdit.sceneErrors.valid';
const ERRORS = 'dialogs.passageEdit.sceneErrors.showErrors';
const WARNINGS = 'dialogs.passageEdit.sceneErrors.showWarnings';

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
});
