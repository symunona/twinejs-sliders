import * as React from 'react';
import {Passage, passageConnections} from '../../../store/stories';
import {Point} from '../../../util/geometry';
import {PassageConnectionGroup} from './passage-connection-group';
import {LinkMarkers} from './link-markers';
import {StartConnection} from './start-connection';
import {subtractConnections} from './subtract-connections';
import {useFormatReferenceParser} from '../../../store/use-format-reference-parser';
import {
	GhostPassage,
	ghostAsPassage
} from '../../../util/broken-link-ghosts';
import {passageLinks} from '../../../util/passage-links';

/**
 * The link pass. A scene's `links:` entries are links, not references — an author who
 * writes only scenes should see the same solid arrows and broken-link markers as one who
 * writes `[[…]]`. Module-level so it stays referentially stable across renders.
 */
const linkParser = (text: string) => passageLinks(text, true);

export interface PassageConnectionsProps {
	formatName: string;
	formatVersion: string;
	/**
	 * Link targets the story has no passage for. Given these, the broken-link stubs are
	 * not drawn: a ghost is a real destination with a real connector into it, and the
	 * stub is the same information with nowhere to point.
	 */
	ghosts?: GhostPassage[];
	offset: Point;
	passages: Passage[];
	startPassageId: string;
}

const emptySet = new Set<Passage>();
const noOffset: Point = {left: 0, top: 0};

export const PassageConnections: React.FC<PassageConnectionsProps> = props => {
	const {
		formatName,
		formatVersion,
		ghosts,
		offset,
		passages,
		startPassageId
	} = props;
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

	const startPassage = React.useMemo(
		() => passages.find(passage => passage.id === startPassageId),
		[passages, startPassageId]
	);

	// One group is enough for every ghost connector: `PassageConnection` offsets only the
	// selected end, and a ghost is never selected, so an unselected source is simply
	// unmoved by the drag offset.
	const ghostConnections = React.useMemo(() => {
		const result = new Map<Passage, Set<Passage>>();

		for (const ghost of ghosts ?? []) {
			const end = ghostAsPassage(ghost);

			for (const start of ghost.linkedFrom) {
				const existing = result.get(start);

				if (existing) {
					existing.add(end);
				} else {
					result.set(start, new Set([end]));
				}
			}
		}

		return result;
	}, [ghosts]);

	// References only show existing connections.

	return (
		<svg className="link-connectors">
			<LinkMarkers />
			{startPassage && (
				<StartConnection offset={offset} passage={startPassage} />
			)}
			<PassageConnectionGroup
				{...draggableLinks}
				broken={ghosts ? emptySet : draggableLinks.broken}
				offset={offset}
			/>
			<PassageConnectionGroup
				{...fixedLinks}
				broken={ghosts ? emptySet : fixedLinks.broken}
				offset={noOffset}
			/>
			<PassageConnectionGroup
				broken={emptySet}
				connections={ghostConnections}
				offset={offset}
				self={emptySet}
				variant="reference"
			/>
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
		</svg>
	);
};
