import {isSoftwareAdapter} from '../engine-types';

describe('isSoftwareAdapter', () => {
	it('spots the CPU renderers browsers fall back to', () => {
		// Verbatim from a Chrome 148 that had hardware acceleration off. It
		// looked like a working WebGPU adapter and took 146 seconds a pass.
		expect(
			isSoftwareAdapter('google swiftshader 0xc0de SwiftShader Device (Subzero)')
		).toBe(true);
		expect(isSoftwareAdapter('mesa llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
		expect(isSoftwareAdapter('lavapipe')).toBe(true);
		expect(isSoftwareAdapter('Microsoft Basic Render Driver')).toBe(true);
	});

	it('leaves real hardware alone', () => {
		// The middle two are this repo's own dev box, under two Chromium
		// versions that disagree about its limits.
		for (const real of [
			'nvidia pascal',
			'nvidia pascal NVIDIA GeForce GTX 1050 Ti',
			'apple apple-m2',
			'intel gen-12lp Intel(R) Iris(R) Xe Graphics',
			'amd rdna2'
		]) {
			expect(isSoftwareAdapter(real)).toBe(false);
		}
	});
});
