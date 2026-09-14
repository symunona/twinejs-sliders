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

/**
 * A ghost is an ordinary `Passage`, so the map draws it with the ordinary card and
 * `passageConnections` resolves links into it without knowing ghosts exist. The same
 * trick `withSlidersManifests` plays for publishing: a synthetic passage handed to one
 * consumer.
 *
 * It must never reach `story.passages` — that array is the serialization boundary, walked
 * unfiltered by save, publish and sync. `story: ''` is the tripwire for that: every store
 * action looks its passage up by story id, so a ghost that got into one throws instead of
 * quietly writing a passage nobody created.
 */
function ghostPassage(
	name: string,
	position: {left: number; top: number}
): Passage {
	const defaults = passageDefaults();

	return {
		height: defaults.height,
		highlighted: false,
		id: `ghost-${name}`,
		left: position.left,
		name,
		selected: false,
		story: '',
		tags: [],
		text: '',
		top: position.top,
		width: defaults.width
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
 * A name linked from several passages is one ghost, placed by the first passage that
 * mentions it; the others need no record here, because the connector pass re-reads every
 * passage's text and finds the ghost by name like any other target.
 */
export function brokenLinkGhosts(story: Story): Passage[] {
	const existing = new Set(story.passages.map(passage => passage.name));
	const ghosts = new Map<string, Passage>();

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

	// Pass 2: place the ones this passage is first to ask for.

	let occupied = story.passages;

	for (const [passage, names] of wanted) {
		const fresh = names.filter(name => !ghosts.has(name));

		if (fresh.length === 0) {
			continue;
		}

		const positions = newPassagePositions(
			{...story, passages: occupied},
			passage,
			fresh.length
		);

		const placed = fresh.map((name, index) => {
			const ghost = ghostPassage(name, positions[index]);

			ghosts.set(name, ghost);
			return ghost;
		});

		occupied = [...occupied, ...placed];
	}

	return Array.from(ghosts.values());
}
