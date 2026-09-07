import react from '@vitejs/plugin-react-swc';
import browserslistToEsbuild from 'browserslist-to-esbuild';
import {defineConfig} from 'vite';
import {execSync} from 'node:child_process';
import * as path from 'node:path';
import checker from 'vite-plugin-checker';
import {nodePolyfills} from 'vite-plugin-node-polyfills';
import {VitePWA} from 'vite-plugin-pwa';
import packageJson from './package.json';

// When and from what this bundle was built, so the app can show it. Building
// outside a git checkout is allowed--the hash is just unknown then.

const buildTime = new Date().toISOString();

let commitHash = '';

try {
	commitHash = execSync('git rev-parse --short HEAD', {
		stdio: ['ignore', 'pipe', 'ignore']
	})
		.toString()
		.trim();
} catch (error) {
	// Not a git checkout--leave the hash empty.
}

export default defineConfig({
	base: './',
	resolve: {
		alias: [
			// Sliders monorepo packages, consumed as source (see ADR-3).
			{
				find: /^@sliders\/(.*)$/,
				replacement: path.resolve(__dirname, 'packages') + '/$1/src'
			}
		]
	},
	build: {
		outDir: 'dist/web',
		target: browserslistToEsbuild(['>0.2%', 'not dead', 'not op_mini all'])
	},
	define: {
		// Make app name and version available to code.
		// https://stackoverflow.com/a/74860417/7569568
		'process.env.VITE_APP_NAME': JSON.stringify(packageJson.name),
		'process.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
		'process.env.VITE_BUILD_TIME': JSON.stringify(buildTime),
		'process.env.VITE_COMMIT_HASH': JSON.stringify(commitHash)
	},
	plugins: [
		checker({
			eslint: {lintCommand: 'eslint src'},
			overlay: {
				initialIsOpen: false
			},
			typescript: true
		}),
		nodePolyfills(
			// We only need a `global` injected, for CodeMirror.
			{include: [], globals: {global: true}}
		),
		react(),
		VitePWA({
			// The app registers the worker itself, in src/util/service-worker.ts.
			// The script this would otherwise inject only calls register() -- it
			// never reloads the page when a new worker takes over, which is what
			// made a deploy need several refreshes to appear.
			injectRegister: null,
			manifest: {
				icons: [
					{
						src: './icons/pwa.png',
						sizes: '1024x1024',
						type: 'image/png'
					},
					{
						src: './icons/pwa-maskable.png',
						purpose: 'maskable',
						sizes: '1024x1024',
						type: 'image/png'
					}
				]
			},
			registerType: 'autoUpdate',
			includeAssets: ['locales/**', 'pwa/**'],
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
				// Story formats are 3.8MB of a 5.7MB build, and precaching them meant
				// the new worker could not activate until all of it had downloaded --
				// which is the window a deploy spends still serving the old build. They
				// are fetched by URL when a story is played or previewed, so a runtime
				// cache is enough: the first play of a given format needs the network,
				// every play after it does not.
				globIgnores: ['story-formats/**'],
				// No NavigationRoute bound to the precached index.html. That default is
				// what made a deploy need several refreshes: it answers every navigation
				// out of the precache, so the first refresh after a deploy is guaranteed
				// to render the OLD index.html and therefore the old bundle. The new
				// worker only takes over once it has finished precaching, so "how many
				// refreshes does a deploy need" was really "how long did that download
				// take", and refreshing in the middle of it did nothing but wait.
				navigateFallback: undefined,
				// ...and no directory index either. Dropping the NavigationRoute is not
				// enough on its own: the precache route matches a URL ending in "/" by
				// appending `directoryIndex`, so "/" still resolved to the precached
				// index.html and answered every navigation before any runtime route was
				// consulted. Twine is a hash router, so "/" is the only navigation the
				// app ever makes, and this is exactly the request that has to reach the
				// network.
				directoryIndex: null,
				runtimeCaching: [
					{
						// Navigations off the network first, so refresh #1 after a deploy
						// always shows the new build -- the HTML is current and its
						// hash-named assets are in no cache yet, so they are fetched too.
						// This cache is what keeps the app working offline, and because it
						// is written on every successful navigation it holds the last build
						// actually seen rather than the last one precached.
						urlPattern: ({request}) => request.mode === 'navigate',
						handler: 'NetworkFirst',
						options: {
							cacheName: 'html',
							// Offline should not mean a long stare at a blank page before
							// the cached copy appears.
							networkTimeoutSeconds: 3,
							expiration: {maxEntries: 8}
						}
					},
					{
						urlPattern: /\/story-formats\//,
						handler: 'StaleWhileRevalidate',
						options: {cacheName: 'story-formats'}
					}
				]
			}
		})
	],
	server: {
		open: true,
		port: 27000,
		strictPort: true
	}
});
