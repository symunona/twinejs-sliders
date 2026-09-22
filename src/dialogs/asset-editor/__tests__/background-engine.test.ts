import {
	BackgroundTimeoutError,
	DEFAULT_TUNING,
	tunedAlpha,
	withStageWatchdog
} from '../background-engine';

describe('withStageWatchdog', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('passes a finished result straight through', async () => {
		await expect(withStageWatchdog(async () => 'done')).resolves.toBe('done');
	});

	it('passes a failure straight through', async () => {
		await expect(
			withStageWatchdog(async () => {
				throw new Error('the model exploded');
			})
		).rejects.toThrow('the model exploded');
	});

	it('gives up on a stage that stalls', async () => {
		const stalled = withStageWatchdog<string>(() => new Promise(() => undefined));
		const settled = stalled.catch(error => error);

		// The download stage is the one in force before anything is reported.
		jest.advanceTimersByTime(301 * 1000);

		const error = await settled;

		expect(error).toBeInstanceOf(BackgroundTimeoutError);
		expect((error as BackgroundTimeoutError).stage).toBe('download');
		expect((error as BackgroundTimeoutError).seconds).toBe(300);
	});

	it('names the stage that was actually stuck', async () => {
		let report: (stage: 'download' | 'start' | 'run' | 'refine') => void =
			() => undefined;
		const stalled = withStageWatchdog<string>(next => {
			report = next;
			return new Promise(() => undefined);
		});
		const settled = stalled.catch(error => error);

		report('run');
		jest.advanceTimersByTime(121 * 1000);

		const error = await settled;

		expect((error as BackgroundTimeoutError).stage).toBe('run');
		expect((error as BackgroundTimeoutError).seconds).toBe(120);
	});

	it('honours a slower set of limits, as the CPU engine needs', async () => {
		// A CPU pass is a minute or more by design, so the GPU's 120s run limit
		// would fire on perfectly healthy work.
		let report: (stage: 'run') => void = () => undefined;
		const stalled = withStageWatchdog<string>(
			next => {
				report = next;
				return new Promise(() => undefined);
			},
			{download: 600, refine: 120, run: 600, start: 600}
		);
		const settled = stalled.catch(error => error);

		report('run');
		jest.advanceTimersByTime(200 * 1000);
		expect(await Promise.race([settled, 'still running'])).toBe('still running');

		jest.advanceTimersByTime(401 * 1000);

		const error = await settled;

		expect((error as BackgroundTimeoutError).stage).toBe('run');
		expect((error as BackgroundTimeoutError).seconds).toBe(600);
	});

	it('never cuts off work that is slow but still moving', async () => {
		let report: (stage: 'run') => void = () => undefined;
		let finish: (value: string) => void = () => undefined;
		const work = new Promise<string>(resolve => {
			finish = resolve;
		});
		const watched = withStageWatchdog<string>(next => {
			report = next;
			return work;
		});

		// Well past the 120s limit in total, but never 120s without progress.
		for (let tick = 0; tick < 5; tick++) {
			report('run');
			jest.advanceTimersByTime(100 * 1000);
		}

		finish('done');
		await expect(watched).resolves.toBe('done');
	});
});

describe('backgroundSupport', () => {
	// The module has to be re-imported per case: the engine list reads its
	// capability checks once, at import time, through these mocks.
	beforeEach(() => jest.resetModules());
	afterEach(() => jest.resetModules());

	/**
	 * The engine list is module-private on purpose, so these drive it the way
	 * the app does: through the capability checks it asks the browser.
	 */
	async function support(gpu: {webGpu: boolean; software?: boolean}) {
		jest.doMock('../engine-types', () => ({
			...jest.requireActual('../engine-types'),
			hasWasm: () => true,
			hasWebGpu: async () => gpu.webGpu,
			webGpuIsSoftware: () => gpu.software ?? false
		}));

		return await (await import('../background-engine')).backgroundSupport();
	}

	it('takes the GPU engine whenever there is one', async () => {
		const {engine, gpuReasonKey} = await support({webGpu: true});

		expect(engine?.id).toBe('ormbg');
		expect(engine?.cpu).toBeUndefined();
		// Nothing to explain: the author gets the fast path.
		expect(gpuReasonKey).toBeUndefined();
	});

	it('falls back to the CPU when there is no WebGPU', async () => {
		const {engine, gpuReasonKey, support: result} = await support({
			webGpu: false
		});

		expect(engine?.id).toBe('ormbg-cpu');
		expect(engine?.cpu).toBe(true);
		expect(result.supported).toBe(true);
		// The UI needs this to say why a cutout is about to take a minute.
		expect(gpuReasonKey).toBe('dialogs.assetEditor.needsWebGpu');
	});

	it('falls back to the CPU rather than run WebGPU on a software renderer', async () => {
		// SwiftShader is slower than the wasm path and pretends to be a GPU, so
		// the fallback is the honest choice and has to say which problem it is.
		const {engine, gpuReasonKey} = await support({
			software: true,
			webGpu: true
		});

		expect(engine?.id).toBe('ormbg-cpu');
		expect(gpuReasonKey).toBe('dialogs.assetEditor.needsRealGpu');
	});

	it('gives up when even wasm is missing', async () => {
		jest.doMock('../engine-types', () => ({
			...jest.requireActual('../engine-types'),
			hasWasm: () => false,
			hasWebGpu: async () => false,
			webGpuIsSoftware: () => false
		}));

		const {engine, support: result} = await (
			await import('../background-engine')
		).backgroundSupport();

		expect(engine).toBeUndefined();
		expect(result.supported).toBe(false);
	});
});

describe('tunedAlpha', () => {
	// Well outside the soft band either side of the threshold, so these assert the
	// tuning's decision rather than the shape of its edge.
	const alpha = new Float32Array([0, 0.5, 1]);

	it('leaves the tuning alone when invert is off', () => {
		const tuned = tunedAlpha(alpha, DEFAULT_TUNING);

		expect(tuned[0]).toBeCloseTo(0);
		expect(tuned[2]).toBeCloseTo(1);
		expect(tunedAlpha(alpha, {...DEFAULT_TUNING, invert: false})).toEqual(tuned);
	});

	it('swaps kept for cut when invert is on', () => {
		const inverted = tunedAlpha(alpha, {...DEFAULT_TUNING, invert: true});

		expect(inverted[0]).toBeCloseTo(1);
		expect(inverted[2]).toBeCloseTo(0);
	});

	it('inverts after the edge contrast, so the sliders keep their meaning', () => {
		// Inverting the raw alpha FIRST would read the threshold from the other end: a
		// pixel just inside the kept side would land just inside the cut side instead of
		// being the same edge seen from behind. One flip of the finished curve is the
		// only reading where `1 - plain` holds for every pixel.
		const tuning = {softness: 0.4, threshold: 0.6};
		const middling = new Float32Array([0.1, 0.45, 0.55, 0.62, 0.9]);
		const plain = tunedAlpha(middling, tuning);
		const inverted = tunedAlpha(middling, {...tuning, invert: true});

		plain.forEach((value, index) =>
			expect(inverted[index]).toBeCloseTo(1 - value)
		);
	});

	it('does not write back into the alpha it was handed', () => {
		// The editor keeps one model alpha and re-tunes it on every slider drag. An
		// in-place invert would flip that cached map itself, so the second drag would be
		// tuning an already-inverted picture.
		const source = new Float32Array([0, 0.5, 1]);

		tunedAlpha(source, {...DEFAULT_TUNING, invert: true});
		expect(Array.from(source)).toEqual([0, 0.5, 1]);
	});
});
