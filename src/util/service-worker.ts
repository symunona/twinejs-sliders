/**
 * Registers the service worker, and does the one thing that
 * `registerType: 'autoUpdate'` does not do by itself: reload the page once a
 * new worker takes over.
 *
 * Without this, a deploy took several refreshes to show up. The worker already
 * running answers every navigation out of its precache, so the first refresh
 * after a deploy always renders the old build. The new worker installs in the
 * background, calls skipWaiting and claims the page -- but nothing tells the
 * page to fetch itself again, so the old bundle stays on screen until some
 * later navigation happens to land after the claim. How many refreshes that
 * took was just how long the precache download ran.
 *
 * It was not only cosmetic. Once the new worker has claimed the page, the old
 * bundle's lazy chunks (the asset editor's background engine) are 404s: Pages
 * serves the current deployment only, and those file names are content-hashed.
 */
import {registerSW} from 'virtual:pwa-register';

export function registerServiceWorker() {
	if (!('serviceWorker' in navigator)) {
		// Electron loads the build off the filesystem, where there is no worker
		// and nothing to update.
		return;
	}

	// Whether a worker was already driving this page when it loaded. On a
	// first-ever visit there is none, and `clientsClaim` fires controllerchange
	// as soon as the first worker installs -- reloading on that one would put a
	// new visitor into a refresh loop.
	const hadController = !!navigator.serviceWorker.controller;
	let reloading = false;

	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (!hadController || reloading) {
			return;
		}

		reloading = true;
		window.location.reload();
	});

	registerSW({immediate: true});
}
