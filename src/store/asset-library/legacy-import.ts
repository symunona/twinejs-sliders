import {AssetRecord, LibraryEngine, Notice, SidecarInput} from '@sliders/asset-library';
import {migrateCharacter} from '@sliders/asset-store';
import type {AssetMeta, Character, CharacterPose} from '@sliders/scene-types';
import {poseAssets} from '@sliders/scene-types';
import {collectAssetRefs} from '../../util/sliders-bundle/collect-asset-refs';
import {resolveBundleRefs} from '../../util/sliders-bundle/resolve-refs';
import type {Story} from '../stories';
import {assetFieldsFromMeta, LibraryAssetStore} from './story-asset-store';

/**
 * Old per-story art (server `assets.json` + blobs) → the shared library, for one story.
 * `scripts/lib-import-legacy.ts` is the CLI. No app code calls this.
 *
 * - Own collection (`kind: story`, story name, numbered if taken) + binding id = story id.
 * - Every asset → an asset record in the own collection. Fields via `assetFieldsFromMeta`
 *   (the facade's mapping). `sourceAsset` remapped to the new uuid, dropped if unknown.
 * - Characters via the facade's `putCharacter`: poses repointed at the new uuids, pose
 *   images stamped `frame` + owner, as the app does.
 * - Binding refs = what the story's scenes reach (`collectAssetRefs` + `resolveBundleRefs`).
 * - Exact duplicates in the old manifest (same name, bytes, fields) fold into one record.
 * - A pose image named like its character becomes `<name>-pose` (shared namespace).
 * - Idempotent: an asset already in the own collection (same bytes + name, else same
 *   name) is skipped and mapped; a character whose charId is there is skipped.
 */

export interface LegacyStory {
	id: string;
	name: string;
	passages: {name?: string; text: string}[];
}

export interface LegacyBackup {
	story: LegacyStory;
	assets: AssetMeta[];
	characters: Character[];
	/** Bytes of the main blob, or undefined when the backup lacks it. */
	blob(meta: AssetMeta): Promise<Uint8Array | undefined>;
	/** Bytes of a sidecar, or undefined. */
	sidecar?(meta: AssetMeta, kind: string): Promise<Uint8Array | undefined>;
}

export interface LegacyImportReport {
	storyId: string;
	storyName: string;
	dryRun: boolean;
	collection: {id?: string; name: string; created: boolean};
	/** `merged`: exact duplicates in the old manifest, folded into one record. */
	assets: {created: string[]; skipped: string[]; failed: string[]; merged: string[]};
	characters: {created: string[]; skipped: string[]; failed: string[]};
	/** Old id → new uuid, created and skipped alike. */
	idMap: Record<string, string>;
	refs: number;
	unresolved: string[];
	warnings: string[];
}

const EMPTY = () => ({
	created: [] as string[],
	skipped: [] as string[],
	failed: [] as string[],
	merged: [] as string[]
});

/** Sources before the assets derived from them, so `sourceAsset` can be remapped. */
export function sourceFirst(assets: AssetMeta[]): AssetMeta[] {
	const byId = new Map(assets.map(meta => [meta.id, meta]));
	const out: AssetMeta[] = [];
	const seen = new Set<string>();

	const visit = (meta: AssetMeta, depth: number) => {
		if (seen.has(meta.id)) {
			return;
		}

		seen.add(meta.id);

		const source = meta.sourceAsset && byId.get(meta.sourceAsset);

		if (source && depth < 64) {
			visit(source, depth + 1);
		}

		out.push(meta);
	};

	assets.forEach(meta => visit(meta, 0));

	return out;
}

/**
 * Pose images → new uuids. An image with no new uuid is dropped (a pose left with none
 * is dropped too), and named in `lost`.
 */
export function remapPoses(
	character: Character,
	idMap: Map<string, string>,
	lost: string[] = []
): Character {
	const copy = JSON.parse(JSON.stringify(character)) as Character;
	const poses: Record<string, CharacterPose> = {};

	for (const [poseName, pose] of Object.entries(copy.poses ?? {})) {
		const next: CharacterPose = {...pose};

		if (pose.asset !== undefined) {
			const mapped = idMap.get(pose.asset);

			if (mapped) {
				next.asset = mapped;
			} else {
				lost.push(`${character.id}.${poseName}: ${pose.asset}`);
				delete next.asset;
			}
		}

		if (pose.steps) {
			next.steps = pose.steps.flatMap(step => {
				const mapped = idMap.get(step.asset);

				if (!mapped) {
					lost.push(`${character.id}.${poseName} step: ${step.asset}`);
					return [];
				}

				return [{...step, asset: mapped}];
			});

			if (!next.steps.length) {
				delete next.steps;
			}
		}

		if (next.asset !== undefined || next.steps?.length) {
			poses[poseName] = next;
		}
	}

	copy.poses = poses;

	return copy;
}

function findExisting(
	existing: AssetRecord[],
	claimed: Set<string>,
	meta: AssetMeta
): AssetRecord | undefined {
	const free = existing.filter(record => !claimed.has(record.id));
	const numbered = (name: string) =>
		name === meta.name ||
		(name.startsWith(`${meta.name}-`) && /^\d+$/.test(name.slice(meta.name.length + 1)));

	return (
		free.find(record => record.blob === meta.hash && record.name === meta.name) ??
		free.find(record => record.blob === meta.hash && numbered(record.name)) ??
		free.find(record => record.name === meta.name)
	);
}

export async function importLegacyStory(
	engine: LibraryEngine,
	backup: LegacyBackup,
	options: {dryRun?: boolean; log?: (line: string) => void} = {}
): Promise<LegacyImportReport> {
	const log = options.log ?? (() => undefined);
	const dryRun = !!options.dryRun;
	const {story} = backup;
	// Old shapes first (`frames` → `poses`, character anchors → per pose), so every pose
	// image is seen and remapped: the facade would migrate AFTER the remap, old ids kept.
	const characters = backup.characters.map(character =>
		migrateCharacter(JSON.parse(JSON.stringify(character)) as Character)
	);
	const report: LegacyImportReport = {
		assets: EMPTY(),
		characters: EMPTY(),
		collection: {created: false, name: story.name},
		dryRun,
		idMap: {},
		refs: 0,
		storyId: story.id,
		storyName: story.name,
		unresolved: [],
		warnings: []
	};
	const stopNotices = engine.onNotice((notice: Notice) => {
		if (notice.kind === 'renamed-on-clash') {
			report.warnings.push(`renamed on clash: ${notice.from} → ${notice.to}`);
		} else if (notice.kind !== 'conflict') {
			report.warnings.push(`${notice.kind} ${notice.type} ${notice.id}`);
		} else {
			report.warnings.push(`conflict ${notice.type} ${notice.id}: ${notice.fields.join(',')}`);
		}
	});

	try {
		let binding = engine.binding(story.id);

		if (binding) {
			report.collection.id = binding.own;
			report.collection.name =
				engine.get(binding.own, 'collection')?.name ?? story.name;
		} else if (!dryRun) {
			binding = engine.createStory(story.id, {name: story.name});
			report.collection = {
				created: true,
				id: binding.own,
				name: engine.get(binding.own, 'collection')?.name ?? story.name
			};
		} else {
			report.collection.created = true;
		}

		log(
			`collection ${report.collection.name} ${
				report.collection.created ? '(new)' : '(exists)'
			}`
		);

		const own = binding?.own;
		const existing = own ? engine.assets(own) : [];
		const claimed = new Set<string>();
		const idMap = new Map<string, string>();
		const charIds = new Set(characters.map(character => character.id));
		const poseImages = new Set(
			characters.flatMap(character =>
				Object.values(character.poses ?? {}).flatMap(poseAssets)
			)
		);
		/** Exact duplicate in the old manifest (same name, bytes, fields) → first old id. */
		const seen = new Map<string, string>();

		for (const original of sourceFirst(backup.assets)) {
			const dupKey = JSON.stringify([original.hash, assetFieldsFromMeta(original)]);
			const twin = seen.get(dupKey);

			if (twin !== undefined) {
				const mapped = idMap.get(twin);

				if (mapped || dryRun) {
					if (mapped) {
						idMap.set(original.id, mapped);
					}

					report.assets.merged.push(original.name);
					continue;
				}
			}

			seen.set(dupKey, original.id);

			// Pose images carry no public name (architecture plan), but the engine still
			// counts them in the namespace: one named like its character blocks the
			// character. Scenes address the character; poses point by uuid. Rename the image.
			const meta =
				charIds.has(original.name) &&
				(poseImages.has(original.id) || original.ownerCharacter)
					? {...original, name: `${original.name}-pose`}
					: original;

			if (meta !== original) {
				report.warnings.push(
					`pose image ${original.name} → ${meta.name} (character has that name)`
				);
			}

			const found = findExisting(existing, claimed, meta);

			if (found) {
				claimed.add(found.id);
				idMap.set(meta.id, found.id);
				report.assets.skipped.push(meta.name);
				continue;
			}

			if (dryRun) {
				report.assets.created.push(meta.name);
				continue;
			}

			try {
				const bytes = await backup.blob(meta);

				if (!bytes) {
					throw new Error('blob not in backup');
				}

				const sidecars: Record<string, SidecarInput> = {};

				for (const [kind, entry] of Object.entries(meta.sidecars ?? {})) {
					const side = await backup.sidecar?.(meta, kind);

					if (side) {
						sidecars[kind] = {bytes: side, mime: entry?.mime ?? meta.mime};
					} else {
						report.warnings.push(`${meta.name}: sidecar ${kind} not in backup`);
					}
				}

				const fields = assetFieldsFromMeta(meta);
				const source = meta.sourceAsset && idMap.get(meta.sourceAsset);
				const {asset} = await engine.addAsset(
					bytes,
					meta.mime || 'application/octet-stream',
					{
						...fields,
						allowDuplicate: true,
						collection: own!,
						...(source ? {sourceAsset: source} : {}),
						...(Object.keys(sidecars).length ? {sidecars} : {})
					}
				);

				if (meta.hash && asset!.blob !== meta.hash) {
					report.warnings.push(`${meta.name}: sha differs from manifest`);
				}

				idMap.set(meta.id, asset!.id);
				claimed.add(asset!.id);
				report.assets.created.push(asset!.name);
			} catch (error) {
				report.assets.failed.push(`${meta.name}: ${(error as Error).message}`);
			}
		}

		report.idMap = Object.fromEntries(idMap);

		const store = new LibraryAssetStore(story.id, async () => engine);
		const ownCharacters = new Set(
			own ? engine.characters(own).map(character => character.charId) : []
		);

		for (const character of characters) {
			if (ownCharacters.has(character.id)) {
				report.characters.skipped.push(character.id);
				continue;
			}

			if (dryRun) {
				report.characters.created.push(character.id);
				continue;
			}

			try {
				const lost: string[] = [];

				await store.putCharacter(remapPoses(character, idMap, lost));
				lost.forEach(line => report.warnings.push(`pose image lost: ${line}`));
				report.characters.created.push(character.id);
			} catch (error) {
				report.characters.failed.push(
					`${character.id}: ${(error as Error).message}`
				);
			}
		}

		if (!dryRun) {
			const resolved = await resolveBundleRefs(
				store,
				collectAssetRefs(story as unknown as Story)
			);

			engine.setRefs(
				story.id,
				resolved.assets.map(meta => meta.id)
			);
			report.refs = resolved.assets.length;
			report.unresolved = resolved.unresolved;
		}
	} finally {
		stopNotices();
	}

	return report;
}
