import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {mergeEdits} from '@sliders/scene-edit';
import {extractSceneBlock} from '@sliders/scene-index';
import type {Stage} from '@sliders/scene-types';
import {parseSceneText} from '../use-scene-parse';
import {
	ObjectLinkPanel,
	entityHighlightWrites,
	entityLinkText,
	entityLinkWrites
} from '../object-link-panel';
import {SceneSidebar} from '../scene-sidebar';
import {buildWriteEdits, type EntityKeyWrite} from '../use-scene-writer';

const K = 'dialogs.passageEdit.scenePreview.objectLink';

const passage = [
	'[scene]',
	'cast:',
	'  mira: {at: -0.4}',
	'props:',
	'  door: {at: 0.3, link: Cellar, highlight: gold}',
	'  gate: {at: 0.1, link: {to: Yard, if: has_key}}',
	'  lamp: {at: 0.6}',
	'links:',
	'  escape: {to: Street, if: has_coin}',
	'beats:',
	'  - mira: "Hello."',
	'  - mira: "Bye."'
].join('\n');

function stageAt(text: string, beat: number): Stage {
	return parseSceneText(text).states[beat];
}

/** The passage after `writes`, made at scrubber `beat`, folded the way the editor does. */
function applied(text: string, beat: number, writes: EntityKeyWrite[]) {
	const block = extractSceneBlock(text)!;
	const scene = parseSceneText(text).result!.scene;
	const edit = mergeEdits(
		block.text,
		buildWriteEdits(
			{beat, blockOffset: block.offset, blockText: block.text, scene},
			writes
		)
	);

	expect(edit).toBeDefined();

	const next =
		block.text.slice(0, edit!.from) + edit!.insert + block.text.slice(edit!.to);

	return (
		text.slice(0, block.offset) +
		next +
		text.slice(block.offset + block.text.length)
	);
}

describe('entityLinkWrites()', () => {
	const stage = stageAt(passage, 0);

	it('points link: at a passage, reset null for a beat', () => {
		expect(entityLinkWrites(stage.entities.lamp, 'Cellar')).toEqual([
			{
				id: 'lamp',
				key: 'link',
				kind: 'prop',
				ref: 'lamp',
				reset: null,
				value: 'Cellar'
			}
		]);
	});

	it('writes the entry line at beat 0', () => {
		const text = applied(
			passage,
			0,
			entityLinkWrites(stage.entities.lamp, 'escape')
		);

		expect(text).toContain('lamp: {at: 0.6, link: escape}');
		expect(stageAt(text, 0).entities.lamp.link).toEqual(
			expect.objectContaining({name: 'escape', to: 'Street'})
		);
	});

	it('clearing at beat 0 removes the key', () => {
		const text = applied(
			passage,
			0,
			entityLinkWrites(stage.entities.door, undefined)
		);

		expect(text).toContain('door: {at: 0.3, highlight: gold}');
		expect(stageAt(text, 0).entities.door.link).toBeUndefined();
	});

	it('clearing on a beat writes link: ~, since later beats inherit', () => {
		const beat = stageAt(passage, 2);
		const text = applied(
			passage,
			2,
			entityLinkWrites(beat.entities.door, undefined)
		);

		expect(text).toMatch(/door: \{link: ~\}/);
		expect(stageAt(text, 0).entities.door.link).toEqual(
			expect.objectContaining({to: 'Cellar'})
		);
		expect(stageAt(text, 2).entities.door.link).toBeUndefined();
	});

	it("keeps a direct link's own if: across a new target", () => {
		expect(entityLinkWrites(stage.entities.gate, 'Street')[0].value).toEqual({
			if: 'has_key',
			to: 'Street'
		});
	});

	it('nothing selected writes nothing', () => {
		expect(entityLinkWrites(undefined, 'Cellar')).toEqual([]);
	});
});

describe('entityHighlightWrites()', () => {
	const stage = stageAt(passage, 0);

	it('sets a colour, trimmed', () => {
		const text = applied(
			passage,
			0,
			entityHighlightWrites(stage.entities.door, ' #ff0000 ')
		);

		expect(stageAt(text, 0).entities.door.highlight).toBe('#ff0000');
	});

	it('empty clears; on a beat that is highlight: ~', () => {
		const writes = entityHighlightWrites(stage.entities.door, '');

		expect(writes[0]).toEqual(
			expect.objectContaining({reset: null, value: undefined})
		);
		expect(applied(passage, 2, writes)).toMatch(/door: \{highlight: ~\}/);
	});
});

describe('entityLinkText()', () => {
	const stage = stageAt(passage, 0);

	it('is the links: entry name, else the passage, else empty', () => {
		expect(entityLinkText(stage.entities.door)).toBe('Cellar');
		expect(entityLinkText(stage.entities.lamp)).toBe('');
	});
});

describe('<ObjectLinkPanel>', () => {
	const parse = parseSceneText(passage);
	const stage = parse.states[0];

	function renderPanel(
		extra: Partial<React.ComponentProps<typeof ObjectLinkPanel>> = {}
	) {
		const onWrite = jest.fn();

		render(
			<ObjectLinkPanel
				beat={0}
				editable
				entities={[stage.entities.door]}
				onWrite={onWrite}
				passageNames={['Cellar', 'Street', 'Yard']}
				scene={parse.result!.scene}
				{...extra}
			/>
		);

		return {onWrite};
	}

	it('says whose link it is, and that scene links are elsewhere', () => {
		const onShowSceneLinks = jest.fn();

		renderPanel({onShowSceneLinks});

		const panel = screen.getByTestId('object-link-panel');

		// i18n returns keys under jest: the header is the title key, not "Links".
		expect(within(panel).getByText(`${K}.title`)).toBeInTheDocument();
		expect(within(panel).getByText(`${K}.sceneHint`)).toBeInTheDocument();
		fireEvent.click(
			within(panel).getByRole('button', {name: `${K}.showScene`})
		);
		expect(onShowSceneLinks).toHaveBeenCalled();
	});

	it('retargets through the text box', () => {
		const {onWrite} = renderPanel();
		const input = within(screen.getByTestId('object-link-target')).getByRole(
			'combobox'
		);

		expect(input).toHaveValue('Cellar');
		fireEvent.change(input, {target: {value: 'Street'}});
		fireEvent.keyDown(input, {key: 'Enter'});
		expect(onWrite).toHaveBeenCalledWith(
			entityLinkWrites(stage.entities.door, 'Street')
		);
	});

	it('the X stops the link', () => {
		const {onWrite} = renderPanel();

		fireEvent.click(screen.getByRole('button', {name: `${K}.clear`}));
		expect(onWrite).toHaveBeenCalledWith(
			entityLinkWrites(stage.entities.door, undefined)
		);
	});

	it('highlight row only while linked', () => {
		renderPanel();
		expect(screen.getByTestId('object-link-highlight')).toBeInTheDocument();
	});

	it('no link: scenery note, no highlight row', () => {
		renderPanel({entities: [stage.entities.lamp]});
		expect(screen.getByText(`${K}.scenery`)).toBeInTheDocument();
		expect(screen.queryByTestId('object-link-highlight')).toBeNull();
	});

	it('a missing passage offers to create it', () => {
		const onCreatePassage = jest.fn();

		renderPanel({onCreatePassage, passageNames: ['Street']});
		fireEvent.click(screen.getByRole('button', {name: `${K}.create`}));
		expect(onCreatePassage).toHaveBeenCalledWith('Cellar');
	});

	it('a links: entry says where it leads', () => {
		const text = applied(
			passage,
			0,
			entityLinkWrites(stage.entities.lamp, 'escape')
		);
		const next = parseSceneText(text);

		renderPanel({
			entities: [next.states[0].entities.lamp],
			scene: next.result!.scene
		});
		expect(screen.getByTestId('object-link-entry')).toHaveTextContent(
			`${K}.viaEntryIf`
		);
	});

	it('multi-selection: single only, no controls', () => {
		renderPanel({entities: [stage.entities.door, stage.entities.lamp]});
		expect(screen.getByText(`${K}.singleOnly`)).toBeInTheDocument();
		expect(screen.queryByTestId('object-link-target')).toBeNull();
	});
});

describe('<SceneSidebar> accent', () => {
	it('wraps an accented handle so it can be recoloured', () => {
		render(
			<SceneSidebar
				active="links"
				onActive={jest.fn()}
				onOpenChange={jest.fn()}
				open
				tabs={[
					{
						accent: 'object',
						content: 'x',
						icon: null,
						id: 'links',
						label: 'Object link'
					}
				]}
			/>
		);

		expect(screen.getByTestId('scene-sidebar-tab-links')).toHaveAttribute(
			'data-accent',
			'object'
		);
	});
});
