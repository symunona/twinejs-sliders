/**
 * The `</>` view over a registry Doc, with a REAL CodeMirror. Text, debounce and store sync
 * belong to the registry and are tested there against a real Doc
 * (store/passage-docs/__tests__). Here: focus, and the view sharing the Doc it shows.
 */

// The repo stubs `codemirror` for every other suite (src/__mocks__/codemirror.ts).
jest.unmock('codemirror');

import {act, render} from '@testing-library/react';
import * as React from 'react';
import {
	PassageDoc,
	usePassageDoc,
	usePassageDocRegistry
} from '../../../store/passage-docs';
import {useStoriesContext} from '../../../store/stories';
import {useFormatCodeMirrorMode} from '../../../store/use-format-codemirror-mode';
import {
	fakeLoadedStoryFormat,
	fakePassage,
	FakeStateProvider,
	fakeStory
} from '../../../test-util';
import {PassageText} from '../passage-text';

jest.mock('../../../store/use-codemirror-passage-hints');
jest.mock('../../../store/use-format-codemirror-mode');

/** CodeMirror measures text by range, and jsdom has none of that. */
beforeAll(() => {
	const empty = () => ({
		bottom: 0,
		height: 0,
		left: 0,
		right: 0,
		top: 0,
		width: 0
	});

	Range.prototype.getBoundingClientRect = empty as never;
	Range.prototype.getClientRects = (() => ({
		item: () => null,
		length: 0
	})) as never;
});

let held: PassageDoc | undefined;
let view: CodeMirror.Editor | undefined;

/** Holds the Doc itself, like the scene preview does, so it outlives the view. */
const Harness: React.FC<{open: boolean}> = ({open}) => {
	const {stories} = useStoriesContext();
	const story = stories[0];
	const handle = usePassageDoc(story.id, story.passages[0].id);

	usePassageDocRegistry();
	held = handle;

	return open && handle ? (
		<PassageText
			handle={handle}
			onEditorChange={editor => (view = editor)}
			passage={story.passages[0]}
			story={story}
			storyFormat={fakeLoadedStoryFormat()}
		/>
	) : null;
};

function renderHarness() {
	const story = fakeStory(1);

	story.passages[0] = fakePassage({...story.passages[0], text: 'line one'});

	const ui = (open: boolean) => (
		<FakeStateProvider stories={[story]}>
			<Harness open={open} />
		</FakeStateProvider>
	);
	const result = render(ui(true));

	return {...result, setOpen: (open: boolean) => result.rerender(ui(open))};
}

describe('<PassageText>', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		(useFormatCodeMirrorMode as jest.Mock).mockReturnValue(undefined);
		held = undefined;
		view = undefined;
	});

	afterEach(() => {
		// CodeMirror queues headless Doc events behind ONE module-level timeout.
		act(() => {
			jest.runOnlyPendingTimers();
		});
		jest.useRealTimers();
	});

	it('focuses the editor once the dialog has finished arriving', () => {
		renderHarness();
		expect(view).toBeDefined();
		expect(view!.hasFocus()).toBe(false);
		act(() => {
			jest.advanceTimersByTime(400);
		});
		expect(view!.hasFocus()).toBe(true);
	});

	it('shows and edits the registry Doc itself, so undo survives closing it', () => {
		const {setOpen} = renderHarness();

		expect(view!.getValue()).toBe('line one');
		expect(view!.getDoc()).toBe(held!.doc);
		act(() => {
			view!.replaceRange('typed ', {ch: 0, line: 0});
		});
		expect(held!.doc.getValue()).toBe('typed line one');

		setOpen(false);
		expect(view).toBeUndefined();
		// Headless now: the scene preview writing on its own.
		held!.doc.replaceRange('!', {ch: 14, line: 0}, undefined, '+drag');

		setOpen(true);
		expect(view!.getValue()).toBe('typed line one!');
		act(() => {
			view!.undo();
		});
		expect(view!.getValue()).toBe('typed line one');
		act(() => {
			view!.undo();
		});
		expect(view!.getValue()).toBe('line one');
	});
});
