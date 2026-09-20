import {beatsOfferLinks} from '../beat-links';
import {parseScene} from '../parse-scene';

const offers = (lines: string[], live?: string[]) => {
	const {errors, scene} = parseScene(lines.join('\n'));

	expect(errors).toEqual([]);

	return beatsOfferLinks(scene, live && new Set(live));
};

/** For the scenes that are deliberately wrong — a dead `[[name]]` is a parse error. */
const offersBroken = (lines: string[]) =>
	beatsOfferLinks(parseScene(lines.join('\n')).scene);

describe('beatsOfferLinks', () => {
	it('is false for a scene with no beats', () => {
		expect(offers(['links:', '  go: {to: Street}'])).toBe(false);
	});

	it('is false when the beats only talk', () => {
		expect(
			offers(['links:', '  go: {to: Street}', 'beats:', '  - mira: "Well."'])
		).toBe(false);
	});

	it('finds a named wiki link that links: claims', () => {
		expect(
			offers([
				'links:',
				'  stay: {to: Tavern Fight}',
				'beats:',
				'  - mira: "Will you [[stay]]?"'
			])
		).toBe(true);
	});

	it('finds a wiki link that states its own target', () => {
		expect(offers(['beats:', '  - box: "The [[door->Hall]] is open."'])).toBe(
			true
		);
	});

	it('ignores a wiki link no links: entry claims', () => {
		expect(
			offersBroken([
				'links:',
				'  go: {to: Street}',
				'beats:',
				'  - mira: "Will you [[stay]]?"'
			])
		).toBe(false);
	});

	it('ignores a named wiki link whose entry was filtered out', () => {
		expect(
			offers(
				[
					'links:',
					'  stay: {to: Tavern Fight, if: has_weapon}',
					'  go: {to: Street}',
					'beats:',
					'  - mira: "Will you [[stay]]?"'
				],
				['go']
			)
		).toBe(false);
	});

	it('finds an entity link a beat sets', () => {
		expect(
			offers([
				'props:',
				'  door: {at: 0.3}',
				'beats:',
				'  - door: {link: Hall}'
			])
		).toBe(true);
	});

	it('finds an entity link on the speaker of a line', () => {
		expect(
			offers([
				'cast:',
				'  mira: {at: 0}',
				'beats:',
				'  - mira: {say: "Through there.", link: Cellar}'
			])
		).toBe(true);
	});

	it('ignores a beat that takes an entity link away', () => {
		expect(
			offers([
				'props:',
				'  door: {at: 0.3, link: Hall}',
				'beats:',
				'  - door: {link: ~}'
			])
		).toBe(false);
	});

	it('ignores an entity link naming an entry that was filtered out', () => {
		expect(
			offers(
				[
					'links:',
					'  escape: {to: Alley, if: has_key}',
					'  go: {to: Street}',
					'props:',
					'  gate: {at: 0.7}',
					'beats:',
					'  - gate: {link: escape}'
				],
				['go']
			)
		).toBe(false);
	});

	it('ignores a link declared outside the beats', () => {
		expect(
			offers([
				'props:',
				'  door: {at: 0.3, link: Hall}',
				'beats:',
				'  - box: "Dust."'
			])
		).toBe(false);
	});

	it('counts every entry live when no filter is passed', () => {
		expect(
			offers([
				'links:',
				'  stay: {to: Tavern Fight, if: has_weapon}',
				'beats:',
				'  - mira: "Will you [[stay]]?"'
			])
		).toBe(true);
	});
});
