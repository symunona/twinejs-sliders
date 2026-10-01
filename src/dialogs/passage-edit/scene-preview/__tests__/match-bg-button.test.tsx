import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {MatchBgButton} from '../match-bg-button';

/**
 * jsdom never loads an image and `jest-canvas-mock` reads back blank pixels, so the probe
 * itself is the browser's to prove. Pinned here: no backdrop means the button is off and
 * says why.
 */
describe('MatchBgButton', () => {
	it('is off with a reason when there is no backdrop', () => {
		const root = document.createElement('div');
		const onApply = jest.fn();

		render(<MatchBgButton id="hero" onApply={onApply} root={root} />);

		const button = screen.getByRole('button', {
			name: 'dialogs.passageEdit.scenePreview.grade.matchBgNoBg'
		}) as HTMLButtonElement;

		expect(button.disabled).toBe(true);
		fireEvent.click(button);
		expect(onApply).not.toHaveBeenCalled();
	});
});
