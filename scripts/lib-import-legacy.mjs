// Runner for lib-import-legacy.ts: bundle with esbuild (@sliders/* as source, like
// twine-cli), then run. Args pass through.  node scripts/lib-import-legacy.mjs --help
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const outDir = resolve(repo, 'node_modules/.cache/lib-import-legacy');
const out = resolve(outDir, 'lib-import-legacy.mjs');

mkdirSync(outDir, {recursive: true});
await build({
	entryPoints: [resolve(here, 'lib-import-legacy.ts')],
	outfile: out,
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	plugins: [
		{
			name: 'sliders-alias',
			setup(b) {
				b.onResolve({filter: /^@sliders\//}, args => ({
					path: resolve(repo, 'packages', args.path.slice('@sliders/'.length), 'src/index.ts')
				}));
			}
		}
	],
	banner: {
		js: "import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);"
	},
	logLevel: 'warning'
});
await import(pathToFileURL(out).href);
