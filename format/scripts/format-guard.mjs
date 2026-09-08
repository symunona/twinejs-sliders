/**
 * The guard that keeps the Sliders half of the format from disappearing again.
 *
 * `format/src/runtime` and `format/src/twine-extensions` are Chapbook, vendored. Upgrading
 * Chapbook means re-copying those trees, and a re-copy that forgets to re-apply the
 * Sliders edits produces a format that BUILDS AND RUNS — it is simply Chapbook wearing the
 * Sliders name, with the scene toolbar, the scene syntax highlighting and the scene link
 * arrows silently gone. That is exactly what shipped in 0.2.0.
 *
 * So the build asserts the markers in `format/sliders-markers.json` and fails loudly
 * instead. The same list is checked against the committed `format.js` by
 * `format/src/twine-extensions/__tests__/built-format.test.ts`, so a stale bundle cannot
 * be committed either.
 */

import fs from 'fs-extra';
import path from 'path';
import {fileURLToPath} from 'url';

const markersPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'sliders-markers.json'
);

export const markers = JSON.parse(fs.readFileSync(markersPath, 'utf8'));

/** The features a bundle has lost, as readable lines. Empty when it has lost nothing. */
export function missingMarkers(text, list) {
	return list
		.filter(marker => !text.includes(marker.find))
		.map(marker => `  - ${marker.feature} (no "${marker.find}" in the bundle)`);
}

/** Throws when a built format has dropped anything the Sliders layer adds. */
export function assertSlidersFormat({hydrate, source}) {
	const problems = [
		...missingMarkers(hydrate, markers.hydrate).map(
			line => `${line} [editor extensions]`
		),
		...missingMarkers(source, markers.source).map(line => `${line} [runtime]`)
	];

	if (problems.length > 0) {
		throw new Error(
			'This build has lost Sliders functionality:\n' +
				problems.join('\n') +
				'\n\nSee format/README.md, "Do not lose the Sliders half".'
		);
	}
}
