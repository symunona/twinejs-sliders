import * as path from 'node:path';
import {defineConfig} from 'vite';

/**
 * Standalone harness config. Vite resolves its config from the root you point it at, so this
 * file is what makes `npx vite packages/render-dom/harness` work with no twinejs, no bundler
 * setup and no build step:
 *
 *   npx vite packages/render-dom/harness --port 5199
 */
export default defineConfig({
	resolve: {
		alias: [
			// Sliders monorepo packages, consumed as source (see ADR-3).
			{
				find: /^@sliders\/(.*)$/,
				replacement: path.resolve(__dirname, '../../') + '/$1/src'
			}
		]
	},
	server: {open: false}
});
