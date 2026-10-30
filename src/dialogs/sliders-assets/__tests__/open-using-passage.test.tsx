import {fireEvent, render} from '@testing-library/react';
import * as React from 'react';
import {StoriesContext} from '../../../store/stories';
import type {Story} from '../../../store/stories';
import {fakeStory} from '../../../test-util';
import {DialogsContext} from '../../context';
import type {Dialog, DialogsState} from '../../dialogs.types';
import {PassageEditStack} from '../../passage-edit';
import {useOpenUsingPassage, usingPassageTarget} from '../open-using-passage';

jest.mock('../../passage-edit/passage-edit-stack');

/**
 * Ctrl/Cmd-click on a Library tile brings up a scene that uses the art -- but ONLY into a
 * passage editor that is already open. With none open the click must stay what it was.
 */

function story(): Story {
	const result = fakeStory(3);

	result.passages[0].name = 'intro';
	result.passages[1].name = 'cellar';
	result.passages[2].name = 'attic';
	return result;
}

function stack(
	storyId: string,
	passageIds: string[],
	collapsed = false
): Dialog {
	return {
		collapsed,
		component: PassageEditStack,
		highlighted: false,
		maximized: false,
		props: {passageIds, storyId}
	};
}

describe('usingPassageTarget', () => {
	it('does nothing when no passage editor is open', () => {
		const s = story();

		expect(usingPassageTarget([], s, ['cellar'])).toBeUndefined();
	});

	it("does nothing when the open editor is another story's", () => {
		const s = story();

		expect(
			usingPassageTarget([stack('other', ['x'])], s, ['cellar'])
		).toBeUndefined();
	});

	it('does nothing for art no scene uses', () => {
		const s = story();
		const dialogs = [stack(s.id, [s.passages[0].id])];

		expect(usingPassageTarget(dialogs, s, [])).toBeUndefined();
		expect(usingPassageTarget(dialogs, s, undefined)).toBeUndefined();
		expect(usingPassageTarget(dialogs, s, ['gone'])).toBeUndefined();
	});

	it('picks the first using passage when the front editor shows another', () => {
		const s = story();

		expect(
			usingPassageTarget([stack(s.id, [s.passages[0].id])], s, [
				'cellar',
				'attic'
			])
		).toBe(s.passages[1].id);
	});

	it('walks to the next one, wrapping, when the front editor already uses it', () => {
		const s = story();
		const using = ['cellar', 'attic'];

		expect(
			usingPassageTarget([stack(s.id, [s.passages[1].id])], s, using)
		).toBe(s.passages[2].id);
		expect(
			usingPassageTarget([stack(s.id, [s.passages[2].id])], s, using)
		).toBe(s.passages[1].id);
	});
});

describe('useOpenUsingPassage', () => {
	function renderTile(dialogs: DialogsState, usedIn: string[], s: Story) {
		const dispatch = jest.fn();
		const onClick = jest.fn();
		const Tile = () => {
			const open = useOpenUsingPassage();

			return (
				<div className="tile" onClickCapture={open(s.id, usedIn)}>
					<span className="art" onClick={onClick}>
						art
					</span>
					<div className="button-bar">
						<button onClick={onClick}>edit</button>
					</div>
				</div>
			);
		};

		render(
			<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [s]}}>
				<DialogsContext.Provider value={{dialogs, dispatch}}>
					<Tile />
				</DialogsContext.Provider>
			</StoriesContext.Provider>
		);

		return {dispatch, onClick};
	}

	it('raises the using passage in the open editor and swallows the click', () => {
		const s = story();
		const {dispatch, onClick} = renderTile(
			[stack(s.id, [s.passages[0].id])],
			['cellar'],
			s
		);

		fireEvent.click(document.querySelector('.art')!, {ctrlKey: true});
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(onClick).not.toHaveBeenCalled();
	});

	it('takes Cmd on a mac too', () => {
		const s = story();
		const {dispatch} = renderTile(
			[stack(s.id, [s.passages[0].id])],
			['cellar'],
			s
		);

		fireEvent.click(document.querySelector('.art')!, {metaKey: true});
		expect(dispatch).toHaveBeenCalledTimes(1);
	});

	it('expands a collapsed editor stack', () => {
		const s = story();
		const {dispatch} = renderTile(
			[stack(s.id, [s.passages[0].id], true)],
			['cellar'],
			s
		);

		fireEvent.click(document.querySelector('.art')!, {ctrlKey: true});
		expect(dispatch).toHaveBeenCalledWith({
			collapsed: false,
			index: 0,
			type: 'setDialogCollapsed'
		});
	});

	it('never opens an editor: with none open the click goes through untouched', () => {
		const s = story();
		const {dispatch, onClick} = renderTile([], ['cellar'], s);

		fireEvent.click(document.querySelector('.art')!, {ctrlKey: true});
		expect(dispatch).not.toHaveBeenCalled();
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('ignores a plain click and a Ctrl-click on the tile controls', () => {
		const s = story();
		const {dispatch, onClick} = renderTile(
			[stack(s.id, [s.passages[0].id])],
			['cellar'],
			s
		);

		fireEvent.click(document.querySelector('.art')!);
		fireEvent.click(document.querySelector('button')!, {ctrlKey: true});
		expect(dispatch).not.toHaveBeenCalled();
		expect(onClick).toHaveBeenCalledTimes(2);
	});
});
