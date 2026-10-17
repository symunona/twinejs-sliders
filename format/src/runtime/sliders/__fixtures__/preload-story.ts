import {buildSceneIndex} from '@sliders/scene-index';
import type {AssetMeta, Character} from '@sliders/scene-types';

/**
 * Start ─┬─ A ── C (from: A)
 *        └─ B ── Start
 * Orphan: no link reaches it.
 */
export const passages = [
	{
		name: 'Start',
		text: '[scene]\nbg: hall\nmusic: theme\ncast:\n  mira: {at: 0}\nlinks:\n  a: {to: A}\n  b: {to: B}\n'
	},
	{name: 'A', text: '[scene]\nbg: forest\nlinks:\n  c: {to: C}\n'},
	{
		name: 'B',
		text: '[scene]\nbg: hall\nprops:\n  lamp: {at: 0}\nlinks:\n  back: {to: Start}\n'
	},
	{name: 'C', text: '[scene]\nfrom: A\ncast:\n  mira: {at: 0.3}\n'},
	{name: 'Orphan', text: '[scene]\nbg: secret\n'}
];

function meta(id: string, name: string, kind = 'bg'): AssetMeta {
	return {
		animated: false,
		bytes: 1000,
		h: 1,
		hash: id,
		id,
		kind,
		mime: kind === 'sound' ? 'audio/mpeg' : 'image/png',
		name,
		tags: [],
		w: 1
	} as AssetMeta;
}

export const assets: AssetMeta[] = [
	meta('a-hall', 'hall'),
	meta('a-forest', 'forest'),
	meta('a-cave', 'cave'),
	meta('a-secret', 'secret'),
	meta('a-lamp', 'lamp', 'object'),
	meta('a-theme', 'theme', 'sound'),
	meta('a-mira', 'mira-idle', 'frame'),
	meta('a-unused', 'unused')
];

export const characters: Character[] = [
	{
		id: 'mira',
		name: 'Mira',
		origin: {x: 0.5, y: 1},
		poses: {idle: {asset: 'a-mira'}},
		size: {h: 1, w: 1},
		tags: []
	} as Character
];

/** Every asset under its name and its id, as the publisher writes it. */
export const urls: Record<string, string> = Object.fromEntries(
	assets.flatMap(a => [
		[a.name, `https://art.test/${a.name}`],
		[a.id, `https://art.test/${a.name}`]
	])
);

const index = buildSceneIndex(passages);

export const sceneOf = (name: string) => index.scenes.get(name)?.scene;
