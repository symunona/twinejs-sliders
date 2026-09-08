/**
 * Builds `format.js` — the file Twine loads as a story format.
 *
 * A format is one JSON object with the whole runtime inlined as `source`, so the build is
 * two Vite passes (the runtime page, and the editor extensions Twine calls `hydrate`)
 * wrapped in a `window.storyFormat()` call. Output goes straight into the editor's
 * `public/story-formats/`, because that is the copy the editor and every deploy serve.
 */

import fs from 'fs-extra';
import path from 'path';
import {fileURLToPath} from 'url';
import {build, loadConfigFromFile} from 'vite';
import {assertSlidersFormat} from './format-guard.mjs';

process.env.NODE_ENV = 'production';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const dest = path.join(
	root,
	'..',
	'public',
	'story-formats',
	`sliders-${pkg.version}`
);

process.chdir(root);

const {config: runtimeConfig} = await loadConfigFromFile(
	{},
	path.join(root, 'vite.runtime.config.js')
);
const {config: extensionsConfig} = await loadConfigFromFile(
	{},
	path.join(root, 'vite.extensions.config.js')
);

const {output: runtimeOutput} = await build(runtimeConfig);
const [extensionsOutput] = await build(extensionsConfig);

const format = {
	source: runtimeOutput[0].source,
	author: pkg.author,
	description: pkg.description,
	hydrate: extensionsOutput.output[0].code,
	image: 'logo.svg',
	name: pkg.name,
	proofing: false,
	url: pkg.repository,
	version: pkg.version
};

// Chapbook is vendored here, so a re-copy of it can silently take the Sliders layer
// with it. Fail the build rather than ship a format that is quietly plain Chapbook.
assertSlidersFormat(format);

await fs.mkdirp(dest);
await fs.writeFile(
	path.join(dest, 'format.js'),
	`window.storyFormat(${JSON.stringify(format)})`,
	'utf8'
);
await fs.copy(path.join(root, 'src', 'logo.svg'), path.join(dest, 'logo.svg'));
await fs.remove(path.join(root, 'build'));
console.log(`Wrote ${path.join(dest, 'format.js')}.`);
