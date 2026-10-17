import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {applyEdit, removeSceneKey, setSceneKey} from '@sliders/scene-edit';
import {parseScene} from '@sliders/scene-schema';
import type {Scene} from '@sliders/scene-types';
import {
	SceneLinksPanel,
	formatLinkList,
	formatLinks,
	inlineLinkTargets,
	uniqueLinkName
} from '../scene-links-panel';
import type {SceneKeyWrite} from '../use-scene-writer';

const K = 'dialogs.passageEdit.scenePreview.links';

/** The scene a block of YAML parses to. Parsed for real, so the shapes are the parser's. */
function scene(yaml: string): Scene {
	const parsed = parseScene(yaml);

	if (!parsed.scene) {
		throw new Error(`no scene: ${JSON.stringify(parsed.errors)}`);
	}

	return parsed.scene;
}

/** Apply the panel's writes to the YAML the way the writer does, and parse again. */
function applyWrites(yaml: string, writes: SceneKeyWrite[]): string {
	return writes.reduce((text, write) => {
		const edit =
			write.formatted === undefined
				? removeSceneKey(text, write.sceneKey)
				: setSceneKey(text, write.sceneKey, write.formatted);

		return edit ? applyEdit(text, edit) : text;
	}, yaml);
}

const BASE = `bg: cellar
links:
  stay: Tavern Fight
  leave: {to: Street, if: has_coin, icon: door}
beats:
  - box: "Stay or [[go->Street]]?"
`;

const PASSAGES = ['Tavern Fight', 'Street', 'Cellar'];

function renderPanel(
	yaml: string,
	extra: Partial<React.ComponentProps<typeof SceneLinksPanel>> = {}
) {
	const onWrite = jest.fn();
	const view = render(
		<SceneLinksPanel
			editable
			onWrite={onWrite}
			passageNames={PASSAGES}
			scene={scene(yaml)}
			{...extra}
		/>
	);

	/** The YAML after the last write, and what it parses back to. */
	const after = () => {
		const writes = onWrite.mock.calls[onWrite.mock.calls.length - 1][0];
		const text = applyWrites(yaml, writes);

		return {parsed: parseScene(text), text};
	};

	return {after, onWrite, view};
}

const row = (name: string) => screen.getByTestId(`scene-links-row-${name}`);

function commitText(input: HTMLElement, value: string) {
	fireEvent.change(input, {target: {value}});
	fireEvent.keyDown(input, {key: 'Enter'});
}

describe('formatting', () => {
	it('round-trips: parse, format, write, parse gives the same links', () => {
		const before = scene(BASE);
		const formatted = formatLinks(
			Object.values(before.links),
			inlineLinkTargets(before)
		);

		expect(formatted).toBe(
			'{stay: Tavern Fight, leave: {to: Street, if: has_coin, icon: door}}'
		);

		const text = applyWrites(BASE, [{formatted, sceneKey: 'links'}]);
		const again = parseScene(text);

		expect(again.errors).toEqual([]);
		expect(again.scene!.links).toEqual(before.links);
	});

	it('leaves an inline [[go->Street]] to the beat text', () => {
		const before = scene(BASE);

		expect(inlineLinkTargets(before)).toEqual(new Map([['go', 'Street']]));
		expect(before.links.go).toEqual({name: 'go', to: 'Street'});
		expect(
			formatLinks(Object.values(before.links), inlineLinkTargets(before))
		).not.toContain('go');
	});

	it('keeps an inline entry’s props, without a second copy of its target', () => {
		const links = [{icon: 'door', name: 'go', to: 'Street'}];

		expect(formatLinks(links, new Map([['go', 'Street']]))).toBe(
			'{go: {icon: door}}'
		);
		expect(formatLinks(links, new Map([['go', 'Street']]), true)).toBe(
			'{go: {to: Street, icon: door}}'
		);
	});

	it('removes the key when nothing is left', () => {
		expect(formatLinks([], new Map())).toBeUndefined();
	});

	it('quotes what YAML would misread', () => {
		const links = [
			{name: 'a, b', to: '4'},
			{name: 'yes', to: 'Cellar: Back'}
		];
		const formatted = formatLinks(links, new Map())!;
		const parsed = parseScene(`links: ${formatted}\n`);

		expect(parsed.errors).toEqual([]);
		expect(Object.values(parsed.scene!.links)).toEqual(links);
	});

	it('writes linkList in the spec’s order, {} for all defaults', () => {
		expect(formatLinkList({})).toBe('{}');
		expect(
			formatLinkList({
				as: 'parchment',
				at: {x: 0.5, y: 0.86},
				show: 'always',
				w: 0.8
			})
		).toBe('{at: [0.5, 0.86], w: 0.8, as: parchment, show: always}');

		const style = {
			as: 'parchment',
			at: {x: 0.5, y: 0.86},
			h: 0.2,
			icon: 'door',
			show: 'never' as const,
			transition: 'fade',
			w: 0.8
		};

		expect(
			parseScene(`linkList: ${formatLinkList(style)}\n`).scene!.linkList
		).toEqual(style);
	});

	it('finds a free name', () => {
		expect(uniqueLinkName('Street', ['Cellar'])).toBe('Street');
		expect(uniqueLinkName('Street', ['Street', 'Street 2'])).toBe('Street 3');
	});
});

describe('<SceneLinksPanel>', () => {
	it('renders nothing without a scene', () => {
		const {container} = render(
			<SceneLinksPanel
				editable
				onWrite={jest.fn()}
				passageNames={[]}
				scene={undefined}
			/>
		);

		expect(container).toBeEmptyDOMElement();
	});

	it('edits a label and parses back with the entry renamed, in place', () => {
		const {after} = renderPanel(BASE);

		commitText(
			within(row('stay')).getByRole('textbox', {name: `${K}.name`}),
			'fight'
		);

		const {parsed} = after();

		expect(parsed.errors).toEqual([]);
		expect(Object.keys(parsed.scene!.links)).toEqual(['fight', 'leave', 'go']);
		expect(parsed.scene!.links.fight.to).toBe('Tavern Fight');
	});

	it('refuses a rename onto a name that is taken', () => {
		const {onWrite} = renderPanel(BASE);

		commitText(
			within(row('stay')).getByRole('textbox', {name: `${K}.name`}),
			'leave'
		);
		expect(onWrite).not.toHaveBeenCalled();
	});

	it('edits a target on blur, and Escape reverts', () => {
		const {after, onWrite} = renderPanel(BASE);
		const to = within(row('stay')).getByRole('combobox', {name: `${K}.to`});

		fireEvent.change(to, {target: {value: 'Nowhere'}});
		fireEvent.keyDown(to, {key: 'Escape'});
		fireEvent.blur(to);
		expect(onWrite).not.toHaveBeenCalled();
		expect(to).toHaveValue('Tavern Fight');

		fireEvent.change(to, {target: {value: 'Cellar'}});
		fireEvent.blur(to);
		expect(after().parsed.scene!.links.stay).toEqual({
			name: 'stay',
			to: 'Cellar'
		});
	});

	it('sets and removes an if: on one entry', () => {
		const {after, onWrite, view} = renderPanel(BASE);

		commitText(
			within(row('stay')).getByRole('textbox', {name: `${K}.if`}),
			'brave'
		);
		expect(after().text).toContain('stay: {to: Tavern Fight, if: brave}');
		expect(after().parsed.scene!.links.stay.if).toBe('brave');

		view.unmount();
		onWrite.mockClear();

		const second = renderPanel(BASE);

		fireEvent.click(
			within(screen.getByTestId('scene-links-if-leave')).getByRole('button', {
				name: `${K}.reset`
			})
		);
		expect(second.after().parsed.scene!.links.leave).toEqual({
			icon: 'door',
			name: 'leave',
			to: 'Street'
		});
	});

	it('removes an entry', () => {
		const {after} = renderPanel(BASE);

		fireEvent.click(
			within(row('stay')).getByRole('button', {name: `${K}.remove`})
		);
		expect(Object.keys(after().parsed.scene!.links)).toEqual(['leave', 'go']);
	});

	it('cannot rename or remove a link the beat text names', () => {
		renderPanel(BASE);

		expect(
			within(row('go')).getByRole('textbox', {name: `${K}.name`})
		).toBeDisabled();
		expect(
			within(row('go')).getByRole('button', {name: `${K}.remove`})
		).toBeDisabled();
	});

	it('reorders, writing every entry out so the order holds', () => {
		const {after} = renderPanel(BASE);

		fireEvent.click(
			within(row('go')).getByRole('button', {name: `${K}.moveUp`})
		);

		const {parsed, text} = after();

		expect(text).toContain('go: Street');
		expect(Object.keys(parsed.scene!.links)).toEqual(['stay', 'go', 'leave']);
		expect(parsed.errors).toEqual([]);
	});

	it('adds a link to a real passage, named after it', () => {
		const {after} = renderPanel(BASE);

		fireEvent.click(screen.getByRole('button', {name: `${K}.add`}));

		const {parsed} = after();

		expect(parsed.errors).toEqual([]);
		expect(parsed.scene!.links['Tavern Fight']).toEqual({
			name: 'Tavern Fight',
			to: 'Tavern Fight'
		});
	});

	it('adds the first link to a scene with no links:', () => {
		const yaml = 'bg: cellar\n';
		const {after} = renderPanel(yaml);

		expect(screen.getAllByText(`${K}.none`)).toHaveLength(1);
		fireEvent.click(screen.getByRole('button', {name: `${K}.add`}));
		expect(after().text).toContain('links: {Tavern Fight: Tavern Fight}');
	});

	it('flags a missing target and offers to create it', () => {
		const onCreatePassage = jest.fn();
		const onOpenPassage = jest.fn();

		renderPanel(BASE.replace('Tavern Fight', 'Tavren Fight'), {
			onCreatePassage,
			onOpenPassage
		});

		const target = screen.getByTestId('scene-links-to-stay');

		expect(target).toHaveClass('scene-links-missing');
		expect(
			within(target).getByRole('img', {name: `${K}.missing`})
		).toBeTruthy();
		fireEvent.click(within(target).getByRole('button', {name: `${K}.create`}));
		expect(onCreatePassage).toHaveBeenCalledWith('Tavren Fight');

		const leave = screen.getByTestId('scene-links-to-leave');

		expect(leave).not.toHaveClass('scene-links-missing');
		fireEvent.click(within(leave).getByRole('button', {name: `${K}.open`}));
		expect(onOpenPassage).toHaveBeenCalledWith('Street');
	});

	it('matches targets case-insensitively, the way the player does', () => {
		renderPanel(BASE.replace('Tavern Fight', 'tavern fight'));
		expect(screen.getByTestId('scene-links-to-stay')).not.toHaveClass(
			'scene-links-missing'
		);
	});

	describe('linkList', () => {
		it('turns the on-stage list on as linkList: {} and off again', () => {
			const first = renderPanel(BASE);

			fireEvent.click(
				within(screen.getByTestId('scene-links-list-on-stage')).getByRole(
					'checkbox'
				)
			);
			expect(first.after().parsed.scene!.linkList).toEqual({});
			first.view.unmount();

			const yaml = `${BASE}linkList: {show: always}\n`;
			const second = renderPanel(yaml);

			fireEvent.click(
				within(screen.getByTestId('scene-links-list-on-stage')).getByRole(
					'checkbox'
				)
			);
			expect(second.after().parsed.scene!.linkList).toBeUndefined();
		});

		it('edits show and width, keeping the other keys', () => {
			const yaml = `${BASE}linkList: {as: parchment, show: always}\n`;
			const {after, onWrite} = renderPanel(yaml);

			fireEvent.change(
				within(screen.getByTestId('scene-links-list-show')).getByRole(
					'combobox'
				),
				{target: {value: 'never'}}
			);
			expect(after().parsed.scene!.linkList).toEqual({
				as: 'parchment',
				show: 'never'
			});

			onWrite.mockClear();
			commitText(
				within(screen.getByTestId('scene-links-list-w')).getByRole(
					'spinbutton'
				),
				'80'
			);
			// 80 is a percentage typed as a fraction: refused, as the parser would.
			expect(onWrite).not.toHaveBeenCalled();

			commitText(
				within(screen.getByTestId('scene-links-list-w')).getByRole(
					'spinbutton'
				),
				'0.8'
			);
			expect(after().parsed.scene!.linkList).toEqual({
				as: 'parchment',
				show: 'always',
				w: 0.8
			});
		});
	});

	it('read-only: a list, no controls', () => {
		renderPanel(BASE, {editable: false});

		expect(screen.queryByRole('textbox')).toBeNull();
		expect(row('leave')).toHaveTextContent('leave → Street if has_coin');
	});
});
