/**
 * Placeholders on the story map for links that point at a passage the story does not
 * have yet.
 *
 * A `[[…]]` link creates its target the moment the author closes the brackets, so core
 * Twine only ever sees a broken link after a passage is deleted, and draws it as a stub
 * with a red marker on the end. A scene's `links:` entry cannot work that way — `to: Tav`
 * is complete YAML on every keystroke, so auto-creating would spawn a passage per
 * character typed (see `createNewlyLinkedPassages`).
 *
 * A ghost is the middle ground: the target is drawn where the passage would go, dashed
 * and unwritten, and one click makes it real. Nothing is stored until then, so a
 * half-typed name costs a rerender rather than a passage and an undo entry.
 */

import {Passage, Story} from '../store/stories';
import {newPassagePositions} from '../store/stories/action-creators/new-passage-positions';
import {passageDefaults} from '../store/stories/defaults';
import {passageLinks} from './passage-links';

export interface GhostPassage {
	height: number;
	left: number;
	/** The passages linking here. Every one of them gets a connector drawn. */
	linkedFrom: Passage[];
	/** The name the author wrote, and the name the passage will be created under. */
	name: string;
	top: number;
	width: number;
}

/** Enough of a passage for the connector geometry, which only reads a rect. */
export function ghostAsPassage(ghost: GhostPassage): Passage {
	return {
		height: ghost.height,
		highlighted: false,
		id: `ghost-${ghost.name}`,
		left: ghost.left,
		name: ghost.name,
		selected: false,
		story: '',
		tags: [],
		text: '',
		top: ghost.top,
		width: ghost.width
	};
}

/**
 * Every missing link target in the story, positioned.
 *
 * Ghosts are laid out with `newPassagePositions`, the same function that places a
 * passage created from a link, so clicking one does not make it jump: it is created at
 * exactly the rect it was drawn at. Ghosts already placed are fed back in as occupied
 * space, or two passages linking to two different missing names would stack their rows
 * on top of each other.
 *
 * A name linked from several passages is one ghost, owned by the first passage that
 * mentions it; the others just draw a connector to it.
 */
export function brokenLinkGhosts(story: Story): GhostPassage[] {
	const existing = new Set(story.passages.map(passage => passage.name));
	const ghosts = new Map<string, GhostPassage>();
	const defaults = passageDefaults();

	// Pass 1: who links to what, in passage order, skipping names that exist.

	const wanted = new Map<Passage, string[]>();

	for (const passage of story.passages) {
		const missing = passageLinks(passage.text, true).filter(
			name => name !== passage.name && !existing.has(name)
		);

		if (missing.length > 0) {
			wanted.set(passage, missing);
		}
	}

	// Pass 2: place the ones this passage is first to ask for, then note the rest as
	// extra connectors into a ghost someone else owns.

	let occupied = story.passages;

	for (const [passage, names] of wanted) {
		const fresh = names.filter(name => !ghosts.has(name));

		for (const name of names) {
			ghosts.get(name)?.linkedFrom.push(passage);
		}

		if (fresh.length === 0) {
			continue;
		}

		const positions = newPassagePositions(
			{...story, passages: occupied},
			passage,
			fresh.length
		);

		const placed = fresh.map((name, index) => {
			const ghost: GhostPassage = {
				...positions[index],
				height: defaults.height,
				linkedFrom: [passage],
				name,
				width: defaults.width
			};

			ghosts.set(name, ghost);
			return ghost;
		});

		occupied = [...occupied, ...placed.map(ghostAsPassage)];
	}

	return Array.from(ghosts.values());
}
