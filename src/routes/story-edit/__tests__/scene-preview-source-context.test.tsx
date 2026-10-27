import {act, render, screen} from '@testing-library/react';
import * as React from 'react';
import {
	ScenePreviewSourceContext,
	ScenePreviewSourceProvider,
	useScenePreviewSource
} from '../scene-preview-source-context';
import type {SceneParse} from '../../../dialogs/passage-edit/scene-preview/use-scene-parse';

let registry: React.ContextType<typeof ScenePreviewSourceContext>;

const Probe: React.FC = () => {
	registry = React.useContext(ScenePreviewSourceContext);

	const source = useScenePreviewSource();

	return <div data-testid="source">{source?.passageId ?? 'none'}</div>;
};

describe('ScenePreviewSourceProvider', () => {
	beforeEach(() =>
		render(
			<ScenePreviewSourceProvider>
				<Probe />
			</ScenePreviewSourceProvider>
		)
	);

	const publish = (passageId: string) =>
		act(() =>
			registry.publish({
				parse: {} as SceneParse,
				passageId,
				storyId: 's'
			})
		);

	it('hands the stage to the map when a passage is picked there', () => {
		publish('a');
		expect(screen.getByTestId('source')).toHaveTextContent('a');
		act(() => registry.pickFromMap());
		expect(screen.getByTestId('source')).toHaveTextContent('none');
	});

	it('gives it back to an editor activated after the pick', () => {
		publish('a');
		act(() => registry.pickFromMap());
		act(() => registry.activate('a'));
		expect(screen.getByTestId('source')).toHaveTextContent('a');
	});

	it('gives it to an editor opened after the pick', () => {
		publish('a');
		act(() => registry.pickFromMap());
		publish('b');
		expect(screen.getByTestId('source')).toHaveTextContent('b');
	});
});
