import {
	BackgroundTimeoutError,
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
