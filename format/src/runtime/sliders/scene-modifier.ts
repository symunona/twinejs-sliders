/**
 * The `[scene]` modifier: everything under it is scene YAML, not prose.
 *
 * `processRaw`, because the body must reach the parser exactly as written — Markdown would
 * turn `*` bullets into emphasis and smart-quote the dialogue. The modifier emits a
 * `<sliders-stage>` element plus — when the beats leave the reader nowhere to click — the
 * scene's links as ordinary Chapbook links, so there is always somewhere to go even if the
 * custom element never upgrades, and link styling stays the story's.
 *
 * Unless the scene wrote a `linkList:` block, which moves the list INSIDE the stage box and
 * hands the drawing to `<sliders-stage>`. Then no markup is emitted at all: Chapbook renders
 * it into `#page` flow under the element, where the block's `at:` cannot reach it, and a
 * list drawn in both places is every choice shown twice.
 */

import {
	beatsOfferLinks,
	evalCondition,
	gateScene,
	parseScene
} from '@sliders/scene-schema';
import type {EntityPatchBody, Scene, SceneError} from '@sliders/scene-types';
import {createLoggers} from '../logger';
import {get} from '../state';
import type {Modifier} from '../template/modifiers';
import {showSceneLinks} from './config';
import {encodePayload} from './stage-element';
import {SCENE_MODIFIER} from './scene-only';

const {warn} = createLoggers('scene');

function describe(error: SceneError): string {
	return `[scene] line ${error.line}: ${error.message}${
		error.hint ? ` ${error.hint}` : ''
	}`;
}

/**
 * Every `EntityPatchBody` in a scene: the declared entities, and the patch on each beat.
 *
 * The two places an entity key can be written, and the reason this is a walk rather than a
 * lookup — a beat may repoint a door that the `cast:` block never mentioned a link for.
 */
function* entityPatches(scene: Scene): Generator<EntityPatchBody> {
	for (const patch of Object.values(scene.entities ?? {})) {
		if (patch) {
			yield patch;
		}
	}

	for (const beat of scene.beats ?? []) {
		if ('patch' in beat && beat.patch) {
			yield beat.patch as EntityPatchBody;
		}
	}
}

/** Does an `if:` hold against the story's state right now? Chapbook's `get` reads it. */
function holds(condition: string): boolean {
	return evalCondition(condition, get);
}

/** Drop any entity link whose `if:` is false right now. */
function pruneEntityLinks(scene: Scene): void {
	for (const patch of entityPatches(scene)) {
		const cond = patch.link?.if;

		if (cond && !holds(cond)) {
			// `undefined`, not `null`: null is the author's own "stop being a way out",
			// which under `from:` CLEARS an inherited link. A condition that failed should
			// leave whatever an earlier scene set alone.
			patch.link = undefined;
		}
	}
}

export const sceneModifier: Modifier = {
	match: SCENE_MODIFIER,
	processRaw(output, {state}) {
		const parsed = parseScene(output.text);
		const {errors} = parsed;
		// Entity and beat `if:` are settled here, against the story's state, for the reason
		// entity links are below: this is the only place that can read it. The stage element
		// is handed a scene with nothing left to decide.
		const scene = gateScene(parsed.scene, holds);
		const messages = errors.map(describe);

		for (const message of messages) {
			warn(message);
		}

		// Several scenes in one passage each need their own element identity.
		const count = typeof state.count === 'number' ? state.count : 0;

		state.count = count + 1;

		const links = Object.values(scene.links ?? {}).filter(
			link => !link.if || holds(link.if)
		);

		// An entity `link:` carrying a condition is pruned HERE rather than in the player,
		// because this is the only place that can read story state — and pruning rather
		// than disabling matters: a gated door that still glowed under the pointer would
		// promise a way out the reader cannot take.
		pruneEntityLinks(scene);

		// Asked with the links that survived `if:`, and after `pruneEntityLinks`, so a beat
		// whose only link is gated off this time round does not count as a way out and the
		// list is drawn after all.
		const offered = beatsOfferLinks(scene, new Set(links.map(link => link.name)));
		const drawn =
			links.length > 0 && showSceneLinks(offered, scene.linkList?.show);

		const payload = encodePayload({
			drawLinks: drawn && Boolean(scene.linkList),
			errors: get('config.testing') ? messages : undefined,
			links: Object.fromEntries(links.map(link => [link.name, link.to])),
			// The names travel as a list as well as a map, because in a menu the order IS
			// the content and a map cannot carry it: an integer-like key sits at the FRONT
			// of an object whatever position it was written in, before JSON is even
			// involved. This list is what the stage draws from.
			//
			// It carries the order the PARSER handed over, which for a scene that names
			// its links `1`, `2`, `3` is already not the YAML's — `Scene.links` is a map
			// too, so that one is lost upstream of here and cannot be recovered downstream
			// of it. What this fixes is the transport losing any more of it.
			linkOrder: links.map(link => link.name),
			scene
		});

		let html = `<sliders-stage data-index="${count}" scene="${payload}"></sliders-stage>`;

		if (drawn && !scene.linkList) {
			html +=
				'\n\n' + links.map(link => `> [[${link.name}->${link.to}]]`).join('\n') + '\n';
		}

		output.text = html;
		output.startsNewParagraph = true;
	}
};
