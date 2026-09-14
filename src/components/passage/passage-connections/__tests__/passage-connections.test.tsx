import {render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {fakePassage} from '../../../../test-util';
import {useFormatReferenceParser} from '../../../../store/use-format-reference-parser';
import {
	PassageConnections,
	PassageConnectionsProps
} from '../passage-connections';

jest.mock('../../../../store/use-format-reference-parser');
jest.mock('../broken-connection');
jest.mock('../link-markers');
jest.mock('../passage-connection');
jest.mock('../start-connection');

const referenceParserMock = useFormatReferenceParser as jest.Mock;

describe('<PassageConnections>', () => {
	function renderComponent(props?: Partial<PassageConnectionsProps>) {
		const passage = fakePassage();

		return render(
			<PassageConnections
				formatName=""
				formatVersion=""
				offset={{left: 0, top: 0}}
				passages={[passage]}
				startPassageId={passage.id}
				{...props}
			/>
		);
	}

	it('renders a <LinkMarkers>', () => {
		renderComponent();
		expect(screen.getByTestId('mock-link-markers')).toBeInTheDocument();
	});

	it('renders a <StartConnection> for the start passage', () => {
		const passage = fakePassage();

		renderComponent({passages: [passage], startPassageId: passage.id});
		expect(
			screen.getByTestId(`mock-start-connection-${passage.name}`)
		).toBeInTheDocument();
	});

	it('renders connections based on the built-in link parser', () => {
		const passages = [
			fakePassage({name: 'a', text: '[[b]]'}),
			fakePassage({name: 'b', text: ''})
		];

		renderComponent({passages, startPassageId: passages[0].id});
		expect(
			screen.getByTestId('mock-passage-connection-a-b')
		).toBeInTheDocument();
	});

	// A scene declares its choices in YAML, and they are links, not references.
	it("renders a connection for a scene's links: entry", () => {
		const passages = [
			fakePassage({name: 'a', text: '[scene]\nlinks:\n  on: b'}),
			fakePassage({name: 'b', text: ''})
		];

		renderComponent({passages, startPassageId: passages[0].id});
		expect(
			screen.getByTestId('mock-passage-connection-a-b')
		).toBeInTheDocument();
	});

	it('renders connections based on the story format reference parser, if it exists', () => {
		const passages = [
			fakePassage({name: 'a', text: ''}),
			fakePassage({name: 'b', text: ''})
		];

		referenceParserMock.mockReturnValue((text: string) =>
			text === '' ? [] : ['b']
		);
		passages[0].text = '{link to: "b"}';
		renderComponent({passages, startPassageId: passages[0].id});
		expect(
			screen.getByTestId('mock-passage-connection-a-b')
		).toBeInTheDocument();
	});

	// The format reports a scene's links: too, so both passes now find the same pair and
	// would stack two arrows with identical geometry on top of each other.
	it('draws a pair once when both parsers find it', () => {
		const passages = [
			fakePassage({name: 'a', text: '[scene]\nlinks:\n  on: b'}),
			fakePassage({name: 'b', text: ''})
		];

		referenceParserMock.mockReturnValue(() => ['b']);
		renderComponent({passages, startPassageId: passages[0].id});
		expect(screen.getAllByTestId('mock-passage-connection-a-b')).toHaveLength(
			1
		);
	});

	// Ghosts arrive here inside `passages`, so this pass finds the target by name and
	// draws a connector into it--no special case, and no stub, because the link is not
	// broken any more: it points at a card the author can see.
	it('draws a connection into a ghost, not a broken stub', () => {
		const passages = [
			fakePassage({name: 'a', text: '[[Cellar]]'}),
			fakePassage({name: 'Cellar', text: ''})
		];

		renderComponent({passages, startPassageId: passages[0].id});
		expect(
			screen.getByTestId('mock-passage-connection-a-Cellar')
		).toBeInTheDocument();
		expect(screen.queryByTestId('mock-broken-connection-a')).toBeNull();
	});

	// The other half of that: a name with no card of any kind behind it is still broken,
	// and the red stub is the only thing saying so.
	it('draws the broken stub for a link with no passage and no ghost', () => {
		const passages = [fakePassage({name: 'a', text: '[[Nowhere]]'})];

		renderComponent({passages, startPassageId: passages[0].id});
		expect(screen.getByTestId('mock-broken-connection-a')).toBeInTheDocument();
	});

	it('keeps a reference the link parser does not find', () => {
		const passages = [
			fakePassage({name: 'a', text: '[[b]]'}),
			fakePassage({name: 'b', text: ''}),
			fakePassage({name: 'c', text: ''})
		];

		referenceParserMock.mockReturnValue((text: string) =>
			text === '[[b]]' ? ['c'] : []
		);
		renderComponent({passages, startPassageId: passages[0].id});
		expect(
			screen.getByTestId('mock-passage-connection-a-b')
		).toBeInTheDocument();
		expect(
			screen.getByTestId('mock-passage-connection-a-c')
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
