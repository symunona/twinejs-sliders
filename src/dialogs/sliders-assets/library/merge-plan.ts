import {AssetRecord, LibraryEngine} from '@sliders/asset-library';
import type {Story} from '../../../store/stories';
import {renameSceneRefs} from '../../../util/rename-scene-refs';

/**
 * Duplicates → Merge (plan 1, "Duplicates view"): one survivor, the rest tombstoned,
 * scene refs to the losers rewritten first. Only stories on this device can be
 * rewritten; the rest are listed so the author can tell their owners.
 */

export interface MergeRewrite {
	storyId: string;
	storyName: string;
	passageUpdates: Record<string, {text: string}>;
	/** `old → new` pairs this story gets. */
	renames: {from: string; to: string}[];
}

export interface RemoteUse {
	storyId: string;
	by?: string;
	loser: string;
}

export interface MergePlan {
	survivor: AssetRecord;
	losers: AssetRecord[];
	rewrites: MergeRewrite[];
	/** Stories using a loser that this device does not hold. */
	remote: RemoteUse[];
}

/** How a story should name the survivor once the losers are gone. */
function survivorRef(
	engine: LibraryEngine,
	storyId: string,
	survivor: AssetRecord,
	losers: Set<string>
): string {
	const resolver = engine.resolver(storyId);
	const order = resolver.order();

	for (const collection of order) {
		const holder =
			engine
				.assets(collection.id)
				.find(asset => asset.name === survivor.name && !losers.has(asset.id)) ??
			engine
				.characters(collection.id)
				.find(character => character.charId === survivor.name);

		if (holder) {
			return holder.id === survivor.id
				? survivor.name
				: qualified(engine, survivor);
		}
	}

	return qualified(engine, survivor);
}

function qualified(engine: LibraryEngine, asset: AssetRecord): string {
	return `${engine.get(asset.collection, 'collection')?.name ?? ''}/${asset.name}`;
}

export function mergePlan(
	engine: LibraryEngine,
	survivor: AssetRecord,
	losers: AssetRecord[],
	stories: readonly Story[]
): MergePlan {
	const loserIds = new Set(losers.map(loser => loser.id));
	const local = new Set(stories.map(story => story.id));
	const rewrites: MergeRewrite[] = [];

	for (const story of stories) {
		if (!engine.binding(story.id)) {
			continue;
		}

		const resolver = engine.resolver(story.id);
		const target = survivorRef(engine, story.id, survivor, loserIds);
		const renames: {from: string; to: string}[] = [];

		for (const loser of losers) {
			// Plain name: only where this story's order lands on the loser.
			if (resolver.asset(loser.name)?.id === loser.id && loser.name !== target) {
				renames.push({from: loser.name, to: target});
			}

			const loserQualified = qualified(engine, loser);

			if (loserQualified !== target) {
				renames.push({from: loserQualified, to: target});
			}
		}

		const passageUpdates: Record<string, {text: string}> = {};

		for (const passage of story.passages) {
			let text = passage.text;

			for (const {from, to} of renames) {
				text = renameSceneRefs(text, from, to);
			}

			if (text !== passage.text) {
				passageUpdates[passage.id] = {text};
			}
		}

		if (Object.keys(passageUpdates).length) {
			rewrites.push({
				passageUpdates,
				renames: renames.filter(({from}) =>
					story.passages.some(
						passage => renameSceneRefs(passage.text, from, target) !== passage.text
					)
				),
				storyId: story.id,
				storyName: story.name
			});
		}
	}

	const remote: RemoteUse[] = [];

	for (const loser of losers) {
		for (const storyId of engine.usage(loser.id)) {
			if (!local.has(storyId)) {
				remote.push({
					by: engine.binding(storyId)?.by || undefined,
					loser: loser.name,
					storyId
				});
			}
		}
	}

	return {losers, remote, rewrites, survivor};
}
