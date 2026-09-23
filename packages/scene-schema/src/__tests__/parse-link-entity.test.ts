/**
 * `link:` and `highlight:` on an entity — what makes a prop or a character clickable.
 *
 * The interesting half is the SCALAR: `link: escape` cannot be told apart from a passage
 * name at the moment it is read, because the `links:` block it may be naming is allowed to
 * come after the entity that names it. So these tests care most about the post-pass that
 * decides, and about it deciding the same way whichever order the blocks were written in.
 */

import {parseScene} from '../parse-scene';

function props(text: string) {
	return parseScene(text).scene.entities;
}

describe('entity link:', () => {
	it('reads a passage name', () => {
		const scene = parseScene(`
props:
  door: {at: 0.3, link: Cellar}
`);

		expect(scene.errors).toEqual([]);
		expect(scene.scene.entities.door?.link).toEqual({to: 'Cellar'});
	});

	it('resolves a name that matches a links: entry, and keeps its if:', () => {
		const scene = parseScene(`
links:
  escape: {to: Alley, if: has_key}
props:
  gate: {link: escape}
`);

		expect(scene.errors).toEqual([]);
		expect(scene.scene.entities.gate?.link).toEqual({
			if: 'has_key',
			name: 'escape',
			to: 'Alley'
		});
	});

	it('resolves the same way when links: comes after the entity', () => {
		const after = parseScene(`
props:
  gate: {link: escape}
links:
  escape: {to: Alley}
`);

		expect(after.scene.entities.gate?.link).toEqual({
			name: 'escape',
			to: 'Alley'
		});
	});

	it('takes a map with its own condition', () => {
		const scene = parseScene(`
props:
  door: {link: {to: Cellar, if: has_lantern}}
`);

		expect(scene.errors).toEqual([]);
		expect(scene.scene.entities.door?.link).toEqual({
			if: 'has_lantern',
			to: 'Cellar'
		});
	});

	it('refuses a map with no to:', () => {
		const scene = parseScene(`
props:
  door: {link: {if: has_lantern}}
`);

		expect(scene.errors[0]?.message).toMatch(/needs a `to:`/);
		expect(scene.scene.entities.door?.link).toBeUndefined();
	});

	it('names a passage, so YAML must not turn `04` into the number 4', () => {
		const scene = parseScene(`
props:
  door: {link: 04}
`);

		expect(scene.scene.entities.door?.link).toEqual({to: '04'});
	});

	it('is a patch key, so a beat repoints it and the beat stages something', () => {
		const scene = parseScene(`
props:
  door: {at: 0.3, link: Hall}
beats:
  - door: {link: Cellar}
`);

		expect(scene.errors).toEqual([]);
		expect(scene.scene.beats[0]).toMatchObject({
			kind: 'set',
			patch: {link: {to: 'Cellar'}}
		});
	});

	it('takes `~` as an explicit clear, not as an absent key', () => {
		const scene = parseScene(`
props:
  door: {at: 0.3, link: Hall}
beats:
  - door: {link: ~}
`);

		expect(scene.errors).toEqual([]);
		expect(scene.scene.beats[0]).toMatchObject({patch: {link: null}});
	});

	it('reports a span per link, so two doors to one missing passage both squiggle', () => {
		const scene = parseScene(`
props:
  door: {link: Cellar}
  hatch: {link: Cellar}
`);

		expect(scene.entityLinkSpans).toHaveLength(2);
		expect(scene.entityLinkSpans?.map(span => span.to)).toEqual([
			'Cellar',
			'Cellar'
		]);
		expect(scene.entityLinkSpans?.[0].line).toBe(3);
	});

	it('rejects an unknown key inside the map', () => {
		const scene = parseScene(`
props:
  door: {link: {to: Cellar, icon: sword}}
`);

		expect(scene.errors[0]?.message).toMatch(/Unknown key 'icon' in link/);
	});
});

describe('entity highlight:', () => {
	it('is any token — the renderer ships a few, a story may paint its own', () => {
		expect(props(`props:\n  door: {link: X, highlight: gold}`).door?.highlight).toBe(
			'gold'
		);
		expect(props(`props:\n  rune: {link: X, highlight: arcane}`).rune?.highlight).toBe(
			'arcane'
		);
	});

	it('clears with `~`', () => {
		const scene = parseScene(`
props:
  door: {link: Hall, highlight: gold}
beats:
  - door: {highlight: ~}
`);

		expect(scene.scene.beats[0]).toMatchObject({patch: {highlight: null}});
	});
});

describe('where link: is not accepted', () => {
	it('is not a pose step key — a cycle animates a sprite, it does not repoint it', () => {
		const scene = parseScene(`
cast:
  mira: {pose: [{name: walk_1, link: Cellar}]}
`);

		expect(scene.errors.map(error => error.message).join(' ')).toMatch(
			/Unknown key 'link'/
		);
	});
});
