import {act, render} from '@testing-library/react';
import * as React from 'react';
import {useVoiceToolEnv} from '../use-voice-tool-env';
import type {VoiceToolEnv} from '../voice.types';
import {FakeStateProvider, StoryInspector} from '../../test-util';
import {useUndoableStoriesContext} from '../../store/undoable-stories';

/**
 * The env must be ONE object for the life of the panel.
 *
 * `useVoiceSession` builds the tool runner once — its `seen` set is the session's
 * read-before-write gate, and rebuilding it would re-arm every write. So the runner holds
 * whatever env it was handed at mount, and that env has to keep reaching the live editor.
 *
 * The crash this guards: `UndoableStoriesContextProvider` memoises its dispatch on the
 * stories state, and that dispatch computes each change's REVERSE action against the state
 * it closed over. An env that captured the mount-time dispatch therefore undoes against
 * the story as it was then — create a passage, write to it, and `reverseAction` looks up a
 * passage its snapshot never saw and throws through the error boundary.
 */
const seen: VoiceToolEnv[] = [];

const Probe: React.FC = () => {
	const {stories} = useUndoableStoriesContext();
	const env = useVoiceToolEnv({
		getCenter: () => ({left: 0, top: 0}),
		setCenter: () => {},
		story: stories[0]
	});

	seen.push(env);

	return <div data-testid="passage-count">{stories[0].passages.length}</div>;
};

describe('useVoiceToolEnv', () => {
	beforeEach(() => {
		seen.length = 0;
	});

	it('keeps working through the env captured at mount, after the story moves', () => {
		render(
			<FakeStateProvider>
				<Probe />
				<StoryInspector />
			</FakeStateProvider>
		);

		expect(seen.length).toBeGreaterThan(0);

		// The object the runner would have captured. Identity is NOT the invariant —
		// `setCenter` changes whenever a dialog opens, so the env is rebuilt during an
		// ordinary session. What must hold is that the OLD one still reaches the editor.
		const first = seen[0];

		act(() => {
			first.createPassage('Cellar', 'Dark.', [10, 10]);
		});

		expect(seen.length).toBeGreaterThan(1);
		expect(first.story().passages.map(passage => passage.name)).toContain('Cellar');

		// And again, now that the env has certainly been rebuilt behind it.
		act(() => {
			first.createPassage('Attic', 'Dusty.', [20, 20]);
		});

		expect(first.story().passages.map(passage => passage.name)).toContain('Attic');
	});

	it('sees the passage it just created through the SAME env object', () => {
		render(
			<FakeStateProvider>
				<Probe />
			</FakeStateProvider>
		);

		const env = seen[0];

		act(() => {
			env.createPassage('Cellar', 'Dark.', [10, 10]);
		});

		expect(env.story().passages.map(passage => passage.name)).toContain('Cellar');
	});

	it('writes through an env captured before several re-renders', () => {
		render(
			<FakeStateProvider>
				<Probe />
			</FakeStateProvider>
		);

		const env = seen[0];
		let id = '';

		act(() => {
			id = env.createPassage('Cellar', 'Dark.', [10, 10]);
		});

		act(() => {
			env.createPassage('Attic', 'Dusty.', [20, 20]);
		});

		act(() => {
			env.renamePassage(id, 'Deep Cellar');
		});

		expect(
			env.story().passages.find(passage => passage.id === id)?.name
		).toBe('Deep Cellar');
	});

	it('can write to a passage it created, which is what used to crash', () => {
		render(
			<FakeStateProvider>
				<Probe />
			</FakeStateProvider>
		);

		const env = seen[0];
		let id = '';

		act(() => {
			id = env.createPassage('Cellar', 'Dark.', [10, 10]);
		});

		// The throw was inside `reverseAction`, reached through the undoable dispatch —
		// so the assertion is simply that this does not throw.
		expect(() =>
			act(() => {
				env.writePassage(id, 'Darker.');
			})
		).not.toThrow();
		expect(
			env.story().passages.find(passage => passage.id === id)?.text
		).toBe('Darker.');
	});

	it('creates the passage with the id it hands back', () => {
		render(
			<FakeStateProvider>
				<Probe />
			</FakeStateProvider>
		);

		const env = seen[0];
		let id = '';

		act(() => {
			id = env.createPassage('Cellar', 'Dark.', [10, 10]);
		});

		// The reducer mints its own id when `props.id` is absent, so a caller that read
		// the id off the action got `undefined` and every later call missed.
		expect(id).toBeTruthy();
		expect(env.story().passages.some(passage => passage.id === id)).toBe(true);
	});
});
