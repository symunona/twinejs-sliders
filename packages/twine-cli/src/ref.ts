/**
 * The five ref forms (spec 12 §1) and how they land on something real.
 *
 * A ref is what an agent types, which means it is usually neither a uuid nor an exact name.
 * Resolution therefore widens in steps — exact id, exact name, slug, prefix — and stops at
 * the first step that finds exactly one thing. Two candidates is a usage error, not a guess:
 * picking one for the user is how the wrong passage gets overwritten.
 */

import {extractSceneBlock} from '@sliders/scene-index';
import {CliError, EXIT} from './types';
import type {AssetMetaRow, Manifest, PassageObject, Ref, Source, StoryBody, StoryMeta} from './types';

/**
 * `Chapter 3`, `chapter-3` and `CHAPTER_3` all reduce to `chapter-3`, so a name that has to
 * survive a shell without quoting still finds its story.
 */
export function slug(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Everything before the first `/`, `#` or `:` is the story, plus an optional `@rev`. */
export function parseRef(raw: string): Ref {
	const text = raw.trim();

	if (text === '') {
		throw new CliError('empty ref', EXIT.usage);
	}

	const cut = text.search(/[/#:]/);
	const head = cut === -1 ? text : text.slice(0, cut);
	const separator = cut === -1 ? '' : text[cut];
	const tail = cut === -1 ? '' : text.slice(cut + 1);

	const atRev = /^(.*)@(\d+)$/.exec(head);
	const story = (atRev ? atRev[1] : head).trim();
	const rev = atRev ? Number.parseInt(atRev[2], 10) : undefined;

	if (story === '') {
		throw new CliError(`ref "${raw}" names no story`, EXIT.usage);
	}

	switch (separator) {
		case '/':
			if (tail.trim() === '') {
				throw new CliError(`ref "${raw}" names no passage`, EXIT.usage);
			}

			return {kind: 'passage', passage: tail.trim(), rev, story};
		case '#':
			if (tail.trim() === '') {
				throw new CliError(`ref "${raw}" names no scene`, EXIT.usage);
			}

			return {kind: 'scene', rev, scene: tail.trim(), story};
		case ':':
			if (tail.trim() === '') {
				throw new CliError(`ref "${raw}" names no asset`, EXIT.usage);
			}

			// An asset ref has no rev: old revisions carry a manifest, not a second set of
			// blobs, so `ep3@37:a_8f21` would promise something the store cannot keep.
			return {asset: tail.trim(), kind: 'asset', story};
		default:
			return {kind: 'story', rev, story};
	}
}

function ambiguous(what: string, needle: string, candidates: string[]): CliError {
	return new CliError(
		`${what} "${needle}" is ambiguous:\n  ${candidates.join('\n  ')}`,
		EXIT.usage
	);
}

/**
 * Narrow a story spec to one story. Order is exact id, exact name, slug, id prefix — each
 * step only consulted when the one before it found nothing.
 */
export function pickStory(stories: StoryMeta[], spec: string): StoryMeta {
	const exactId = stories.find(story => story.id === spec);

	if (exactId) {
		return exactId;
	}

	const byName = stories.filter(story => story.name === spec);

	if (byName.length === 1) {
		return byName[0];
	}

	if (byName.length === 0) {
		const wanted = slug(spec);
		const bySlug = stories.filter(story => slug(story.name) === wanted);

		if (bySlug.length === 1) {
			return bySlug[0];
		}

		if (bySlug.length > 1) {
			throw ambiguous('story', spec, bySlug.map(describeStory));
		}

		const byPrefix = stories.filter(story => story.id.startsWith(spec));

		if (byPrefix.length === 1) {
			return byPrefix[0];
		}

		if (byPrefix.length > 1) {
			throw ambiguous('story', spec, byPrefix.map(describeStory));
		}

		throw new CliError(`no story matches "${spec}"`, EXIT.notFound);
	}

	throw ambiguous('story', spec, byName.map(describeStory));
}

function describeStory(story: StoryMeta): string {
	return `${story.id}  ${story.name}  rev ${story.rev}`;
}

/** Resolve the story half of a ref against whatever the source knows about. */
export async function resolveStory(source: Source, ref: Ref | string): Promise<StoryMeta> {
	const parsed = typeof ref === 'string' ? parseRef(ref) : ref;
	const stories = await source.list(true);

	return pickStory(stories, parsed.story);
}

/** Passage by exact name, then case-insensitive slug, then id prefix. */
export function pickPassage(body: StoryBody, spec: string): PassageObject {
	const passages = body.passages ?? [];
	const exact = passages.filter(passage => passage.name === spec);

	if (exact.length === 1) {
		return exact[0];
	}

	if (exact.length > 1) {
		throw ambiguous('passage', spec, exact.map(passage => `${passage.name}  ${passage.id}`));
	}

	const wanted = slug(spec);
	const bySlug = passages.filter(passage => slug(passage.name) === wanted);

	if (bySlug.length === 1) {
		return bySlug[0];
	}

	if (bySlug.length > 1) {
		throw ambiguous('passage', spec, bySlug.map(passage => `${passage.name}  ${passage.id}`));
	}

	const byPrefix = passages.filter(passage => passage.id.startsWith(spec));

	if (byPrefix.length === 1) {
		return byPrefix[0];
	}

	if (byPrefix.length > 1) {
		throw ambiguous('passage', spec, byPrefix.map(passage => `${passage.name}  ${passage.id}`));
	}

	throw new CliError(`no passage matches "${spec}" in "${body.name}"`, EXIT.notFound);
}

/**
 * The `id:` of a `[scene]` block, read with a regex rather than the YAML parser.
 *
 * `#tavern-night` has to keep working while the block below it is half typed — that is when
 * an agent needs to find the passage most — so a parse failure must not hide the id.
 */
export function sceneIdOf(passageText: string): string | undefined {
	const block = extractSceneBlock(passageText);

	if (!block) {
		return undefined;
	}

	const match = /^[ \t]*id[ \t]*:[ \t]*(.*)$/m.exec(block.text);

	if (!match) {
		return undefined;
	}

	const value = match[1]
		.replace(/\s+#.*$/, '')
		.trim()
		.replace(/^["']|["']$/g, '');

	return value === '' ? undefined : value;
}

/** Scene ids are unique per story (spec 02), so this is a lookup, not a search. */
export function pickScene(body: StoryBody, sceneId: string): PassageObject {
	const passages = body.passages ?? [];
	const matches = passages.filter(passage => sceneIdOf(passage.text) === sceneId);

	if (matches.length === 1) {
		return matches[0];
	}

	if (matches.length > 1) {
		// Duplicate scene ids are a lint error, not something to pick a winner for.
		throw ambiguous('scene', sceneId, matches.map(passage => passage.name));
	}

	throw new CliError(`no scene "${sceneId}" in "${body.name}"`, EXIT.notFound);
}

/** Asset by id, then by manifest name. */
export function pickAsset(manifest: Manifest, spec: string): AssetMetaRow {
	const byId = manifest.assets.find(asset => asset.id === spec);

	if (byId) {
		return byId;
	}

	const byName = manifest.assets.filter(asset => asset.name === spec);

	if (byName.length === 1) {
		return byName[0];
	}

	if (byName.length > 1) {
		throw ambiguous('asset', spec, byName.map(asset => `${asset.id}  ${asset.name}`));
	}

	const bySlug = manifest.assets.filter(asset => slug(asset.name) === slug(spec));

	if (bySlug.length === 1) {
		return bySlug[0];
	}

	if (bySlug.length > 1) {
		throw ambiguous('asset', spec, bySlug.map(asset => `${asset.id}  ${asset.name}`));
	}

	throw new CliError(`no asset matches "${spec}"`, EXIT.notFound);
}

/** What a resolved ref hands a command: the story, its body, and the thing pointed at. */
export interface ResolvedRef {
	ref: Ref;
	meta: StoryMeta;
	body: StoryBody;
	/** The rev the body was read at — `ref.rev` when given, the story's current rev otherwise. */
	rev: number;
	passage?: PassageObject;
}

/** One call for the common path: parse, find the story, load the body, find the passage. */
export async function resolveRef(source: Source, raw: Ref | string): Promise<ResolvedRef> {
	const ref = typeof raw === 'string' ? parseRef(raw) : raw;
	const meta = await resolveStory(source, ref);
	const rev = ref.kind === 'asset' ? meta.rev : (ref.rev ?? meta.rev);
	const body = await source.body(meta.id, rev === meta.rev ? undefined : rev);

	switch (ref.kind) {
		case 'passage':
			return {body, meta, passage: pickPassage(body, ref.passage), ref, rev};
		case 'scene':
			return {body, meta, passage: pickScene(body, ref.scene), ref, rev};
		default:
			return {body, meta, ref, rev};
	}
}

/** Same call, shorter name. Both are used across `cmd/`. */
export const resolve = resolveRef;
