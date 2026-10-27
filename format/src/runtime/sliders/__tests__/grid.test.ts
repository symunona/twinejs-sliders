import {get} from '../../state';
import {GRID_EVENT, GRID_KEY, gridOn, mountGridToggle} from '../grid';

jest.mock('../../state', () => ({get: jest.fn()}));

const mockGet = get as jest.MockedFunction<typeof get>;

function testing(on: boolean) {
	mockGet.mockImplementation(name =>
		name === 'config.testing' ? on : undefined
	);
}

function sidebar() {
	const el = document.createElement('div');

	el.innerHTML = '<div class="content"><div class="tabs"></div></div>';
	document.body.append(el);
	return el;
}

beforeEach(() => {
	document.body.innerHTML = '';
	window.localStorage.clear();
	testing(true);
});

describe('gridOn', () => {
	it('is off by default', () => {
		expect(gridOn()).toBe(false);
	});

	it('is remembered from the last test play', () => {
		window.localStorage.setItem(GRID_KEY, 'true');
		expect(gridOn()).toBe(true);
	});

	it('is always off outside a test play', () => {
		window.localStorage.setItem(GRID_KEY, 'true');
		testing(false);
		expect(gridOn()).toBe(false);
	});
});

describe('mountGridToggle', () => {
	it('puts an unpressed Grid switch above the tabs', () => {
		const el = sidebar();

		mountGridToggle(el);

		const button = el.querySelector<HTMLButtonElement>('.sliders-grid-toggle')!;

		expect(el.querySelector('.content')!.firstElementChild).toBe(button.parentElement);
		expect(button.getAttribute('aria-pressed')).toBe('false');
	});

	it('flips the grid, stores it and tells the stages', () => {
		const el = sidebar();
		const heard = jest.fn();

		window.addEventListener(GRID_EVENT, heard);
		mountGridToggle(el);

		const button = el.querySelector<HTMLButtonElement>('.sliders-grid-toggle')!;

		button.click();
		expect(button.getAttribute('aria-pressed')).toBe('true');
		expect(gridOn()).toBe(true);
		expect(heard).toHaveBeenCalledTimes(1);

		button.click();
		expect(gridOn()).toBe(false);
		expect(window.localStorage.getItem(GRID_KEY)).toBeNull();
		window.removeEventListener(GRID_EVENT, heard);
	});
});
