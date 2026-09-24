import {buildStoryMap, lintStory} from '@sliders/story-map';
import {createToolRunner} from '../runner';
import {voiceTools} from '../tools';
import type {ToolPassage, VoiceToolEnv} from '../voice.types';

const TAVERN = `[scene]
id: tavern
bg: tavern/night
cast:
  mara: {at: [0.3, 0.8]}
beats:
  - mara: "Sit down."
  - mark: sit
links:
  onward: {to: Street Dawn}
`;

interface Fake {
	env: VoiceToolEnv;
	/** Every write the runner asked for, in order. */
	calls: {args: unknown[]; name: string}[];
	passages: ToolPassage[];
}

function fakeEnv(): Fake {
	const passages: ToolPassage[] = [
		{id: 'p1', name: 'Tavern Night', tags: ['start'], text: TAVERN},
		{id: 'p2', name: 'Street Dawn', tags: [], text: 'The street. [[Tavern Night]]'}
	];
	const calls: {args: unknown[]; name: string}[] = [];
	const record =
		(name: string) =>
		(...args: unknown[]) => {
			calls.push({args, name});
		};
	const story = () => ({id: 's1', name: 'Trip', passages});
	const assets = async () => [
		{bytes: 1024, id: 'a1', kind: 'bg', name: 'tavern/night'},
		{bytes: 2048, id: 'a2', kind: 'object', name: 'candle'}
	];

	const env: VoiceToolEnv = {
		assets,
		assetUsage: async () => ({a1: ['tavern']}),
		createPassage: (name, text) => {
			calls.push({args: [name, text], name: 'createPassage'});
			passages.push({id: `p${passages.length + 1}`, name, tags: [], text});

			return `p${passages.length}`;
		},
		deletePassage: record('deletePassage'),
		findReplace: (search, replace, ids) => {
			calls.push({args: [search, replace, ids], name: 'findReplace'});

			return 1;
		},
		goto: record('goto'),
		highlight: record('highlight'),
		lint: async () => lintStory({body: story(), ref: 'trip'}),
		map: async () => buildStoryMap({ref: 'trip', story: story()}),
		openPassageEditor: record('openPassageEditor'),
		openPreview: record('openPreview'),
		renamePassage: record('renamePassage'),
		story,
		tagPassage: record('tagPassage'),
		writePassage: (id, text) => {
			calls.push({args: [id, text], name: 'writePassage'});

			const passage = passages.find(candidate => candidate.id === id)!;

			passage.text = text;
		}
	};

	return {calls, env, passages};
}

describe('tool declarations', () => {
	it('gives every declared tool a handler', async () => {
		const {env} = fakeEnv();
		const runner = createToolRunner(env);

		for (const tool of voiceTools) {
			const result = await runner.run(tool.name, {});

			// A tool may refuse these empty arguments. It may not be missing.
			expect(result.ok === false ? result.error : '').not.toMatch(/not wired up/);
		}
	});

	it('refuses a name it does not declare', async () => {
		const runner = createToolRunner(fakeEnv().env);

		expect(await runner.run('rm_rf', {})).toEqual({
			error: "no tool called 'rm_rf'",
			ok: false
		});
	});

	it('does not offer restore — that is the author’s button', () => {
		expect(voiceTools.map(tool => tool.name)).not.toContain('restore');
	});

	it('does not offer story-level settings — voice is for storylines', () => {
		const names = voiceTools.map(tool => tool.name);

		expect(names).not.toContain('update_story');
		expect(names).not.toContain('set_stylesheet');
	});
});

describe('read tools', () => {
	it('maps the story without the passage text in it', async () => {
		const result = await createToolRunner(fakeEnv().env).run('map', {});

		expect(result.ok).toBe(true);
		expect(JSON.stringify(result)).not.toContain('Sit down.');
		expect((result as any).passages).toHaveLength(2);
		expect((result as any).scenes[0].id).toBe('tavern');
	});

	it('reads a passage by name, case-insensitively', async () => {
		const result = await createToolRunner(fakeEnv().env).run('read_passage', {
			ref: 'tavern night'
		});

		expect((result as any).text).toContain('Sit down.');
		expect((result as any).tags).toEqual(['start']);
	});

	it('reads a passage by id', async () => {
		const result = await createToolRunner(fakeEnv().env).run('read_passage', {ref: 'p1'});

		expect((result as any).name).toBe('Tavern Night');
	});

	it('says where the scene block starts', async () => {
		const result = await createToolRunner(fakeEnv().env).run('read_passage', {ref: 'p1'});

		expect((result as any).scene).toBe(2);
	});

	it('reads a scene by its id', async () => {
		const result = await createToolRunner(fakeEnv().env).run('read_scene', {
			sceneId: 'tavern'
		});

		expect(result.ok).toBe(true);
		expect((result as any).cast).toEqual(['mara']);
		expect((result as any).beats).toHaveLength(2);
		expect((result as any).passage).toBe('Tavern Night');
	});

	it('numbers the beats it hands back, so set_beat has an index to use', async () => {
		const result = await createToolRunner(fakeEnv().env).run('read_scene', {
			sceneId: 'tavern'
		});

		expect((result as any).beats.map((beat: any) => beat.index)).toEqual([0, 1]);
	});

	it('lints the whole story, and one passage when asked', async () => {
		const runner = createToolRunner(fakeEnv().env);
		const all = await runner.run('lint', {});
		const one = await runner.run('lint', {ref: 'Street Dawn'});

		expect(all.ok).toBe(true);
		expect((one as any).findings.length).toBeLessThanOrEqual(
			(all as any).findings.length
		);
	});

	it('walks the link graph from one passage', async () => {
		const result = await createToolRunner(fakeEnv().env).run('graph', {
			from: 'Tavern Night'
		});

		expect((result as any).edges[0]).toMatchObject({depth: 0, from: 'Tavern Night'});
	});

	it('lists assets with the scenes that reach them', async () => {
		const result = await createToolRunner(fakeEnv().env).run('list_assets', {});

		expect((result as any).assets).toHaveLength(2);
		expect((result as any).assets[0].usedBy).toEqual(['tavern']);
	});

	it('finds an asset by a fragment of its name', async () => {
		const result = await createToolRunner(fakeEnv().env).run('find_asset', {q: 'cand'});

		expect((result as any).matches).toEqual([
			{id: 'a2', kind: 'object', name: 'candle'}
		]);
	});

	it('says the preview is not mounted rather than pretending to look', async () => {
		const result = await createToolRunner(fakeEnv().env).run('screenshot_scene', {
			ref: 'p1'
		});

		expect(result).toEqual({error: expect.stringMatching(/not mounted/), ok: false});
	});

	it('takes a screenshot when a host is mounted', async () => {
		const {env} = fakeEnv();

		env.screenshot = async () => ({data: 'AAA', height: 432, mime: 'image/png', width: 768});

		const result = await createToolRunner(env).run('screenshot_scene', {beat: 1, ref: 'p1'});

		expect(result).toMatchObject({beat: 1, height: 432, ok: true, width: 768});
	});

	it('allows only one screenshot per turn', async () => {
		const {env} = fakeEnv();

		env.screenshot = async () => ({data: 'AAA', height: 432, mime: 'image/png', width: 768});

		const runner = createToolRunner(env);

		expect(await runner.run('screenshot_scene', {ref: 'p1'})).toMatchObject({ok: true});
		expect(await runner.run('screenshot_scene', {ref: 'p1'})).toMatchObject({
			error: expect.stringMatching(/one screenshot per turn/),
			ok: false
		});
	});

	it('re-arms the screenshot cap when the turn ends', async () => {
		const {env} = fakeEnv();

		env.screenshot = async () => ({data: 'AAA', height: 432, mime: 'image/png', width: 768});

		const runner = createToolRunner(env);

		await runner.run('screenshot_scene', {ref: 'p1'});
		runner.endTurn();

		expect(await runner.run('screenshot_scene', {ref: 'p1'})).toMatchObject({ok: true});
	});

	it('does not burn the turn’s screenshot on a call that failed', async () => {
		const {env} = fakeEnv();

		env.screenshot = async () => ({data: 'AAA', height: 432, mime: 'image/png', width: 768});

		const runner = createToolRunner(env);

		await runner.run('screenshot_scene', {ref: 'Nowhere'});

		expect(await runner.run('screenshot_scene', {ref: 'p1'})).toMatchObject({ok: true});
	});
});

describe('the blind-write gate', () => {
	it('refuses a write to a passage that was never read', async () => {
		const {calls, env} = fakeEnv();
		const result = await createToolRunner(env).run('write_passage', {
			ref: 'Tavern Night',
			text: 'gone'
		});

		expect(result).toEqual({
			error: expect.stringMatching(/read_passage 'Tavern Night' first/),
			ok: false
		});
		expect(calls).toHaveLength(0);
	});

	it('allows the write once the passage has been read', async () => {
		const {calls, env} = fakeEnv();
		const runner = createToolRunner(env);

		await runner.run('read_passage', {ref: 'Tavern Night'});

		const result = await runner.run('write_passage', {ref: 'p1', text: 'new text'});

		expect(result).toMatchObject({name: 'Tavern Night', ok: true});
		expect(calls).toEqual([{args: ['p1', 'new text'], name: 'writePassage'}]);
	});

	it('counts read_scene as having seen the passage', async () => {
		const {env} = fakeEnv();
		const runner = createToolRunner(env);

		await runner.run('read_scene', {sceneId: 'tavern'});

		expect(await runner.run('write_passage', {ref: 'p1', text: 'x'})).toMatchObject({
			ok: true
		});
	});

	it('does not carry the gate between sessions', async () => {
		const {env} = fakeEnv();

		await createToolRunner(env).run('read_passage', {ref: 'p1'});

		expect(
			await createToolRunner(env).run('write_passage', {ref: 'p1', text: 'x'})
		).toMatchObject({ok: false});
	});

	it('gates link too, because a link appends to the text', async () => {
		const {env} = fakeEnv();

		expect(
			await createToolRunner(env).run('link', {from: 'p1', to: 'Somewhere'})
		).toMatchObject({error: expect.stringMatching(/read_passage/), ok: false});
	});

	it('treats a passage it just created as read', async () => {
		const {env} = fakeEnv();
		const runner = createToolRunner(env);

		await runner.run('create_passage', {name: 'Cellar', text: 'dark'});

		expect(await runner.run('write_passage', {ref: 'Cellar', text: 'x'})).toMatchObject({
			ok: true
		});
	});
});

describe('write tools', () => {
	it('reports an identical write as unchanged and dispatches nothing', async () => {
		const {calls, env} = fakeEnv();
		const runner = createToolRunner(env);

		await runner.run('read_passage', {ref: 'p1'});

		expect(await runner.run('write_passage', {ref: 'p1', text: TAVERN})).toMatchObject({
			ok: true,
			unchanged: true
		});
		expect(calls).toHaveLength(0);
	});

	it('creates a passage and hands back its id', async () => {
		const {env} = fakeEnv();
		const result = await createToolRunner(env).run('create_passage', {
			name: 'Cellar',
			text: 'dark'
		});

		expect(result).toMatchObject({name: 'Cellar', ok: true});
		expect(env.story().passages.map(passage => passage.name)).toContain('Cellar');
	});

	it('refuses to create a passage whose name is taken', async () => {
		const result = await createToolRunner(fakeEnv().env).run('create_passage', {
			name: 'Street Dawn'
		});

		expect(result).toMatchObject({error: expect.stringMatching(/already/), ok: false});
	});

	it('refuses a rename onto an existing name', async () => {
		const result = await createToolRunner(fakeEnv().env).run('rename_passage', {
			name: 'Street Dawn',
			ref: 'p1'
		});

		expect(result).toMatchObject({error: expect.stringMatching(/already/), ok: false});
	});

	it('renames through the editor’s own action, so inbound links follow', async () => {
		const {calls, env} = fakeEnv();

		await createToolRunner(env).run('rename_passage', {name: 'Tavern Dusk', ref: 'p1'});

		expect(calls).toEqual([{args: ['p1', 'Tavern Dusk'], name: 'renamePassage'}]);
	});

	it('deletes a passage', async () => {
		const {calls, env} = fakeEnv();

		await createToolRunner(env).run('delete_passage', {ref: 'Street Dawn'});

		expect(calls).toEqual([{args: ['p2'], name: 'deletePassage'}]);
	});

	it('tags a passage, and refuses a call that changes no tag', async () => {
		const {calls, env} = fakeEnv();
		const runner = createToolRunner(env);

		await runner.run('tag_passage', {add: ['draft'], ref: 'p1'});
		expect(calls).toEqual([{args: ['p1', ['draft'], []], name: 'tagPassage'}]);

		expect(await runner.run('tag_passage', {ref: 'p1'})).toMatchObject({ok: false});
	});

	it('patches a scene through the surgical writer', async () => {
		const {calls, env} = fakeEnv();
		const result = await createToolRunner(env).run('patch_scene', {
			sceneId: 'tavern',
			yaml: 'bg: tavern/dawn'
		});

		expect(result).toMatchObject({changed: ['bg'], ok: true});
		expect(calls[0].name).toBe('writePassage');
		expect(calls[0].args[1]).toContain('tavern/dawn');
	});

	it('does not need a read first to patch a scene — the writer is surgical', async () => {
		const result = await createToolRunner(fakeEnv().env).run('patch_scene', {
			sceneId: 'tavern',
			yaml: 'bg: tavern/dawn'
		});

		expect(result.ok).toBe(true);
	});

	it('sets one beat', async () => {
		const {calls, env} = fakeEnv();
		const result = await createToolRunner(env).run('set_beat', {
			beat: 0,
			patch: 'say: "Please sit."',
			sceneId: 'tavern'
		});

		expect(result).toMatchObject({beat: 0, ok: true});
		expect(calls[0].args[1]).toContain('Please sit.');
	});

	it('takes a beat index sent as a string', async () => {
		const result = await createToolRunner(fakeEnv().env).run('set_beat', {
			beat: '0',
			patch: 'say: "Please sit."',
			sceneId: 'tavern'
		});

		expect(result).toMatchObject({beat: 0, ok: true});
	});

	it('refuses a scene id that is not in the story', async () => {
		expect(
			await createToolRunner(fakeEnv().env).run('patch_scene', {
				sceneId: 'cellar',
				yaml: 'bg: x'
			})
		).toMatchObject({error: "no scene 'cellar'", ok: false});
	});

	it('appends a link and says whether the target is new', async () => {
		const {env} = fakeEnv();
		const runner = createToolRunner(env);

		await runner.run('read_passage', {ref: 'p1'});

		expect(await runner.run('link', {from: 'p1', to: 'Cellar'})).toMatchObject({
			created: true,
			ok: true
		});
		expect(env.story().passages[0].text).toContain('[[Cellar]]');
	});

	it('scopes a find-replace to one passage when asked', async () => {
		const {calls, env} = fakeEnv();

		await createToolRunner(env).run('find_replace', {q: 'a', scope: 'p1', with: 'b'});

		expect(calls).toEqual([{args: ['a', 'b', ['p1']], name: 'findReplace'}]);
	});

	it('runs a find-replace over the whole story when unscoped', async () => {
		const {calls, env} = fakeEnv();

		await createToolRunner(env).run('find_replace', {q: 'a', with: 'b'});

		expect(calls[0].args[2]).toBeUndefined();
	});

	it('turns a throwing action creator into an error result, not a crash', async () => {
		const {env} = fakeEnv();

		env.deletePassage = () => {
			throw new Error('that passage does not belong to this story');
		};

		expect(await createToolRunner(env).run('delete_passage', {ref: 'p1'})).toEqual({
			error: 'that passage does not belong to this story',
			ok: false
		});
	});
});

describe('verify after write', () => {
	it('tells the model when its write broke the scene', async () => {
		const {env} = fakeEnv();
		const runner = createToolRunner(env);

		await runner.run('read_passage', {ref: 'p1'});

		const result = await runner.run('write_passage', {
			ref: 'p1',
			text: TAVERN.replace('Street Dawn', 'Nowhere')
		});

		expect(result).toMatchObject({lint: {fixed: 0}, ok: true});
		expect((result as unknown as {lint: {new: string[]}}).lint.new).toContainEqual(
			expect.stringMatching(/^trip\/Tavern Night:\d+: error: .*Nowhere/)
		);
	});

	it('does not repeat problems the story already had', async () => {
		const {env, passages} = fakeEnv();

		passages[0].text = TAVERN.replace('Street Dawn', 'Nowhere');

		const runner = createToolRunner(env);

		await runner.run('read_passage', {ref: 'p2'});

		const result = await runner.run('write_passage', {
			ref: 'p2',
			text: 'The empty street. [[Tavern Night]]'
		});

		expect(result).toMatchObject({lint: {fixed: 0, new: []}, ok: true});
		expect((result as unknown as {lint: {errors: number}}).lint.errors).toBeGreaterThan(0);
	});

	it('counts what a write fixed', async () => {
		const {env, passages} = fakeEnv();

		passages[0].text = TAVERN.replace('Street Dawn', 'Nowhere');

		const runner = createToolRunner(env);

		await runner.run('read_passage', {ref: 'p1'});

		const result = await runner.run('write_passage', {ref: 'p1', text: TAVERN});

		expect(result).toMatchObject({lint: {errors: 0, new: []}, ok: true});
		expect((result as unknown as {lint: {fixed: number}}).lint.fixed).toBeGreaterThan(0);
	});

	it('does not lint around a read, a refused write or an unchanged one', async () => {
		const {env} = fakeEnv();
		const runner = createToolRunner(env);

		expect(await runner.run('map', {})).not.toHaveProperty('lint');
		expect(await runner.run('write_passage', {ref: 'p1', text: 'x'})).not.toHaveProperty(
			'lint'
		);

		await runner.run('read_passage', {ref: 'p1'});

		expect(
			await runner.run('write_passage', {ref: 'p1', text: TAVERN})
		).not.toHaveProperty('lint');
	});

	it('still lands the write when the lint itself fails', async () => {
		const {env} = fakeEnv();

		env.lint = async () => {
			throw new Error('no catalog');
		};

		const result = await createToolRunner(env).run('create_passage', {name: 'Cellar'});

		expect(result).toMatchObject({name: 'Cellar', ok: true});
		expect(result).not.toHaveProperty('lint');
	});
});

describe('ui tools', () => {
	it('selects and scrolls to a passage', async () => {
		const {calls, env} = fakeEnv();

		await createToolRunner(env).run('goto', {ref: 'Street Dawn'});

		expect(calls).toEqual([{args: ['p2'], name: 'goto'}]);
	});

	it('opens the preview standing on a beat', async () => {
		const {calls, env} = fakeEnv();

		await createToolRunner(env).run('open_preview', {beat: 1, ref: 'p1'});

		expect(calls).toEqual([{args: ['p1', 1], name: 'openPreview'}]);
	});

	it('opens the passage editor', async () => {
		const {calls, env} = fakeEnv();

		await createToolRunner(env).run('open_passage_editor', {ref: 'p1'});

		expect(calls).toEqual([{args: ['p1'], name: 'openPassageEditor'}]);
	});

	it('highlights what it found and names what it did not', async () => {
		const {calls, env} = fakeEnv();
		const result = await createToolRunner(env).run('highlight', {
			refs: ['p1', 'Nowhere']
		});

		expect(result).toMatchObject({highlighted: 1, missing: ['Nowhere'], ok: true});
		expect(calls).toEqual([{args: [['p1']], name: 'highlight'}]);
	});

	it('says there is nothing to pin when the story is not on a server', async () => {
		const result = await createToolRunner(fakeEnv().env).run('checkpoint', {
			label: 'before voice session'
		});

		expect(result).toMatchObject({ok: false});
	});

	it('pins a checkpoint, clamped to 120 characters', async () => {
		const {env} = fakeEnv();
		const labels: string[] = [];

		env.checkpoint = async label => {
			labels.push(label);
		};

		await createToolRunner(env).run('checkpoint', {label: 'x'.repeat(200)});

		expect(labels[0]).toHaveLength(120);
	});
});
