// Bundle the CLI into one runnable file. The @sliders/* packages are consumed as source
// (ADR-3), so there is nothing to resolve at runtime and no install step.
import {build} from 'esbuild';
import {chmod} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const out = resolve(here, 'dist/twine-cli.mjs');

const slidersAlias = {
	name: 'sliders-alias',
	setup(b) {
		b.onResolve({filter: /^@sliders\//}, args => ({
			path: resolve(repo, 'packages', args.path.slice('@sliders/'.length), 'src/index.ts')
		}));
	}
};

await build({
	entryPoints: [resolve(here, 'src/bin.ts')],
	outfile: out,
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	plugins: [slidersAlias],
	// `yaml` ships CJS, and CJS bundled into an ESM output has no `require` of its own.
	// The shim is what lets the one runtime dependency load at all.
	banner: {
		js: [
			'#!/usr/bin/env node',
			"import {createRequire as __createRequire} from 'node:module';",
			'const require = __createRequire(import.meta.url);'
		].join('\n')
	},
	logLevel: 'info'
});

await chmod(out, 0o755);
