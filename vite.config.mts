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
				// Story formats are 3.8MB of a 5.7MB build, and precaching them
				// meant the new worker could not activate until all of it had
				// downloaded -- which is the window a deploy spends still serving
				// the old build. They are fetched by URL when a story is played or
				// previewed, so a runtime cache is enough: the first play of a
				// given format needs the network, every play after it does not.
				globIgnores: ['story-formats/**'],
				runtimeCaching: [
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
