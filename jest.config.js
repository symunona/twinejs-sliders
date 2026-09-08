/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	// Map asset and CSS imports to inert mocks.
	moduleNameMapper: {
		'\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
			'<rootDir>/src/__mocks__/fileMock.js',
		'\\.(css|less)$': '<rootDir>/src/__mocks__/styleMock.js',
		// The format's toolbar imports SVGs with Vite's ?raw suffix.
		'\\.svg\\?raw$': '<rootDir>/src/__mocks__/fileMock.js',
		// Sliders monorepo packages, consumed as source (see ADR-3).
		'^@sliders/(.*)$': '<rootDir>/packages/$1/src',
		// `yaml`'s export map sends the jsdom environment to its ESM browser build,
		// which jest can't parse. Pin it to the CJS build.
		'^yaml$': '<rootDir>/node_modules/yaml/dist/index.js'
	},
	preset: 'ts-jest/presets/js-with-ts',
	resetMocks: true,
	roots: [
		'<rootDir>/src',
		'<rootDir>/packages',
		'<rootDir>/format/src/twine-extensions'
	],
	setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
	// The format keeps its Playwright specs beside its unit tests.
	testPathIgnorePatterns: ['/node_modules/', '__tests-e2e__'],
	testEnvironment: 'jest-environment-jsdom',
	// segseg is a ESM-only module.
	transformIgnorePatterns: ['node_modules/(?!segseg)'],
	watchPlugins: [
		'jest-watch-typeahead/filename',
		'jest-watch-typeahead/testname'
	]
};
