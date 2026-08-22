import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import type {PassageLock} from '../../../store/persistence/server/presence';
import {testPresenceClient} from '../../../store/persistence/server/test-fixtures';
import {PassageLockBanner} from '../passage-lock-banner';

const jules = testPresenceClient({id: 'them', name: 'jules'});

function renderBanner(lock?: PassageLock, onTakeOver = jest.fn()) {
	return {
		onTakeOver,
		...render(<PassageLockBanner lock={lock} onTakeOver={onTakeOver} />)
	};
}

describe('<PassageLockBanner>', () => {
	it('renders nothing when nobody else is in the passage', () => {
		const {container} = renderBanner(undefined);

		expect(container).toBeEmptyDOMElement();
	});

	describe('when someone else holds the passage', () => {
		const lock: PassageLock = {by: jules, shared: false};

		it('names them, so the banner says who to go and ask', () => {
			renderBanner(lock);

			expect(screen.getByTestId('passage-lock-banner')).toHaveAttribute(
				'data-locked-by',
				'jules'
			);
			expect(screen.queryByTestId('passage-shared-banner')).toBeNull();
		});

		it('offers a take over button that reports the click', () => {
			const {onTakeOver} = renderBanner(lock);

			fireEvent.click(screen.getByTestId('passage-lock-takeover'));
			expect(onTakeOver).toHaveBeenCalledTimes(1);
		});

		it('is accessible', async () => {
			const {container} = renderBanner(lock);

			expect(await axe(container)).toHaveNoViolations();
		});
	});

	describe('after a takeover', () => {
		const lock: PassageLock = {by: jules, shared: true};

		it('says both editors are open and offers nothing to click', () => {
			renderBanner(lock);

			expect(screen.getByTestId('passage-shared-banner')).toHaveAttribute(
				'data-shared-with',
				'jules'
			);
			expect(screen.queryByTestId('passage-lock-banner')).toBeNull();
			expect(screen.queryByTestId('passage-lock-takeover')).toBeNull();
		});
	});
});
