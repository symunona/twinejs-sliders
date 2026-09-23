/**
 * Edits to one pose's step list, as pure functions over `CharacterPose`. The step strip
 * calls these; nothing here knows about React or the store.
 *
 * Shape rules the whole file keeps:
 * - Exactly one of `asset` / `steps`.
 * - A step list of one collapses to a still (`asset`): one timed image is a still with
 *   extra words. Its fit moves to the pose unless the pose already has one.
 * - Identity fits and default holds are stored as absent.
 */
import {AssetId, CharacterPose, PoseFit, PoseStep} from '@sliders/scene-types';
import {durForFps} from './import-set-logic';

function isIdentity(fit: PoseFit | undefined): boolean {
	return !fit || (fit.offset.x === 0 && fit.offset.y === 0 && fit.scale === 1);
}

/** The pose's steps, or its one image as a step list of one. Empty for no image at all. */
export function stepsOf(pose: CharacterPose): PoseStep[] {
	if (pose.steps && pose.steps.length > 0) {
		return pose.steps;
	}

	return pose.asset ? [{asset: pose.asset}] : [];
}

/** Writes `steps` back, collapsing to a still when one is left. */
export function withSteps(pose: CharacterPose, steps: PoseStep[]): CharacterPose {
	const result: CharacterPose = {...pose};

	delete result.asset;
	delete result.steps;

	if (steps.length === 1) {
		const [only] = steps;

		result.asset = only.asset;

		if (only.fit && !result.fit) {
			result.fit = only.fit;
		}

		// `loop` only means something for steps.
		delete result.loop;
		return result;
	}

	if (steps.length > 1) {
		result.steps = steps;
	}

	return result;
}

export function moveStep(pose: CharacterPose, from: number, to: number): CharacterPose {
	const steps = stepsOf(pose).slice();

	if (from < 0 || from >= steps.length || to < 0 || to >= steps.length || from === to) {
		return pose;
	}

	const [step] = steps.splice(from, 1);

	steps.splice(to, 0, step);
	return withSteps(pose, steps);
}

/** Never removes the last image: deleting the pose is the pose list's job. */
export function removeStep(pose: CharacterPose, index: number): CharacterPose {
	const steps = stepsOf(pose);

	if (steps.length < 2 || index < 0 || index >= steps.length) {
		return pose;
	}

	return withSteps(
		pose,
		steps.filter((_, i) => i !== index)
	);
}

export function appendSteps(pose: CharacterPose, assets: AssetId[]): CharacterPose {
	return withSteps(pose, [...stepsOf(pose), ...assets.map(asset => ({asset}))]);
}

export function setStepDur(
	pose: CharacterPose,
	index: number,
	dur: number | undefined
): CharacterPose {
	const steps = stepsOf(pose).map((step, i) => {
		if (i !== index) {
			return step;
		}

		const next = {...step};

		if (dur && dur > 0) {
			next.dur = Math.round(dur * 1000) / 1000;
		} else {
			delete next.dur;
		}

		return next;
	});

	return withSteps(pose, steps);
}

/** Every step held for the same time. */
export function setPoseFps(pose: CharacterPose, fps: number): CharacterPose {
	const dur = durForFps(fps);

	return withSteps(
		pose,
		stepsOf(pose).map(step => {
			const next = {...step};

			if (dur === undefined) {
				delete next.dur;
			} else {
				next.dur = dur;
			}

			return next;
		})
	);
}

export function setStepFit(
	pose: CharacterPose,
	index: number,
	fit: PoseFit | undefined
): CharacterPose {
	return withSteps(
		pose,
		stepsOf(pose).map((step, i) => {
			if (i !== index) {
				return step;
			}

			const next = {...step};

			if (isIdentity(fit)) {
				delete next.fit;
			} else {
				next.fit = {offset: {...fit!.offset}, scale: fit!.scale};
			}

			return next;
		})
	);
}

/** One step's fit onto every step of the pose. */
export function stepFitToAll(pose: CharacterPose, index: number): CharacterPose {
	const steps = stepsOf(pose);
	const fit = steps[index]?.fit;

	return withSteps(
		pose,
		steps.map(step => {
			const next = {...step};

			if (fit) {
				next.fit = {offset: {...fit.offset}, scale: fit.scale};
			} else {
				delete next.fit;
			}

			return next;
		})
	);
}

/** What a step is drawn with: its own fit, else the pose's. */
export function stepFit(pose: CharacterPose, index: number): PoseFit | undefined {
	return stepsOf(pose)[index]?.fit ?? pose.fit;
}
