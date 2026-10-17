import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../../../test-util';
import {SceneErrorBadge, SceneErrorPanel} from '../scene-error-badge';
import type {LinkTargetError} from '../validate-links';

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

function renderBadge(errors: LinkTargetError[], onToggle = jest.fn()) {
	render(
		<FakeStateProvider>
			<SceneErrorBadge errors={errors} onToggle={onToggle} open={false} />
		</FakeStateProvider>
	);

	return {badge: screen.getByTestId('scene-error-badge'), onToggle};
}

describe('<SceneErrorBadge>', () => {
	it('counts errors bottom right and warnings bottom left', () => {
		const {badge} = renderBadge([
			error(),
			error(),
			error({severity: 'warning'})
		]);

		expect(screen.getByTestId('scene-error-badge-errors')).toHaveTextContent(
			'2'
		);
		expect(screen.getByTestId('scene-error-badge-warnings')).toHaveTextContent(
			'1'
		);
		expect(badge).not.toHaveClass('clean');
	});

	it('shows only the counts it has', () => {
		renderBadge([error({severity: 'warning'})]);

		expect(screen.queryByTestId('scene-error-badge-errors')).toBeNull();
		expect(
			screen.getByTestId('scene-error-badge-warnings')
		).toBeInTheDocument();
	});

	it('is a clean smiley with no errors, saying so on hover', () => {
		const {badge} = renderBadge([]);

		expect(badge).toHaveClass('clean');
		expect(badge).toHaveAttribute(
			'title',
			'dialogs.passageEdit.scenePreview.errorBadge.none'
		);
		expect(screen.queryByTestId('scene-error-badge-errors')).toBeNull();
		expect(screen.queryByTestId('scene-error-badge-warnings')).toBeNull();
	});

	it('does not count notes as problems', () => {
		const {badge} = renderBadge([error({severity: 'info'})]);

		expect(badge).toHaveClass('clean');
	});

	it('toggles the sidebar on click', () => {
		const {badge, onToggle} = renderBadge([error()]);

		fireEvent.click(badge);
		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});

describe('<SceneErrorPanel>', () => {
	function renderPanel(
		props: Partial<React.ComponentProps<typeof SceneErrorPanel>> = {}
	) {
		const handlers = {
			onApplyFix: jest.fn(),
			onClose: jest.fn(),
			onCreatePassage: jest.fn(),
			onGoToLine: jest.fn(),
			...props
		};

		render(
			<FakeStateProvider>
				<SceneErrorPanel
					errors={[
						error({
							fix: {
								col: 1,
								label: 'Change',
								line: 4,
								replaces: 'bgg',
								text: 'bg'
							}
						}),
						error({line: 7, missingPassage: 'Tavern', severity: 'warning'})
					]}
					{...handlers}
				/>
			</FakeStateProvider>
		);

		return handlers;
	}

	it('lists the errors open, no extra click', () => {
		renderPanel();

		expect(screen.getByTestId('scene-preview-errors').children).toHaveLength(2);
	});

	it('goes to the line, fixes and creates', () => {
		const {onApplyFix, onCreatePassage, onGoToLine} = renderPanel();
		const rows = screen.getByTestId('scene-preview-errors').children;

		fireEvent.click(rows[1]);
		expect(onGoToLine).toHaveBeenCalledWith(7);
		fireEvent.click(
			screen.getByTestId('scene-errors-fix').querySelector('button')!
		);
		expect(onApplyFix).toHaveBeenCalledWith(
			expect.objectContaining({text: 'bg'})
		);
		fireEvent.click(screen.getByTestId('scene-errors-create-passage'));
		expect(onCreatePassage).toHaveBeenCalledWith('Tavern');
		// Neither button is also a row click.
		expect(onGoToLine).toHaveBeenCalledTimes(1);
	});

	it('offers no fix or create when the stage cannot write', () => {
		renderPanel({onApplyFix: undefined, onCreatePassage: undefined});

		expect(screen.queryByTestId('scene-errors-fix')).toBeNull();
		expect(screen.queryByTestId('scene-errors-create-passage')).toBeNull();
	});

	it('closes from its X', () => {
		const {onClose} = renderPanel();

		fireEvent.click(screen.getByRole('button', {name: 'common.close'}));
		expect(onClose).toHaveBeenCalled();
	});
});
