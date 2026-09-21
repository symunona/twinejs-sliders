import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import {FakeStateProvider, StoryInspector, fakeStory} from '../../../test-util';
import {useSceneRefRename} from '../use-scene-ref-rename';

/**
 * Renaming art and carrying the scenes with it, through the real stories reducer.
 *
 * `renameSceneRefs` is tested on its own; what this pins is the dispatch around it: one
 * `updatePassages` for the lot, so the author's undo takes the whole rename back, and
 * nothing at all when no passage actually changes.
 */

function Harness(props: {newName: string; oldName: string}) {
	const rename = useSceneRefRename();
	const [count, setCount] = React.useState<number>();

	return (
		<>
			<button onClick={() => setCount(rename(props.oldName, props.newName))}>
				rename
			</button>
			<span data-testid="count">{count}</span>
			<StoryInspector />
		</>
	);
}

function scene(...lines: string[]) {
	return ['[scene]', ...lines].join('\n');
}

function renderHarness(passageTexts: string[], oldName = 'candle') {
	const story = fakeStory(passageTexts.length);

	story.passages.forEach((passage, index) => {
		passage.text = passageTexts[index];
	});

	render(
		<FakeStateProvider stories={[story]}>
			<Harness newName="lantern" oldName={oldName} />
		</FakeStateProvider>
	);

	return story;
}

describe('useSceneRefRename', () => {
	it('rewrites every scene that names the old art', async () => {
		const story = renderHarness([
			scene('bg: candle', 'beats:', '  - mira: "Hm."'),
			scene('props:', '  candle: {at: 0}'),
			'Just prose about a candle.'
		]);

		await userEvent.click(screen.getByRole('button', {name: 'rename'}));

		expect(screen.getByTestId(`passage-${story.passages[0].id}`)).toHaveTextContent(
			'bg: lantern'
		);
		expect(screen.getByTestId(`passage-${story.passages[1].id}`)).toHaveTextContent(
			'lantern: {at: 0}'
		);
		// Prose is not a reference. Nothing outside the block moves.
		expect(screen.getByTestId(`passage-${story.passages[2].id}`)).toHaveTextContent(
			'Just prose about a candle.'
		);
		expect(screen.getByTestId('count')).toHaveTextContent('2');
	});

	it('reports nothing when no scene writes the name', async () => {
		const story = renderHarness([scene('bg: tavern')]);

		await userEvent.click(screen.getByRole('button', {name: 'rename'}));
		expect(screen.getByTestId(`passage-${story.passages[0].id}`)).toHaveTextContent(
			'bg: tavern'
		);
		expect(screen.getByTestId('count')).toHaveTextContent('0');
	});
});
