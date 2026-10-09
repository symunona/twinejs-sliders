import type {SharedInfo} from '../../store/asset-library/story-asset-store';
import {planRename, sceneRenames} from '../rename-plan';
import {renameSceneCharacter} from '../rename-scene-character';

function info(overrides: Partial<SharedInfo> = {}): SharedInfo {
	return {
		canFork: true,
		canUpdateAll: true,
		collection: {id: 'c1', kind: 'shared', locked: false, name: 'tavern-set'},
		foreign: true,
		id: 'a1',
		kind: 'asset',
		name: 'candle',
		shared: true,
		stories: [{storyId: 's2', storyName: 'Cellar'}],
		...overrides
	};
}

function scene(...lines: string[]) {
	return ['[scene]', ...lines].join('\n');
}

describe('planRename', () => {
	it('renames right away when nothing says the art is shared', () => {
		expect(planRename(undefined)).toBe('now');
	});

	/** Used by this story's scenes or not: they follow, so there is nothing to ask. */
	it('renames right away when the art is this story’s own', () => {
		expect(planRename(info({foreign: false, shared: false, stories: []}))).toBe(
			'now'
		);
	});

	it('asks once when other stories share the art', () => {
		expect(planRename(info())).toBe('ask');
	});

	it('asks when the art lives in a collection only attached here', () => {
		expect(planRename(info({stories: []}))).toBe('ask');
	});
});

describe('sceneRenames', () => {
	it('returns only the passages whose text changes', () => {
		const passages = [
			{id: 'p1', text: scene('bg: candle')},
			{id: 'p2', text: 'A candle, in prose.'},
			{id: 'p3', text: scene('props:', '  candle: {at: 0}')}
		];

		expect(sceneRenames(passages, 'candle', 'lantern')).toEqual({
			p1: {text: scene('bg: lantern')},
			p3: {text: scene('props:', '  lantern: {at: 0}')}
		});
	});

	/** A character rename never touches a backdrop that happens to share the word. */
	it('takes the rewrite to use', () => {
		const passages = [{id: 'p1', text: scene('bg: mira', 'cast:', '  mira: {at: 0}')}];

		expect(sceneRenames(passages, 'mira', 'tav', renameSceneCharacter)).toEqual({
			p1: {text: scene('bg: mira', 'cast:', '  tav: {at: 0}')}
		});
	});

	it('is empty when no scene names the old name', () => {
		expect(sceneRenames([{id: 'p1', text: scene('bg: night')}], 'candle', 'x')).toEqual(
			{}
		);
	});
});
