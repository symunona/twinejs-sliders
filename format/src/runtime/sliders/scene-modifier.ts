/**
 * The `[scene]` modifier: everything under it is scene YAML, not prose.
 *
 * `processRaw`, because the body must reach the parser exactly as written — Markdown would
 * turn `*` bullets into emphasis and smart-quote the dialogue. The modifier emits a
 * `<sliders-stage>` element plus the scene's links as ordinary Chapbook links, so a reader
 * with JavaScript disabled still sees somewhere to go, and link styling stays the story's.
 */

import {parseScene} from '@sliders/scene-schema';
import type {SceneError} from '@sliders/scene-types';
import {createLoggers} from '../logger';
import {get} from '../state';
import type {Modifier} from '../template/modifiers';
import {encodePayload} from './stage-element';
import {SCENE_MODIFIER} from './scene-only';

const {warn} = createLoggers('scene');

function describe(error: SceneError): string {
	return `[scene] line ${error.line}: ${error.message}${
		error.hint ? ` ${error.hint}` : ''
	}`;
}

export const sceneModifier: Modifier = {
	match: SCENE_MODIFIER,
	processRaw(output, {state}) {
		const {errors, scene} = parseScene(output.text);
		const messages = errors.map(describe);

		for (const message of messages) {
			warn(message);
		}

		// Several scenes in one passage each need their own element identity.
		const count = typeof state.count === 'number' ? state.count : 0;

		state.count = count + 1;

		const links = Object.values(scene.links ?? {}).filter(
			link => !link.if || Boolean(get(link.if))
		);
		const payload = encodePayload({
			errors: get('config.testing') ? messages : undefined,
			links: Object.fromEntries(links.map(link => [link.name, link.to])),
			scene
		});

		let html = `<sliders-stage data-index="${count}" scene="${payload}"></sliders-stage>`;

		if (links.length > 0) {
			html +=
				'\n\n' + links.map(link => `> [[${link.name}->${link.to}]]`).join('\n') + '\n';
		}

		output.text = html;
		output.startsNewParagraph = true;
	}
};
