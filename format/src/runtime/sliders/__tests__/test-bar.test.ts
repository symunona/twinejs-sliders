import {restart} from '../../actions';
import {get} from '../../state';
import {initTestBar, resetTestBar} from '../test-bar';

jest.mock('../../state', () => ({get: jest.fn()}));
jest.mock('../../actions', () => ({restart: jest.fn()}));

const mockGet = get as jest.MockedFunction<typeof get>;
let quiet: jest.SpyInstance;

function testing(on: boolean) {
	mockGet.mockImplementation(name =>
		name === 'config.testing' ? on : undefined
	);
}

function bar() {
	return document.querySelector<HTMLElement>('.sliders-test-bar');
}

function toggle() {
	return document.querySelector<HTMLButtonElement>(
		'.sliders-test-bar__warnings'
	)!;
}

function list() {
	return document.querySelector<HTMLElement>('.sliders-test-bar__list')!;
}

function trailChange() {
	window.dispatchEvent(
		new CustomEvent('state-change', {detail: {name: 'trail', value: []}})
	);
}

beforeEach(() => {
	// Underneath the bar's own wrapper, so nothing reaches the jest output.
	quiet = jest.spyOn(console, 'warn').mockImplementation(() => {});
	document.body.innerHTML = '';
});

afterEach(() => {
	resetTestBar();
	quiet.mockRestore();
});

describe('initTestBar', () => {
	it('does nothing outside a test play', () => {
		testing(false);
		document.body.innerHTML = '<warning-list></warning-list>';
		initTestBar();

		expect(bar()).toBeNull();
		expect(document.querySelector('warning-list')).not.toBeNull();
	});

	it('replaces the warning banner and keeps what it had caught', () => {
		testing(true);

		const banner = document.createElement('warning-list') as HTMLElement & {
			warnings: string[];
		};

		banner.warnings = ['early: start vars'];
		document.body.append(banner);
		initTestBar();

		expect(document.querySelector('warning-list')).toBeNull();
		expect(toggle().textContent).toBe('⚠ 1');
	});

	it('shows a count, not a list, until asked', () => {
		testing(true);
		initTestBar();

		expect(toggle().hidden).toBe(true);

		console.warn('scene: one');
		console.warn('scene: two');

		expect(toggle().hidden).toBe(false);
		expect(toggle().textContent).toBe('⚠ 2');
		expect(list().hidden).toBe(true);

		toggle().click();

		expect(list().hidden).toBe(false);
		expect(list().textContent).toContain('scene: two');

		toggle().click();

		expect(list().hidden).toBe(true);
	});

	it('folds repeats into one line', () => {
		testing(true);
		initTestBar();
		console.warn('scene: loop');
		console.warn('scene: loop');
		toggle().click();

		expect(list().querySelectorAll('li')).toHaveLength(1);
		expect(list().textContent).toContain('(×2)');
	});

	it('still passes every warning on to the console', () => {
		testing(true);
		initTestBar();
		console.warn('scene: kept');

		expect(quiet).toHaveBeenCalledWith('scene: kept');
	});

	it('starts clean and closed on a new passage', () => {
		testing(true);
		initTestBar();
		console.warn('scene: old');
		toggle().click();
		trailChange();

		expect(toggle().hidden).toBe(true);
		expect(list().hidden).toBe(true);
	});

	it('restarts with one click', () => {
		testing(true);
		initTestBar();
		document
			.querySelector<HTMLButtonElement>('.sliders-test-bar__restart')!
			.click();

		expect(restart).toHaveBeenCalledTimes(1);
	});
});
