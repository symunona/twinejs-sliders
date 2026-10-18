import {createMemoryHistory} from 'history';
import {
	consumeLeaveWithoutAsking,
	leaveWithoutAsking
} from '../leave-without-asking';

describe('leaveWithoutAsking', () => {
	afterEach(() => consumeLeaveWithoutAsking());

	it('arms one skip for the navigation it runs', () => {
		leaveWithoutAsking({listen: () => () => {}}, () => {
			expect(consumeLeaveWithoutAsking()).toBe(true);
			expect(consumeLeaveWithoutAsking()).toBe(false);
		});
	});

	it('disarms on the next location change when nothing asked', () => {
		const history = createMemoryHistory({initialEntries: ['/', '/edit']});

		leaveWithoutAsking(history, () => history.back());
		expect(history.location.pathname).toBe('/');
		expect(consumeLeaveWithoutAsking()).toBe(false);
	});

	it('is not armed by default', () => {
		expect(consumeLeaveWithoutAsking()).toBe(false);
	});
});
