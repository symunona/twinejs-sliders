export interface AppInfo {
	name: string;
	version: string;
}

/**
 * What `getAppInfo()` knows on top of the app's identity: which bundle this is.
 * Kept separate from `AppInfo` because publishing only cares about name and
 * version, and every fixture that fakes an `AppInfo` would otherwise have to
 * invent a build.
 */
export interface BuildInfo extends AppInfo {
	/** ISO timestamp of when this bundle was built. */
	buildTime: string;
	/** Short git hash the bundle was built from, empty outside a checkout. */
	commitHash: string;
}

/**
 * Retrieves information about the Twine app itself based on buildtime
 * environment
 */
export function getAppInfo(): BuildInfo {
	return {
		name: process.env.VITE_APP_NAME as string,
		version: process.env.VITE_APP_VERSION as string,
		buildTime: process.env.VITE_BUILD_TIME as string,
		commitHash: process.env.VITE_COMMIT_HASH as string
	};
}
