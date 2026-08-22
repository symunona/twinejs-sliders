/**
 * The backend prefs section, driven the way a person drives it.
 *
 * Every other spec in this suite seeds `backendUrl`, `backendToken` and `backendUsername`
 * straight into `localStorage`, which is fast and completely blind to the form that
 * writes them. This one types into the real fields and presses **Test**, and asserts all
 * three answers that button is designed to separate (spec 11, "Probe"):
 *
 * - nothing there at all — "wrong address or server down"
 * - `/health` fine, `/ping` 401 — "the server is there, the token is not"
 * - both fine — "connected", with what it found
 */

import {expect, test, waitForLibrary} from './server-helpers';
import {BASE_URL} from './sliders-helpers';

/** Nothing listens here, and connecting fails at once rather than hanging. */
const DEAD_URL = 'http://127.0.0.1:1';

test.describe('Backend prefs, through the UI', () => {
	test('Test button separates unreachable, bad token and connected', async ({
		browser,
		server
	}) => {
		// Deliberately not the seeded `alice` fixture: the point is the empty form.
		const context = await browser.newContext();
		const page = await context.newPage();

		await page.goto(BASE_URL);
		await waitForLibrary(page);

		await page.getByRole('tab', {name: 'Twine'}).click();
		await page.getByRole('button', {name: 'Preferences'}).click();

		const username = page.getByTestId('backend-username');
		const url = page.getByTestId('backend-url');
		const token = page.getByTestId('backend-token');
		const result = page.getByTestId('backend-test-result');

		await expect(username).toBeVisible({timeout: 20000});
		await username.fill('mira');

		// 1. Nowhere to talk to.
		await url.fill(DEAD_URL);
		await token.fill(server.token);
		await page.getByTestId('backend-test').click();
		await expect(result).toContainText('No answer', {timeout: 30000});

		// 2. The server is there; the token is not.
		await url.fill(server.url);
		await token.fill('this-is-not-the-token-at-all');
		await page.getByTestId('backend-test').click();
		await expect(result).toContainText('Token rejected', {timeout: 30000});

		// 3. Both halves answer.
		await token.fill(server.token);
		await page.getByTestId('backend-test').click();
		await expect(result).toContainText('Connected', {timeout: 30000});
		await expect(result).toContainText('twine-sliders-server');

		// The form is also the thing that stores prefs, so the section has to survive a
		// reload with what was typed into it.
		await page.reload();
		await waitForLibrary(page);
		await page.getByRole('tab', {name: 'Twine'}).click();
		await page.getByRole('button', {name: 'Preferences'}).click();
		await expect(page.getByTestId('backend-url')).toHaveValue(server.url, {
			timeout: 20000
		});
		await expect(page.getByTestId('backend-username')).toHaveValue('mira');

		await context.close();
	});
});
