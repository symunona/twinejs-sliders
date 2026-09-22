import {act, fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {Command, HotkeysContext, useHotkeysContext} from '../../../hotkeys';
import {useStoriesContext} from '../../../store/stories';
import {
	fakeLoadedStoryFormat,
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory
} from '../../../test-util';
import {PassageEditStack} from '../passage-edit-stack';

// The passage editor's two scene keys, pressed where they are actually pressed: with
// the cursor in the scene text.
//
// Regression: both were registered by <StoryFormatToolbar>, which renders only when
// three preferences line up. With the toolbar hidden nothing registered the command and
// the key was dead--not only in the text, everywhere. They are registered by
// <PassageEditContents> now; the toolbar just shows buttons for them.

jest.mock('../../../components/control/code-area/code-area');
jest.mock('../../../components/tag/tag-grid');
jest.mock('../../../components/visible-whitespace/visible-whitespace');

/**
 * Commands registered below this, minus the ones already unregistered. The provider
 * keeps its own list in a ref that nothing outside it can read, so this wraps
 * `registerCommand` on the way past instead.
 */
const live = new Set<React.RefObject<Command>>();

function liveCount(id: string) {
	return [...live].filter(command => command.current?.id === id).length;
}

const WatchRegistrations: React.FC = ({children}) => {
	const parent = useHotkeysContext();
	const value = React.useMemo(
		() => ({
			...parent,
			registerCommand: (command: React.RefObject<Command>) => {
				live.add(command);

				const unregister = parent.registerCommand(command);

				return () => {
					live.delete(command);
					unregister();
				};
			}
		}),
		[parent]
	);

	return (
		<HotkeysContext.Provider value={value}>{children}</HotkeysContext.Provider>
	);
};

const TestStack: React.FC = () => {
	const {stories} = useStoriesContext();

	return (
		<PassageEditStack
			collapsed={false}
			onChangeCollapsed={jest.fn()}
			onChangeHighlighted={jest.fn()}
			onChangeMaximized={jest.fn()}
			onChangeProps={jest.fn()}
			onClose={jest.fn()}
			passageIds={stories[0].passages.map(({id}) => id)}
			storyId={stories[0].id}
		/>
	);
};

describe('passage editor scene shortcuts', () => {
	function stateWith(
		prefs?: FakeStateProviderProps['prefs'],
		passageCount = 1
	): FakeStateProviderProps {
		const story = fakeStory(passageCount);

		return {
			prefs: {passageEditorToolbars: true, useCodeMirror: true, ...prefs},
			stories: [story],
			storyFormats: [
				fakeLoadedStoryFormat({
					name: story.storyFormat,
					version: story.storyFormatVersion
				})
			]
		};
	}

	async function renderComponent(context: FakeStateProviderProps) {
		const result = render(
			<FakeStateProvider {...context}>
				<WatchRegistrations>
					<TestStack />
				</WatchRegistrations>
			</FakeStateProvider>
		);

		await act(async () => Promise.resolve());
		return result;
	}

	/**
	 * Focuses the editor's text entry, the way an author who is writing a scene has it,
	 * and presses a chord there.
	 */
	async function pressInPassageText(key: string) {
		// eslint-disable-next-line testing-library/no-node-access
		const textEntry = document.querySelector('textarea');

		expect(textEntry).not.toBeNull();
		textEntry!.focus();
		expect(document.activeElement).toBe(textEntry);
		fireEvent.keyDown(document.activeElement!, {altKey: true, key});
		await act(async () => Promise.resolve());
	}

	beforeEach(() => live.clear());

	it('opens the asset manager with alt+a while the cursor is in the scene text', async () => {
		await renderComponent(stateWith());
		await pressInPassageText('a');
		expect(screen.getByText('dialogs.slidersAssets.title')).toBeInTheDocument();
	});

	it('opens the scene editor with alt+p while the cursor is in the scene text', async () => {
		await renderComponent(stateWith());
		await pressInPassageText('p');
		expect(
			screen.getByText('dialogs.passageEdit.scenePreview.title')
		).toBeInTheDocument();
	});

	it('opens the asset manager with the editor toolbars hidden', async () => {
		await renderComponent(stateWith({passageEditorToolbars: false}));
		expect(
			screen.queryByText('routes.storyEdit.toolbar.slidersAssets')
		).not.toBeInTheDocument();
		await pressInPassageText('a');
		expect(screen.getByText('dialogs.slidersAssets.title')).toBeInTheDocument();
	});

	it('opens the scene editor with the editor toolbars hidden', async () => {
		await renderComponent(stateWith({passageEditorToolbars: false}));
		await pressInPassageText('p');
		expect(
			screen.getByText('dialogs.passageEdit.scenePreview.title')
		).toBeInTheDocument();
	});

	// The format toolbar is the only thing that ever showed these buttons, and it needs
	// CodeMirror. The keys don't.

	it('opens the asset manager without CodeMirror', async () => {
		await renderComponent(stateWith({useCodeMirror: false}));
		await pressInPassageText('a');
		expect(screen.getByText('dialogs.slidersAssets.title')).toBeInTheDocument();
	});

	// Two registrations of one ID both answer the key, and which one runs is registration
	// order. Every card in the stack renders the editor contents, and the visible toolbar
	// has buttons for the same two commands, so both are chances to register twice.

	it('registers each scene command once with the toolbars showing', async () => {
		await renderComponent(stateWith(undefined, 3));
		expect(liveCount('scene.assets')).toBe(1);
		expect(liveCount('scene.edit')).toBe(1);
	});

	it('registers each scene command once with the toolbars hidden', async () => {
		await renderComponent(stateWith({passageEditorToolbars: false}, 3));
		expect(liveCount('scene.assets')).toBe(1);
		expect(liveCount('scene.edit')).toBe(1);
	});
});
