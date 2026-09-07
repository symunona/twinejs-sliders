import type {PlaywrightTestConfig} from '@playwright/test';
import {devices} from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const config: PlaywrightTestConfig = {
	testDir: './e2e',
	/* Maximum time one test can run for. The Sliders suites upload and transcode
	   images through the real UI, which is well past the 30s default. */
	timeout: 120 * 1000,
	expect: {
		/**
		 * Maximum time expect() should wait for the condition to be met.
		 * For example in `await expect(locator).toHaveText();`
		 */
		timeout: 5000
	},
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,
	/* Opt out of parallel tests on CI. */
	workers: process.env.CI ? 1 : undefined,
	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: 'html',
	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Bounded so a click on an element that never becomes actionable fails fast
		   instead of consuming the whole test timeout. */
		actionTimeout: 15000,
		/* Base URL to use in actions like `await page.goto('/')`. */
		// baseURL: 'http://localhost:3000',

		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: 'on-first-retry'
	},

	/* Configure projects for major browsers.
	   Only Chromium is installed on this machine; add the others back once
	   `npx playwright install firefox webkit` has been run. */
	projects: [
		{
			name: 'chromium',
			/* The server-sync suite is its own project: it spawns a Go binary per worker
			   and needs a longer per-test timeout, and running it here as well would
			   run every one of those tests twice. */
			testIgnore: /server-[^/]*\.spec\.ts$/,
			use: {
				...devices['Desktop Chrome'],
				/* Background removal needs a real WebGPU adapter, which headless
				   Chromium does not have--it exposes `navigator.gpu` and then hands
				   back nothing. Run those paths with:

				     SLIDERS_WEBGPU=1 xvfb-run -a npx playwright test

				   Without the flag the suite still passes: the app is supposed to
				   disable the feature and say why, and that's asserted too. */
				...(process.env.SLIDERS_WEBGPU
					? {
							headless: false,
							launchOptions: {
								args: [
									'--use-angle=vulkan',
									'--enable-unsafe-webgpu',
									'--enable-features=Vulkan'
								]
							}
					  }
					: {})
			}
		},

		/* Two browser contexts against a real Go server (spec 11, testing layer 3).
		   `e2e/server-helpers.ts` builds the binary once into the OS temp directory and
		   spawns one process per worker on a port of the kernel's choosing, so this
		   project needs no global setup -- only more patience per test. Conflicts wait
		   out the push queue's 5s/15s/60s retry ladder. */
		{
			name: 'server-sync',
			testMatch: /server-[^/]*\.spec\.ts$/,
			timeout: 180 * 1000,
			use: {...devices['Desktop Chrome']}
		}

		/* Test against mobile viewports. */
		// {
		//   name: 'Mobile Chrome',
		//   use: {
		//     ...devices['Pixel 5'],
		//   },
		// },
		// {
		//   name: 'Mobile Safari',
		//   use: {
		//     ...devices['iPhone 12'],
		//   },
		// },

		/* Test against branded browsers. */
		// {
		//   name: 'Microsoft Edge',
		//   use: {
		//     channel: 'msedge',
		//   },
		// },
		// {
		//   name: 'Google Chrome',
		//   use: {
		//     channel: 'chrome',
		//   },
		// },
	],

	/* Folder for test artifacts such as screenshots, videos, traces, etc. */
	// outputDir: 'test-results/',

	/* Run your local dev server before starting the tests.
	   `npm run start` opens a browser window, which is unhelpful in CI/headless. */
	webServer: {
		command: 'npx vite --port 27020 --host 127.0.0.1 --clearScreen false',
		port: 27020,
		reuseExistingServer: true,
		timeout: 120 * 1000
	}
};

export default config;
