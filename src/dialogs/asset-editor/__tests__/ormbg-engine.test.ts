import packageJson from '../../../../package.json';
import {ORT_VERSION} from '../engines/ormbg-engine';

describe('the ONNX runtime version', () => {
	it('matches the package the types come from', () => {
		// The runtime itself is fetched from a CDN at run time, with this version
		// baked into the URL, while the types come from the installed package.
		// Nothing at build time connects the two, so a routine `npm update` could
		// silently leave the app running one version and typechecking against
		// another. This is the thing that notices.
		const installed = (packageJson.devDependencies as Record<string, string>)[
			'onnxruntime-web'
		];

		expect(installed).toBeDefined();
		expect(installed.replace(/^[~^]/, '')).toBe(ORT_VERSION);
	});
});
