import {resolve} from 'path';
import postcssUrl from 'postcss-url';
import {defineConfig} from 'vite';
import {createHtmlPlugin} from 'vite-plugin-html';
import {viteSingleFile} from 'vite-plugin-singlefile';

/**
 * Builds the runtime — the HTML page a published story becomes — into one file.
 *
 * The only difference from Chapbook's own config is the `@sliders/*` aliases: the scene
 * packages are the editor's, read straight out of ../packages, so the format and the
 * editor preview can never disagree about what a scene means.
 */
export default defineConfig(async () => ({
	build: {
		emptyOutDir: true,
		outDir: '../../build/'
	},
	css: {
		postcss: {
			// Inline SVGs as data URIs.
			plugins: [postcssUrl({optimizeSvgEncode: true, url: 'inline'})]
		}
	},
	plugins: [
		createHtmlPlugin({
			inject: {
				data: {storyData: '{{STORY_DATA}}'},
				ejsOptions: {root: 'src/runtime'}
			},
			minify: true
		}),
		viteSingleFile()
	],
	resolve: {
		alias: [
			{
				find: /^@sliders\/(.*)$/,
				replacement: resolve(process.cwd(), '../packages/$1/src/index.ts')
			}
		]
	},
	root: './src/runtime'
}));
