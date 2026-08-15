import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {FakeStateProvider} from '../../../test-util';
import {readAssetDragData} from '../../passage-edit/scene-preview/asset-drag';
import {AssetTile} from '../asset-tile';
import {CharacterTile} from '../character-tile';

/**
 * What a tile puts on the clipboard-of-the-drag.
 *
 * The rule being pinned here is the one that is easy to get wrong and impossible to see:
 * scene YAML addresses assets by NAME, so an `a_8f21` in the payload would produce a
 * perfectly valid drop that renders as a missing asset the moment anyone reads the file.
 */

function meta(overrides: Partial<AssetMeta> = {}): AssetMeta {
	return {
		animated: false,
		bytes: 100,
		h: 100,
		hash: 'hash',
		id: 'a_8f21',
		kind: 'object',
		mime: 'image/png',
		name: 'props/candle',
		tags: [],
		w: 100,
		...overrides
	};
}

function character(): Character {
	return {
		anchors: {},
		frames: {idle: {asset: 'a_0001'}},
		id: 'mira',
		name: 'Mira Vale',
		origin: {x: 0.5, y: 1},
		size: {w: 1, h: 2},
		tags: []
	};
}

function fakeTransfer() {
	const data: Record<string, string> = {};

	return {
		effectAllowed: 'none',
		getData: (type: string) => data[type] ?? '',
		setData: (type: string, value: string) => {
			data[type] = value;
		},
		get types() {
			return Object.keys(data);
		}
	} as unknown as DataTransfer;
}

function drag(tile: Element) {
	const dataTransfer = fakeTransfer();
	const event = new MouseEvent('dragstart', {bubbles: true});

	Object.defineProperty(event, 'dataTransfer', {value: dataTransfer});
	fireEvent(tile, event);

	return dataTransfer;
}

function tile(selector: string) {
	return document.querySelector(selector)!;
}

describe('dragging a tile onto the stage', () => {
	it('sends an object asset as a prop, by name', () => {
		render(
			<FakeStateProvider>
				<AssetTile
					meta={meta()}
					onChangeTags={jest.fn()}
					onDelete={jest.fn()}
					onEdit={jest.fn()}
				/>
			</FakeStateProvider>
		);

		expect(readAssetDragData(drag(tile('.sliders-tile')))).toEqual({
			label: 'props/candle',
			ref: 'props/candle',
			target: 'prop'
		});
	});

	it('sends a background as bg:', () => {
		render(
			<FakeStateProvider>
				<AssetTile
					meta={meta({kind: 'bg', name: 'tavern/night'})}
					onChangeTags={jest.fn()}
					onDelete={jest.fn()}
					onEdit={jest.fn()}
				/>
			</FakeStateProvider>
		);

		expect(readAssetDragData(drag(tile('.sliders-tile')))?.target).toBe('bg');
	});

	it('leaves an fx asset undraggable — there is nowhere on the stage for it', () => {
		render(
			<FakeStateProvider>
				<AssetTile
					meta={meta({kind: 'fx', name: 'rain'})}
					onChangeTags={jest.fn()}
					onDelete={jest.fn()}
					onEdit={jest.fn()}
				/>
			</FakeStateProvider>
		);

		expect(tile('.sliders-tile').getAttribute('draggable')).toBe('false');
	});

	it('sends a character as cast, addressed by its id rather than its name', () => {
		render(
			<FakeStateProvider>
				<CharacterTile
					character={character()}
					onDelete={jest.fn()}
					onEdit={jest.fn()}
				/>
			</FakeStateProvider>
		);

		expect(readAssetDragData(drag(tile('.sliders-tile')))).toEqual({
			label: 'Mira Vale',
			ref: 'mira',
			target: 'cast'
		});
		// The name is a label; `ref` is what `character()` resolves.
		expect(screen.getByText('Mira Vale')).toBeInTheDocument();
	});
});
