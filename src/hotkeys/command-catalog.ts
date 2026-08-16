import {defaultKeymap} from './default-keymap';

export interface CatalogEntry {
	id: string;
	scope: string;
	/**
	 * Marks a command whose `enabled` state is tied to a condition it shares with the
	 * other members of the group--and which is FALSE for every other group at the same
	 * time.
	 *
	 * Two commands in different groups may therefore share a key without being
	 * ambiguous: the dispatcher skips disabled commands before it looks at bindings, so
	 * exactly one of them can ever fire. The scene preview's arrow keys are the case
	 * this exists for--they scrub beats with nothing selected and nudge the selection
	 * otherwise, and there is no third key that means "move this thing".
	 *
	 * Commands in the SAME group are still checked against each other, because they are
	 * enabled together.
	 */
	enabledGroup?: string;
}

/**
 * May these two commands share a key? Only when a condition guarantees that at most one
 * of them is enabled at a time.
 */
export function exclusivelyEnabled(
	catalog: CatalogEntry[],
	commandIds: string[]
): boolean {
	const groups = commandIds.map(
		id => catalog.find(entry => entry.id === id)?.enabledGroup
	);

	return (
		groups.every(group => group !== undefined) &&
		new Set(groups).size === groups.length
	);
}

/**
 * Every command the app knows about, and the scope it belongs to.
 *
 * The dispatcher doesn't need this--it works off whatever components have
 * registered. The shortcuts dialog does, because it has to list commands whose
 * components aren't mounted right now: you can't see the story map's shortcuts
 * from the story list otherwise.
 *
 * Labels are looked up as `hotkeys.commands.<id>`.
 */
export const commandCatalog: CatalogEntry[] = [
	{id: 'app.preferences', scope: 'global'},
	{id: 'app.keyboardShortcuts', scope: 'global'},

	{id: 'story.create', scope: 'story-list'},
	{id: 'story.edit', scope: 'story-list'},
	{id: 'story.rename', scope: 'story-list'},
	{id: 'story.delete', scope: 'story-list'},
	{id: 'story.duplicate', scope: 'story-list'},
	{id: 'story.tag', scope: 'story-list'},
	{id: 'library.import', scope: 'story-list'},
	{id: 'library.archive', scope: 'story-list'},
	{id: 'library.storyTags', scope: 'story-list'},

	{id: 'passage.create', scope: 'story-map'},
	{id: 'passage.edit', scope: 'story-map'},
	{id: 'passage.rename', scope: 'story-map'},
	{id: 'passage.delete', scope: 'story-map'},
	{id: 'passage.test', scope: 'story-map'},
	{id: 'passage.startAt', scope: 'story-map'},
	{id: 'passage.goTo', scope: 'story-map'},
	{id: 'passage.selectAll', scope: 'story-map'},
	{id: 'passage.deselectAll', scope: 'story-map'},
	{id: 'story.undo', scope: 'story-map'},
	{id: 'story.redo', scope: 'story-map'},
	{id: 'story.findReplace', scope: 'story-map'},
	{id: 'story.details', scope: 'story-map'},
	{id: 'story.passageTags', scope: 'story-map'},
	{id: 'story.javascript', scope: 'story-map'},
	{id: 'story.stylesheet', scope: 'story-map'},
	{id: 'view.zoomIn', scope: 'story-map'},
	{id: 'view.zoomOut', scope: 'story-map'},
	{id: 'view.zoomReset', scope: 'story-map'},

	{id: 'build.play', scope: 'story-map'},
	{id: 'build.test', scope: 'story-map'},
	{id: 'build.proof', scope: 'story-map'},
	{id: 'build.publishToFile', scope: 'story-map'},
	{id: 'build.exportAsTwee', scope: 'story-map'},

	{id: 'sliders.assets', scope: 'story-map'},
	{id: 'sliders.characters', scope: 'story-map'},
	{id: 'sliders.generator', scope: 'story-map'},

	{id: 'passage.rename', scope: 'dialog'},
	{id: 'dialog.maximize', scope: 'dialog'},

	{id: 'scene.togglePreview', scope: 'scene-preview'},
	{id: 'scene.play', scope: 'scene-preview'},
	{id: 'scene.fullScreen', scope: 'scene-preview'},
	{id: 'scene.toggleLock', scope: 'scene-preview'},
	{id: 'scene.deselect', scope: 'scene-preview'},

	// The scrubber and the nudges share the arrow keys. Nudging requires a selection and
	// scrubbing requires none, so exactly one group is live at any moment--see
	// `enabledGroup` and the `enabled` guards in `scene-preview.tsx`.

	{
		enabledGroup: 'scene-no-selection',
		id: 'scene.previousBeat',
		scope: 'scene-preview'
	},
	{
		enabledGroup: 'scene-no-selection',
		id: 'scene.nextBeat',
		scope: 'scene-preview'
	},
	{
		enabledGroup: 'scene-selection',
		id: 'scene.nudgeLeft',
		scope: 'scene-preview'
	},
	{
		enabledGroup: 'scene-selection',
		id: 'scene.nudgeRight',
		scope: 'scene-preview'
	},
	{
		enabledGroup: 'scene-selection',
		id: 'scene.nudgeUp',
		scope: 'scene-preview'
	},
	{
		enabledGroup: 'scene-selection',
		id: 'scene.nudgeDown',
		scope: 'scene-preview'
	},

	// The rest of the visual editor (spec 07's gesture table). All need a selection, and
	// none of them shares a key with anything else in the scope, so no group is needed.

	{id: 'scene.flip', scope: 'scene-preview'},
	{id: 'scene.delete', scope: 'scene-preview'},
	{id: 'scene.layerBack', scope: 'scene-preview'},
	{id: 'scene.layerFront', scope: 'scene-preview'},
	{id: 'scene.zBack', scope: 'scene-preview'},
	{id: 'scene.zFront', scope: 'scene-preview'},

	{id: 'slidersAssets.upload', scope: 'sliders-assets'},
	{id: 'slidersAssets.newCharacter', scope: 'sliders-assets'},
	{id: 'slidersAssets.search', scope: 'sliders-assets'},

	{id: 'assetGenerator.generate', scope: 'asset-generator'},
	{id: 'assetGenerator.stop', scope: 'asset-generator'},

	{id: 'assetEditor.removeBackground', scope: 'asset-editor'},
	{id: 'assetEditor.restoreBackground', scope: 'asset-editor'},
	{id: 'assetEditor.resetCrop', scope: 'asset-editor'},
	{id: 'assetEditor.saveAsNew', scope: 'asset-editor'},
	{id: 'assetEditor.replace', scope: 'asset-editor'},

	{id: 'slidersCharacters.create', scope: 'sliders-characters'},
	{id: 'slidersCharacters.delete', scope: 'sliders-characters'},
	{id: 'slidersCharacters.addFrames', scope: 'sliders-characters'},
	{id: 'slidersCharacters.addAnchor', scope: 'sliders-characters'},

	{id: 'finder.select', scope: 'fuzzy-finder'},
	{id: 'finder.previous', scope: 'fuzzy-finder'},
	{id: 'finder.next', scope: 'fuzzy-finder'},
	{id: 'finder.close', scope: 'fuzzy-finder'}
];

/**
 * Sanity check used by tests: every catalog entry has a keymap entry and vice
 * versa, so neither can silently drift.
 */
export function catalogKeymapMismatches(): string[] {
	const catalogIds = new Set(commandCatalog.map(entry => entry.id));
	const keymapIds = new Set(Object.keys(defaultKeymap));

	return [
		...[...catalogIds]
			.filter(id => !keymapIds.has(id))
			.map(id => `${id} is in the catalog but not the keymap`),
		...[...keymapIds]
			.filter(id => !catalogIds.has(id))
			.map(id => `${id} is in the keymap but not the catalog`)
	];
}
