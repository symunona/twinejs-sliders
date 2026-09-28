import * as React from 'react';
import {Passage, passageConnections} from '../../../store/stories';
import {Point} from '../../../util/geometry';
import {PassageConnectionGroup} from './passage-connection-group';
import {LinkMarkers} from './link-markers';
import {StartConnection} from './start-connection';
import {subtractConnections} from './subtract-connections';
import {useFormatReferenceParser} from '../../../store/use-format-reference-parser';
import {passageDerivedFrom, passageLinks} from '../../../util/passage-links';

/**
 * The link pass. A scene's `links:` entries are links, not references — an author who
 * writes only scenes should see the same solid arrows and broken-link markers as one who
 * writes `[[…]]`. Module-level so it stays referentially stable across renders.
 */
const linkParser = (text: string) => passageLinks(text, true);

export interface PassageConnectionsProps {
	formatName: string;
	formatVersion: string;
	offset: Point;
	/**
	 * Everything with a rect on the map, ghosts included (`brokenLinkGhosts` makes those
	 * ordinary `Passage`s for exactly this reason). A link into a ghost therefore resolves
	 * here like any other target and is drawn as a connector; a name with no ghost behind
	 * it is what is left in `broken`, and keeps its red stub.
	 */
	passages: Passage[];
	startPassageId: string;
}

/**
 * Flips every edge. A scene's `from:` is written in the derived passage and names its base,
 * but the map draws it base -> derived: the arrow follows what the stage inherits from.
 */
function reverseConnections(
	connections: Map<Passage, Set<Passage>>
): Map<Passage, Set<Passage>> {
	const result = new Map<Passage, Set<Passage>>();

	for (const [start, ends] of connections) {
		for (const end of ends) {
			const reversed = result.get(end);

			if (reversed) {
				reversed.add(start);
			} else {
				result.set(end, new Set([start]));
			}
		}
	}

	return result;
}

const emptySet = new Set<Passage>();
const noOffset: Point = {left: 0, top: 0};

export const PassageConnections: React.FC<PassageConnectionsProps> = props => {
	const {formatName, formatVersion, offset, passages, startPassageId} = props;
	const referenceParser = useFormatReferenceParser(formatName, formatVersion);
	const {draggable: draggableLinks, fixed: fixedLinks} = React.useMemo(
		() => passageConnections(passages, linkParser),
		[passages]
	);
	const {
		draggable: draggableReferences,
		fixed: fixedReferences
	} = React.useMemo(() => passageConnections(passages, referenceParser), [
		passages,
		referenceParser
	]);

	// The format reports scene links too, so drop anything the link pass has already
	// drawn solid--see `subtract-connections`.
	const drawnLinks = React.useMemo(
		() => [draggableLinks.connections, fixedLinks.connections],
		[draggableLinks, fixedLinks]
	);
	const draggableReferenceConnections = React.useMemo(
		() => subtractConnections(draggableReferences.connections, drawnLinks),
		[draggableReferences, drawnLinks]
	);
	const fixedReferenceConnections = React.useMemo(
		() => subtractConnections(fixedReferences.connections, drawnLinks),
		[drawnLinks, fixedReferences]
	);

	// `from:` edges. A missing base is the scene lint's to report (`unknown-from`), not a
	// broken-link stub's, and a self-`from:` is a cycle the lint also reports — so only the
	// connections are drawn.
	const {draggable: draggableDerived, fixed: fixedDerived} = React.useMemo(
		() => passageConnections(passages, passageDerivedFrom),
		[passages]
	);
	const draggableDerivedConnections = React.useMemo(
		() => reverseConnections(draggableDerived.connections),
		[draggableDerived]
	);
	const fixedDerivedConnections = React.useMemo(
		() => reverseConnections(fixedDerived.connections),
		[fixedDerived]
	);

	const startPassage = React.useMemo(
		() => passages.find(passage => passage.id === startPassageId),
		[passages, startPassageId]
	);

	// References only show existing connections.

	return (
		<svg className="link-connectors">
			<LinkMarkers />
			{startPassage && (
				<StartConnection offset={offset} passage={startPassage} />
			)}
			<PassageConnectionGroup {...draggableLinks} offset={offset} />
			<PassageConnectionGroup {...fixedLinks} offset={noOffset} />
			<PassageConnectionGroup
				broken={emptySet}
				connections={draggableReferenceConnections}
				offset={offset}
				self={emptySet}
				variant="reference"
			/>
			<PassageConnectionGroup
				broken={emptySet}
				connections={fixedReferenceConnections}
				offset={noOffset}
				self={emptySet}
				variant="reference"
			/>
			<PassageConnectionGroup
				broken={emptySet}
				connections={draggableDerivedConnections}
				offset={offset}
				self={emptySet}
				variant="derived"
			/>
			<PassageConnectionGroup
				broken={emptySet}
				connections={fixedDerivedConnections}
				offset={noOffset}
				self={emptySet}
				variant="derived"
			/>
		</svg>
	);
};
