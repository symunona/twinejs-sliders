/** @jest-environment node */
import {parseScene} from '@sliders/scene-schema';
import {extractSceneBlock} from '@sliders/scene-index';
import {rewritePassagePoses} from '../cmd/rewrite-poses';

const OLD = `She waits. frame: is just a word out here.

[scene]
id: tavern
cast:
  mira: {at: -0.4, frame: idle}   # by the door
  joren:
    frame: [{name: walk_1, dur: 0.1}, walk_2]
    frameLoop: once
ease: {frame: linear, move: back_out}
beats:
  - mira: {frame: angry, say: "frame: stays in dialogue."}
  - joren: "Hm."

[continue]
frame: not a scene key either`;

describe('rewrite-poses', () => {
	it('renames every retired key the parser read, and nothing else', () => {
		const {count, text} = rewritePassagePoses(OLD);

		expect(count).toBe(5);
		expect(text).toBe(
			OLD.replace('{at: -0.4, frame: idle}', '{at: -0.4, pose: idle}')
				.replace('    frame: [{name', '    pose: [{name')
				.replace('frameLoop: once', 'poseLoop: once')
				.replace('{frame: linear', '{pose: linear')
				.replace('{frame: angry', '{pose: angry')
		);
	});

	it('leaves a scene that parses to the same thing, with no notes left', () => {
		const before = parseScene(extractSceneBlock(OLD)!.text);
		const after = parseScene(extractSceneBlock(rewritePassagePoses(OLD).text)!.text);

		expect(after.scene).toEqual(before.scene);
		expect(after.errors.filter(error => error.code === 'retired-key')).toEqual([]);
	});

	it('is a no-op on a passage already in today\'s words, or with no scene', () => {
		const today = rewritePassagePoses(OLD).text;

		expect(rewritePassagePoses(today)).toEqual({count: 0, text: today});
		expect(rewritePassagePoses('No scene. frame: idle')).toEqual({
			count: 0,
			text: 'No scene. frame: idle'
		});
	});
});
