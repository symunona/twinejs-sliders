import {sceneModifier} from '../scene-modifier';
import {encodePayload, linkEntries} from '../stage-element';
import type {StagePayload} from '../stage-element';
import {get} from '../../state';

jest.mock('../../state', () => ({get: jest.fn(), set: jest.fn()}));

// `logger/index.ts` re-exports Chapbook's `init.ts`, which does not type-check on its own
// (`event.detail` off a plain `Event`). The bundler never type-checks it and the player is
// fine; ts-jest does, and would otherwise let a vendored bug decide whether this file can
// run at all. Nothing here reads a log line.
jest.mock('../../logger', () => ({
	createLoggers: () => ({log: () => {}, warn: () => {}})
}));

// Same story, same reason: `story.ts` and `actions.ts` reach this file only because
// `scene-modifier` imports `encodePayload` from `stage-element`. Neither is exercised here
// — following a link is the element's job, tested where the element is.
jest.mock('../../story', () => ({passageNamed: () => undefined}));
jest.mock('../../actions', () => ({go: () => {}}));

const mockGet = get as jest.MockedFunction<typeof get>;

/** Story variables the scene is rendered against — `if:` conditions and the config flags. */
function storyVars(vars: Record<string, unknown> = {}) {
	mockGet.mockImplementation(name => vars[name]);
}

function render(text: string) {
	const output = {startsNewParagraph: false, text};

	sceneModifier.processRaw?.(output, {invocation: 'scene', state: {}});

	return output.text;
}

/** Everything after the element: the Chapbook markup, or the empty string. */
function markup(html: string): string {
	return html.slice(
		html.indexOf('</sliders-stage>') + '</sliders-stage>'.length
	);
}

function payloadOf(html: string): StagePayload {
	const attr = /scene="([^"]*)"/.exec(html);

	return JSON.parse(decodeURIComponent(attr?.[1] ?? ''));
}

const TWO_LINKS = ['links:', '  stay: Tavern Fight', '  leave: Street'].join(
	'\n'
);

/** Beats that show the reader a line but nothing to click. */
const QUIET_BEATS = ['beats:', '  - box: "The door is shut."'].join('\n');

/** Beats that already offer a way out, so `auto` says the list would be a duplicate. */
const FORKING_BEATS = ['beats:', '  - box: "[[stay]] or [[leave]]?"'].join(
	'\n'
);

function scene(...blocks: string[]) {
	return [...blocks].join('\n');
}

beforeEach(() => storyVars());

describe('no linkList: — the markup under the stage, unchanged', () => {
	it('emits the fork exactly as it always has', () => {
		expect(markup(render(scene(TWO_LINKS, QUIET_BEATS)))).toBe(
			'\n\n> [[stay->Tavern Fight]]\n> [[leave->Street]]\n'
		);
	});

	it('emits nothing when the beats already offer a way out', () => {
		expect(markup(render(scene(TWO_LINKS, FORKING_BEATS)))).toBe('');
	});

	it('emits nothing for a scene with no links at all', () => {
		expect(markup(render(scene(QUIET_BEATS)))).toBe('');
	});

	it('drops a link whose `if:` is false, from the markup and the payload alike', () => {
		storyVars({has_coin: false});

		const html = render(
			scene(
				[
					'links:',
					'  stay: Tavern Fight',
					'  leave: {to: Street, if: has_coin}'
				].join('\n'),
				QUIET_BEATS
			)
		);

		expect(markup(html)).toBe('\n\n> [[stay->Tavern Fight]]\n');
		expect(payloadOf(html).links).toEqual({stay: 'Tavern Fight'});
	});

	it('never asks the stage to draw a list', () => {
		expect(payloadOf(render(scene(TWO_LINKS, QUIET_BEATS))).drawLinks).toBe(
			false
		);
	});
});

describe('linkList: present — the stage draws it instead', () => {
	const LIST = ['linkList:', '  at: [0.5, 0.86]', '  w: 0.8'].join('\n');

	it('emits no Chapbook markup, so the reader never sees the choices twice', () => {
		expect(markup(render(scene(TWO_LINKS, LIST, QUIET_BEATS)))).toBe('');
	});

	it('tells the stage to draw the list', () => {
		const payload = payloadOf(render(scene(TWO_LINKS, LIST, QUIET_BEATS)));

		expect(payload.drawLinks).toBe(true);
		expect(payload.scene.linkList).toEqual({at: {x: 0.5, y: 0.86}, w: 0.8});
	});

	it('draws nothing at all under `show: never`', () => {
		const html = render(
			scene(TWO_LINKS, ['linkList:', '  show: never'].join('\n'), QUIET_BEATS)
		);

		expect(markup(html)).toBe('');
		expect(payloadOf(html).drawLinks).toBe(false);
	});

	it('draws under `show: always` even though the beats offer a way out', () => {
		const html = render(
			scene(
				TWO_LINKS,
				['linkList:', '  show: always'].join('\n'),
				FORKING_BEATS
			)
		);

		expect(markup(html)).toBe('');
		expect(payloadOf(html).drawLinks).toBe(true);
	});

	it('lets `sliders.showLinks: false` win over `auto`', () => {
		storyVars({'sliders.showLinks': false});

		expect(
			payloadOf(render(scene(TWO_LINKS, LIST, QUIET_BEATS))).drawLinks
		).toBe(false);
	});

	it('lets an explicit `show:` win over `sliders.showLinks`', () => {
		storyVars({'sliders.showLinks': false});

		expect(
			payloadOf(
				render(
					scene(
						TWO_LINKS,
						['linkList:', '  show: always'].join('\n'),
						QUIET_BEATS
					)
				)
			).drawLinks
		).toBe(true);
	});

	it('draws nothing when every link was gated off by its `if:`', () => {
		storyVars({has_coin: false});

		const html = render(
			scene(
				['links:', '  leave: {to: Street, if: has_coin}'].join('\n'),
				LIST,
				QUIET_BEATS
			)
		);

		expect(markup(html)).toBe('');
		expect(payloadOf(html).drawLinks).toBe(false);
	});
});

/**
 * In a menu the order IS the content, and a map cannot carry it: an integer-like key sits
 * at the front of an object whatever position it was written in. So the names travel as a
 * list, and everything downstream reads the list.
 *
 * A numbered link name is the shape that breaks a map, and `Scene.links` is one too — the
 * order of `1`, `2`, `3` is gone before the modifier is called, upstream in the parser, and
 * the last test here pins that as a known limit rather than a passing claim.
 */
describe('entry order', () => {
	it('keeps the scene’s written order in the payload', () => {
		expect(payloadOf(render(scene(TWO_LINKS, QUIET_BEATS))).linkOrder).toEqual([
			'stay',
			'leave'
		]);
	});

	it('keeps an order the map cannot hold, across the encode', () => {
		const payload: StagePayload = {
			linkOrder: ['2', '10', '1'],
			links: {'2': 'Second Door', '10': 'Tenth Door', '1': 'First Door'},
			scene: payloadOf(render(scene(QUIET_BEATS))).scene
		};

		const decoded = payloadOf(
			`<sliders-stage scene="${encodePayload(payload)}"></sliders-stage>`
		);

		expect(decoded.linkOrder).toEqual(['2', '10', '1']);
		// The map lost it before JSON was even reached, which is the whole reason the list
		// is in the payload at all.
		expect(Object.keys(decoded.links ?? {})).toEqual(['1', '2', '10']);
	});

	it('draws in `linkOrder`, not in map order', () => {
		const payload: StagePayload = {
			linkOrder: ['2', '10', '1'],
			links: {'2': 'Second Door', '10': 'Tenth Door', '1': 'First Door'},
			scene: payloadOf(render(scene(QUIET_BEATS))).scene
		};

		expect(linkEntries(payload, payload.links ?? {}).map(e => e.name)).toEqual([
			'2',
			'10',
			'1'
		]);
	});

	it('emits the markup in the payload’s order', () => {
		expect(markup(render(scene(TWO_LINKS, QUIET_BEATS)))).toBe(
			'\n\n> [[stay->Tavern Fight]]\n> [[leave->Street]]\n'
		);
	});

	it.failing('cannot recover an order `Scene.links` already dropped', () => {
		// Numbered link names lose their order in the parser's own map, upstream of this
		// file. Nothing the modifier or the payload does can put it back; fixing it means
		// `Scene.links` carrying order. Pinned as failing so the day it is fixed, this
		// says so instead of staying quietly red.
		expect(
			payloadOf(
				render(
					scene(
						[
							'links:',
							'  2: Second Door',
							'  10: Tenth Door',
							'  1: First Door'
						].join('\n'),
						QUIET_BEATS
					)
				)
			).linkOrder
		).toEqual(['2', '10', '1']);
	});
});

describe('linkEntries', () => {
	function entriesFor(...blocks: string[]) {
		const payload = payloadOf(render(scene(...blocks, QUIET_BEATS)));

		return linkEntries(payload, payload.links ?? {});
	}

	it('carries each link’s target', () => {
		expect(entriesFor(TWO_LINKS, 'linkList: {}')).toEqual([
			{
				name: 'stay',
				to: 'Tavern Fight',
				icon: undefined,
				transition: undefined
			},
			{name: 'leave', to: 'Street', icon: undefined, transition: undefined}
		]);
	});

	it('gives every entry the block’s defaults, and lets an entry overrule them', () => {
		expect(
			entriesFor(
				[
					'links:',
					'  stay: {to: Tavern Fight, icon: chair}',
					'  leave: {to: Street, transition: slide}'
				].join('\n'),
				['linkList:', '  icon: door', '  transition: fade'].join('\n')
			)
		).toEqual([
			{name: 'stay', to: 'Tavern Fight', icon: 'chair', transition: 'fade'},
			{name: 'leave', to: 'Street', icon: 'door', transition: 'slide'}
		]);
	});

	it('skips a name whose link was gated off, rather than drawing a dead entry', () => {
		storyVars({has_coin: false});

		expect(
			entriesFor(
				[
					'links:',
					'  stay: Tavern Fight',
					'  leave: {to: Street, if: has_coin}'
				].join('\n'),
				'linkList: {}'
			).map(entry => entry.name)
		).toEqual(['stay']);
	});
});

describe('entity and beat if:', () => {
	const LANDING = [
		'props:',
		'  drone: {at: 0.2, if: passage.visits == 1}',
		'beats:',
		'  - drone: {say: ":-["}',
		'  - box: "Quiet here."',
		'  - {box: "Again?", if: not passage.visits == 1}'
	].join('\n');

	it('stages the gated entity and its beats on the first visit', () => {
		storyVars({'passage.visits': 1});

		const {scene} = payloadOf(render(LANDING));

		expect(Object.keys(scene.entities)).toEqual(['drone']);
		expect(scene.beats.map(beat => beat.kind)).toEqual(['say', 'box']);
	});

	it('leaves the entity, its beats and the first-visit beat out after that', () => {
		storyVars({'passage.visits': 2});

		const {scene} = payloadOf(render(LANDING));

		expect(scene.entities).toEqual({});
		expect(scene.beats.map(beat => [beat.index, beat.kind])).toEqual([
			[0, 'box'],
			[1, 'box']
		]);
	});

	it('reads a link condition with the same grammar', () => {
		storyVars({coins: 2});

		const {links} = payloadOf(
			render('links:\n  buy: {to: Shop, if: coins >= 3}\n  go: {to: Street, if: coins < 3}')
		);

		expect(links).toEqual({go: 'Street'});
	});
});
