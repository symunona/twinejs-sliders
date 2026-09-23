import {collectPassageRefs} from '../sliders-bundle/collect-asset-refs';
import {renameSceneRefs} from '../rename-scene-refs';

/**
 * Renaming a piece of art and carrying the scenes along with it.
 *
 * The drift guard at the bottom is the point of the file: this module writes the list of
 * places a ref can appear for the second time, and `collect-asset-refs.ts` -- which reads
 * the same list off the PARSED scene -- is the authority. Every fixture here is fed to
 * both, and the old name has to be gone from what the collector reports.
 */

function scene(...lines: string[]) {
	return ['[scene]', ...lines].join('\n');
}

/** Every name the collector reports, in one flat set. Poses are per entity, not refs. */
function refsOf(text: string): Set<string> {
	const refs = collectPassageRefs(text);

	return new Set([
		...refs.assetRefs,
		...(refs.autoRefs ?? []),
		...refs.characterRefs,
		...refs.fxRefs,
		...(refs.optionalAssetRefs ?? []),
		...(refs.soundRefs ?? [])
	]);
}

describe('renameSceneRefs', () => {
	it('follows the rename into every art key', () => {
		const text = scene(
			'id: tavern',
			'bg: candle',
			'music: candle@0.4',
			'fx: [candle, rain@0.6]',
			'props:',
			'  lamp: {ref: candle}',
			'beats:',
			'  - sfx: candle',
			'  - bg: {id: candle, fx: parallax_left}',
			'  - mira: {say: "Hm.", bg: candle, sfx: candle@0.2}'
		);

		expect(renameSceneRefs(text, 'candle', 'lantern')).toBe(
			scene(
				'id: tavern',
				'bg: lantern',
				'music: lantern@0.4',
				'fx: [lantern, rain@0.6]',
				'props:',
				'  lamp: {ref: lantern}',
				'beats:',
				'  - sfx: lantern',
				'  - bg: {id: lantern, fx: parallax_left}',
				'  - mira: {say: "Hm.", bg: lantern, sfx: lantern@0.2}'
			)
		);
	});

	/** The entry key IS the ref, so the id moves with the art--and so does everything
	    addressing that id. This half is `renameSceneCharacter`'s. */
	it('moves an entity id that was standing in for the ref', () => {
		const text = scene(
			'props:',
			'  candle: {at: 0}',
			'  plate: {of: candle}',
			'beats:',
			'  - candle: {at: 0.2}'
		);

		expect(renameSceneRefs(text, 'candle', 'lantern')).toBe(
			scene(
				'props:',
				'  lantern: {at: 0}',
				'  plate: {of: lantern}',
				'beats:',
				'  - lantern: {at: 0.2}'
			)
		);
	});

	/** An id the block redefined is the block's own word, not this art. */
	it('leaves an id alone when the entry points somewhere else', () => {
		const text = scene('props:', '  candle: {ref: lamp}', '  plate: {of: candle}');

		expect(renameSceneRefs(text, 'candle', 'lantern')).toBe(text);
	});

	/** `id:` doubles as `bg:`, and the id cannot move--another passage's `from:` names it. */
	it('spells out the backdrop an id was standing in for', () => {
		const text = scene('id: candle   # the one on the table', 'cast:', '  mira: {at: 0}');

		expect(renameSceneRefs(text, 'candle', 'lantern')).toBe(
			scene(
				'id: candle   # the one on the table',
				'bg: lantern',
				'cast:',
				'  mira: {at: 0}'
			)
		);
	});

	it('leaves a patch scene alone, which inherits its backdrop', () => {
		const text = scene('id: candle', 'from: Tavern');

		expect(renameSceneRefs(text, 'candle', 'lantern')).toBe(text);
	});

	it('keeps comments, blank lines and quoting as the author wrote them', () => {
		const text = scene(
			'',
			'bg:   candle    # lit',
			'',
			'fx: [ candle@0.6 ]'
		);

		expect(renameSceneRefs(text, 'candle', 'lantern')).toBe(
			scene('', 'bg:   lantern    # lit', '', 'fx: [ lantern@0.6 ]')
		);
	});

	/** A name YAML would read as something other than a string has to come back quoted. */
	it('quotes a new name that would stop being a string', () => {
		expect(renameSceneRefs(scene('bg: candle'), 'candle', 'true')).toBe(
			scene('bg: "true"')
		);
	});

	it('leaves prose, poses and marks alone', () => {
		const text = scene(
			'bg: tavern',
			'cast:',
			'  mira: {pose: candle}',
			'beats:',
			'  - mark: candle',
			'  - mira: "The candle gutters."'
		);

		expect(renameSceneRefs(text, 'candle', 'lantern')).toBe(text);
	});

	it('leaves a passage with no scene block alone', () => {
		expect(renameSceneRefs('Just prose about a candle.', 'candle', 'lantern')).toBe(
			'Just prose about a candle.'
		);
	});

	/** A half-typed block parses to a guess, and splicing at a guess mangles it. */
	it('leaves a block that does not parse alone', () => {
		const text = scene('bg: candle', 'props:', ' - broken: [');

		expect(renameSceneRefs(text, 'candle', 'lantern')).toBe(text);
	});

	it('does nothing when the name does not change', () => {
		const text = scene('bg: candle');

		expect(renameSceneRefs(text, 'candle', 'candle')).toBe(text);
		expect(renameSceneRefs(text, '', 'lantern')).toBe(text);
		expect(renameSceneRefs(text, 'candle', '')).toBe(text);
	});

	/**
	 * The tripwire. `collect-asset-refs.ts` decides what a ref IS; if it can see a name
	 * this module cannot rewrite, the author is told the rename is clean when it is not.
	 */
	describe('agrees with the reference collector', () => {
		const blocks = [
			scene('id: candle'),
			scene('bg: candle'),
			scene('bg: {id: candle, fx: parallax_left}'),
			scene('music: candle@0.4'),
			scene('fx: [candle@0.6]'),
			scene('props:', '  candle: {at: 0}'),
			scene('entities:', '  shade: {ref: candle}'),
			scene('cast:', '  candle: {at: 0}'),
			scene('beats:', '  - sfx: candle'),
			scene('beats:', '  - bg: candle'),
			scene('beats:', '  - fx: candle@0.3'),
			scene('beats:', '  - mira: {say: "Hm.", bg: candle}'),
			scene('beats:', '  - mira: {say: "Hm.", sfx: candle}')
		];

		it.each(blocks)('rewrites every ref in %#', block => {
			// The fixture has to be one the collector sees at all, or the case proves
			// nothing.
			expect(refsOf(block).has('candle')).toBe(true);

			const renamed = renameSceneRefs(block, 'candle', 'lantern');

			expect(refsOf(renamed).has('candle')).toBe(false);
			expect(refsOf(renamed).has('lantern')).toBe(true);
		});
	});
});
