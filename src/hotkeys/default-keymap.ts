import {isElectronRenderer} from '../util/is-electron';

export interface DefaultBinding {
	/**
	 * Default key strings for a command. More than one is allowed--e.g. redo is
	 * both `mod+shift+z` and `ctrl+y`.
	 */
	bindings: string[];
	/**
	 * Which build this binding applies to. Omitted means both.
	 *
	 * Electron menu accelerators fire before the renderer sees a keydown, so
	 * some bindings can only work in the browser until the corresponding menu
	 * roles in `src/electron/main-process/menu-bar.ts` are replaced with click
	 * handlers that dispatch the same commands.
	 */
	env?: 'electron' | 'web';
}

/**
 * Default keybindings, keyed by command ID. Components register commands with
 * an ID, scope, label, and what to run; the key they're bound to is decided
 * here so that the whole keymap can be reviewed in one place.
 *
 * Users can override any of these; see `prefs.hotkeyOverrides`.
 */
export const defaultKeymap: Record<string, DefaultBinding> = {
	// Global.

	'app.keyboardShortcuts': {bindings: ['mod+shift+?']},
	'app.preferences': {bindings: ['mod+,']},
	// In the catalog since the AI dialog moved out of Preferences, but never given a
	// key; it's listed here so the shortcuts dialog can offer to bind it.
	'app.ai': {bindings: []},

	// Dialogs. Dialogs are mostly text fields, so this has to be a chord that
	// produces no character and that CodeMirror doesn't use.

	'dialog.maximize': {bindings: ['alt+enter']},

	// Story list.

	'library.import': {bindings: ['mod+o']},
	'story.create': {bindings: ['n']},
	'story.delete': {bindings: ['backspace', 'delete']},
	'story.duplicate': {bindings: ['mod+d']},
	'story.edit': {bindings: ['enter']},
	'story.rename': {bindings: ['f2']},
	'story.tag': {bindings: ['t']},

	// Story map.

	'passage.create': {bindings: ['n']},
	'passage.delete': {bindings: ['backspace', 'delete']},
	'passage.deselectAll': {bindings: ['escape']},
	'passage.edit': {bindings: ['enter']},
	'passage.goTo': {bindings: ['p', 'mod+p']},
	'passage.rename': {bindings: ['f2']},
	'passage.selectAll': {bindings: ['mod+a'], env: 'web'},
	'passage.test': {bindings: ['t']},
	'story.findReplace': {bindings: ['mod+f']},
	'story.redo': {bindings: ['mod+shift+z', 'ctrl+y'], env: 'web'},
	'story.undo': {bindings: ['mod+z'], env: 'web'},
	'view.zoomIn': {bindings: ['=', '+']},
	'view.zoomOut': {bindings: ['-']},
	'view.zoomReset': {bindings: ['0']},
	'build.play': {bindings: ['mod+enter']},
	'build.test': {bindings: ['mod+shift+enter']},
	// The scene preview is a dialog now, opened from the Story toolbar like the asset
	// manager, so its show/hide key belongs to the map. Bare `p` is already the fuzzy
	// finder's, hence the shifted one.
	'scene.togglePreview': {bindings: ['shift+p']},
	'sliders.assets': {bindings: ['a']},
	'sliders.characters': {bindings: ['c']},
	'sliders.generator': {bindings: ['g']},

	// Passage editor. Focus lives in CodeMirror the whole time these are wanted, so
	// they have to be chords that type nothing. Alt+letter is that on Linux and
	// Windows; on macOS Option+P is a real character (π), and `event.key` is what the
	// dispatcher matches on, so these are dead there until someone rebinds them.

	'scene.edit': {bindings: ['alt+p']},
	'scene.assets': {bindings: ['alt+a']},
	// Test from the beat on the stage. Alt+T rather than the map's bare `t`, for the same
	// reason as the two above: focus is in CodeMirror, where a bare letter types.
	'scene.test': {bindings: ['alt+t']},

	// Scene preview. Viewer keys, so they only fire once focus is inside the
	// preview--pressing left in the passage text still moves the cursor.

	'scene.previousBeat': {bindings: ['left']},
	'scene.nextBeat': {bindings: ['right']},
	'scene.play': {bindings: ['k']},
	// `f` belongs to flip (spec 07's gesture table), so full screen took the shifted key.
	'scene.fullScreen': {bindings: ['shift+f']},
	// `mod+l` is what a lock wants to be and the one thing it cannot be: Chrome keeps it for
	// the address bar and will not let a page have it (§2.1 of the hotkey defaults doc), so
	// the chord is the shifted one. The bare `l` is the key that actually gets used, in the
	// same family as `f` and `k` above.
	'scene.toggleLock': {bindings: ['l', 'mod+shift+l']},
	'scene.walkHere': {bindings: ['w']},

	// Visual editor. The nudges take the arrow keys back off the scrubber while something
	// is selected, and Escape hands them over again. Both variants of each arrow are bound
	// to one command; how far it moves is read off the shift key at dispatch time, because
	// eight nudge commands in the shortcuts dialog would say nothing four cannot.

	'scene.deselect': {bindings: ['escape']},
	'scene.nudgeLeft': {bindings: ['left', 'shift+left']},
	'scene.nudgeRight': {bindings: ['right', 'shift+right']},
	'scene.nudgeUp': {bindings: ['up', 'shift+up']},
	'scene.nudgeDown': {bindings: ['down', 'shift+down']},
	'scene.flip': {bindings: ['f']},
	'scene.delete': {bindings: ['backspace', 'delete']},

	// Depth is one number, so it is one pair of commands. Brackets are what every drawing
	// app has trained people on; shift is not available here, because `shift+[` reports the
	// key as `{` and the binding would never match what the keyboard sends.
	//
	// Mod + the up/down arrows is the second binding, because that pair already means "the
	// thing above / the thing below" on this stage: the bare arrows nudge, and holding mod
	// moves the sprite through the stack instead of across the floor. Two bindings, not one
	// — a keyboard whose brackets sit behind AltGr has the arrows, and one whose Ctrl+arrows
	// the window manager eats has the brackets.

	'scene.zBack': {bindings: ['[', 'mod+down']},
	'scene.zFront': {bindings: [']', 'mod+up']},

	// Undo, while focus is on the stage. The keys are the ones the story map uses, but the
	// history they run against is the passage's CodeMirror: a drag is a text edit, and the
	// store's undo stack does not hold it. Web only, for the same reason `story.undo` is --
	// the Electron menu accelerator fires before the renderer sees the keydown.

	'scene.undo': {bindings: ['mod+z'], env: 'web'},
	'scene.redo': {bindings: ['mod+shift+z', 'ctrl+y'], env: 'web'},

	// Asset manager.

	'slidersAssets.upload': {bindings: ['u']},
	'slidersAssets.newCharacter': {bindings: ['n']},
	'slidersAssets.search': {bindings: ['mod+f']},

	// Asset generator. A chord, because focus lives in the prompt box.

	'assetGenerator.generate': {bindings: ['mod+enter']},
	'assetGenerator.stop': {bindings: ['mod+.']},

	// Image editor. Saving is a chord because the name field has focus most of
	// the time it's wanted.

	'assetEditor.removeBackground': {bindings: ['b']},
	// Walk tool: click-to-walk the ghost. W, the same key the scene preview's toggle takes.
	'assetEditor.walkHere': {bindings: ['w']},
	'assetEditor.saveAsNew': {bindings: ['mod+s']},
	'assetEditor.replace': {bindings: ['mod+shift+s']},

	// Character editor.

	'slidersCharacters.create': {bindings: ['n']},
	'slidersCharacters.delete': {bindings: ['backspace', 'delete']},
	'slidersCharacters.addPoses': {bindings: ['u']},
	'slidersCharacters.addAnchor': {bindings: ['a']},

	// Registered but unbound by default: once-a-session actions, and ones that
	// write files. They still appear in the shortcuts dialog, where a user can
	// bind them.

	'build.exportAsTwee': {bindings: []},
	'build.proof': {bindings: []},
	'build.publishToFile': {bindings: []},
	'library.archive': {bindings: []},
	'library.storyTags': {bindings: []},
	'passage.startAt': {bindings: []},
	'story.details': {bindings: []},
	'story.javascript': {bindings: []},
	'story.passageTags': {bindings: []},
	'story.stylesheet': {bindings: []},
	'assetEditor.resetCrop': {bindings: []},
	'assetEditor.restoreBackground': {bindings: []},
	'assetEditor.invertCutout': {bindings: []},
	'assetEditor.cycleMaskMode': {bindings: []},
	'assetEditor.clearMask': {bindings: []},

	// Fuzzy finder. These are the keys the finder has always used; they're here
	// so that they show up in the shortcuts dialog like everything else.

	'finder.close': {bindings: ['escape']},
	'finder.next': {bindings: ['down']},
	'finder.previous': {bindings: ['up']},
	'finder.select': {bindings: ['enter']}
};

/**
 * Returns the default bindings for a command in the current environment. A
 * command whose bindings don't apply here resolves to none.
 */
export function defaultBindings(
	commandId: string,
	electron = isElectronRenderer()
): string[] {
	const entry = defaultKeymap[commandId];

	if (!entry) {
		return [];
	}

	if (entry.env && entry.env !== (electron ? 'electron' : 'web')) {
		return [];
	}

	return entry.bindings;
}

/**
 * Is this command's default binding unavailable because the Electron
 * application menu handles the key itself? The shortcuts dialog uses this to
 * explain why a row is locked.
 */
export function bindingLockedByAppMenu(
	commandId: string,
	electron = isElectronRenderer()
): boolean {
	const entry = defaultKeymap[commandId];

	return !!(electron && entry?.env === 'web' && entry.bindings.length > 0);
}
