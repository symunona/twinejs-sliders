import {getAppInfo} from '../app-info';

describe('getAppInfo', () => {
	beforeAll(() => {
		process.env.VITE_APP_NAME = 'mock-app-name';
		process.env.VITE_APP_VERSION = '1.2.3';
		process.env.VITE_BUILD_TIME = '2020-01-01T00:00:00.000Z';
		process.env.VITE_COMMIT_HASH = 'abc1234';
	});

	afterAll(() => {
		delete process.env.VITE_APP_NAME;
		delete process.env.VITE_APP_VERSION;
		delete process.env.VITE_BUILD_TIME;
		delete process.env.VITE_COMMIT_HASH;
	});

	it('reads information from the environment', () =>
		expect(getAppInfo()).toEqual({
			name: 'mock-app-name',
			version: '1.2.3',
			buildTime: '2020-01-01T00:00:00.000Z',
			commitHash: 'abc1234'
		}));
});
