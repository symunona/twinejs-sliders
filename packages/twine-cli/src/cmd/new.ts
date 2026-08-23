/**
 * `new` — an empty story on the server (spec 12 §1, command 12).
 *
 * The bar here is that a story made by the CLI must be indistinguishable from one made in
 * the editor: the editor's story list runs `repairStory` over everything it loads, and a
 * body missing a field gets it silently rewritten, which turns "the CLI made this" into a
 * write nobody asked for. So the shape below is `storyDefaults()` and `passageDefaults()`
 * from `src/store/stories/defaults.ts`, field for field, with the two things the reducers
 * add on creation: an uppercase IFID and a `startPassage` pointing at the first passage.
 *
 * Two fields are deliberately absent. `sync` is local-only and the server strips it
 * anyway, and `selected` is one editor's cursor state, not a property of the story.
 */

import {randomUUID} from 'node:crypto';
import {CliError, EXIT} from '../types';
import type {Ctx, PassageObject, StoryBody} from '../types';

export const name = 'new';
export const summary = 'Create an empty story: new uuid, new ifid, one start passage';

// `--format-version` takes its value with an `=`: bin.ts only splits a flag from the next
// argument for the flags it knows take one, and this is not a flag anyone types twice a day.
const USAGE =
	'usage: twine-cli new --name "<name>" [--format <name>] [--format-version=<v>]';

/**
 * The default the editor ships with (`src/store/prefs/defaults.ts`). Prefs live in a
 * browser and the CLI cannot read them, so the default is repeated rather than guessed —
 * and `--format` is there for the story that wants another one.
 */
const DEFAULT_FORMAT = {name: 'Sliders', version: '0.1.0'};

/** What the editor calls the passage it creates for an empty story. */
const FIRST_PASSAGE_NAME = 'Untitled Passage';

export interface NewStoryOptions {
	name: string;
	format?: string;
	formatVersion?: string;
	/** Injected by tests; production uses `crypto.randomUUID`. */
	uuid?: () => string;
}

export function emptyStoryBody(opts: NewStoryOptions): StoryBody {
	const uuid = opts.uuid ?? randomUUID;
	const storyId = uuid();
	const passage: PassageObject = {
		height: 100,
		highlighted: false,
		id: uuid(),
		// The editor centres this passage on the viewport it is about to open; there is no
		// viewport here, and the origin is where the story map starts scrolled to anyway.
		left: 0,
		name: FIRST_PASSAGE_NAME,
		selected: false,
		story: storyId,
		tags: [],
		text: '',
		top: 0,
		width: 100
	};

	return {
		id: storyId,
		ifid: uuid().toUpperCase(),
		lastUpdate: new Date().toISOString(),
		name: opts.name,
		passages: [passage],
		script: '',
		snapToGrid: true,
		startPassage: passage.id,
		storyFormat: opts.format ?? DEFAULT_FORMAT.name,
		storyFormatVersion: opts.formatVersion ?? DEFAULT_FORMAT.version,
		stylesheet: '',
		tags: [],
		tagColors: {},
		zoom: 1
	};
}

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	if (args.length > 0 && !flag(ctx, 'name')) {
		// `new "Episode 4"` is the obvious thing to type, and losing the name to a silent
		// usage error is worse than accepting it.
		ctx.flags.name = args[0];
	}

	const wanted = (flag(ctx, 'name') ?? '').trim();

	if (wanted === '') {
		throw new CliError(`new needs a name.\n${USAGE}`, EXIT.usage);
	}

	const taken = (await ctx.source.list(false)).find(
		story => !story.deleted && story.name.toLowerCase() === wanted.toLowerCase()
	);

	if (taken) {
		throw new CliError(
			`there is already a story named "${taken.name}" (${taken.id})`,
			EXIT.usage
		);
	}

	const body = emptyStoryBody({
		name: wanted,
		format: flag(ctx, 'format'),
		formatVersion: flag(ctx, 'format-version')
	});

	// If-Match "0" means "create this, never overwrite": a story that does not exist is
	// rev 0, so a uuid that somehow collided answers 412 instead of replacing a story.
	const written = await ctx.write.putStory(body.id, body, 0);

	if (ctx.json) {
		ctx.out(
			JSON.stringify({
				id: body.id,
				ifid: body.ifid,
				name: body.name,
				rev: written.rev,
				startPassage: body.startPassage,
				storyFormat: body.storyFormat,
				storyFormatVersion: body.storyFormatVersion
			})
		);
	} else {
		ctx.out(`${body.name}  ${body.id}  rev ${written.rev}`);
		ctx.out(`  ifid      ${body.ifid}`);
		ctx.out(`  format    ${body.storyFormat} ${body.storyFormatVersion}`);
		ctx.out(`  passages  1  ${FIRST_PASSAGE_NAME}`);
	}

	return EXIT.ok;
}

function flag(ctx: Ctx, key: string): string | undefined {
	const value = ctx.flags[key];

	return typeof value === 'string' ? value : undefined;
}
