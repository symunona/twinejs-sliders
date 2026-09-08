/**
 * The committed `format.js` is what the editor and every deploy actually serve, so it is
 * checked here as well as at build time: an old bundle can be committed by hand, and a
 * Chapbook re-vendor that drops the Sliders layer would otherwise only be caught by
 * someone opening a passage.
 *
 * The marker list is `format/sliders-markers.json` — shared with
 * `format/scripts/format-guard.mjs` so the two cannot disagree.
 */

import fs from 'fs';
import path from 'path';
import markers from '../../../sliders-markers.json';

const pkg = JSON.parse(
	fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')
) as {name: string; version: string};

const bundlePath = path.resolve(
	__dirname,
	'../../../../public/story-formats',
	`${pkg.name.toLowerCase()}-${pkg.version}`,
	'format.js'
);

function builtFormat(): {hydrate: string; source: string; version: string} {
	const text = fs.readFileSync(bundlePath, 'utf8');

	return JSON.parse(text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')));
}

describe('the built format', () => {
	it('is committed at the version format/package.json names', () => {
		expect(fs.existsSync(bundlePath)).toBe(true);
		expect(builtFormat().version).toBe(pkg.version);
	});

	it.each(markers.hydrate.map(m => [m.feature, m.find]))(
		'still has its editor extensions: %s',
		(_feature, find) => {
			expect(builtFormat().hydrate).toContain(find);
		}
	);

	it.each(markers.source.map(m => [m.feature, m.find]))(
		'still has its runtime: %s',
		(_feature, find) => {
			expect(builtFormat().source).toContain(find);
		}
	);
});
