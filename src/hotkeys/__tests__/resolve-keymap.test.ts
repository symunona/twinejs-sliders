import {
	catalogKeymapMismatches,
	commandCatalog,
	exclusivelyEnabled
} from '../command-catalog';
import {
	bindingLockedByAppMenu,
	defaultBindings,
	defaultKeymap
} from '../default-keymap';
import {normalizeKeyString} from '../key-string';
import {resolveBindings, resolveKeymap} from '../resolve-keymap';

describe('resolveKeymap()', () => {
	it('uses defaults when the user has no overrides', () => {
		expect(resolveKeymap({}, false)['passage.create']).toEqual({
			bindings: ['n'],
			overridden: false
		});
	});

	it('prefers the user override', () => {
		expect(
			resolveKeymap({'passage.create': ['mod+n']}, false)['passage.create']
		).toEqual({bindings: ['mod+n'], overridden: true});
	});

	it('treats an empty override as deliberately unbound, not as missing', () => {
		expect(
			resolveKeymap({'passage.create': []}, false)['passage.create']
		).toEqual({bindings: [], overridden: true});
	});

	it('includes overrides for commands that have no default', () => {
		expect(
			resolveKeymap({'story.details': ['mod+i']}, false)['story.details']
		).toEqual({bindings: ['mod+i'], overridden: true});
	});
});

describe('resolveBindings()', () => {
	it('answers for a single command', () => {
		expect(resolveBindings('passage.create', {}, false)).toEqual(['n']);
		expect(resolveBindings('nonexistent.command', {}, false)).toEqual([]);
	});
});

describe('environment-specific bindings', () => {
	it('gives undo a binding in the browser only', () => {
		expect(defaultBindings('story.undo', false)).toEqual(['mod+z']);
		expect(defaultBindings('story.undo', true)).toEqual([]);
	});

	it('marks those commands as locked in Electron so the UI can explain why', () => {
		expect(bindingLockedByAppMenu('story.undo', true)).toBe(true);
		expect(bindingLockedByAppMenu('story.undo', false)).toBe(false);
		expect(bindingLockedByAppMenu('passage.create', true)).toBe(false);
	});
});

describe('the default keymap', () => {
	it('matches the command catalog', () => {
		expect(catalogKeymapMismatches()).toEqual([]);
	});

	it('has no two commands sharing a binding within a scope', () => {
		const seen = new Map<string, string>();
		const clashes: string[] = [];

		for (const {id, scope} of commandCatalog) {
			for (const binding of defaultKeymap[id]?.bindings ?? []) {
				// Bindings are compared per platform, since mod and ctrl collapse
				// differently on each.

				for (const platform of ['linux', 'mac', 'windows'] as const) {
					const key = `${platform}\n${scope}\n${normalizeKeyString(
						binding,
						platform
					)}`;
					const existing = seen.get(key);

					// Commands with mutually exclusive `enabledGroup`s are allowed to
					// share: only one of them is ever enabled, so the dispatcher's
					// answer is decided by state, not by registration order.

					if (
						existing &&
						existing !== id &&
						!exclusivelyEnabled(commandCatalog, [existing, id])
					) {
						clashes.push(`${key} is used by both ${existing} and ${id}`);
					} else {
						seen.set(key, id);
					}
				}
			}
		}

		expect(clashes).toEqual([]);
	});

	it('never binds a bare letter outside a browse-first scope', () => {
		// Scopes where the work is picking things, not typing: the routes'
		// canvases, the sliders browsers, and the scene preview. Everything
		// else has to use a chord. The dispatcher never fires a bare-key
		// command while a field has focus, so the fields these scopes do
		// contain stay usable either way.

		const browseScopes = [
			'story-list',
			'story-map',
			'scene-preview',
			'sliders-assets',
			'sliders-characters',
			'asset-editor'
		];
		const problems: string[] = [];

		for (const {id, scope} of commandCatalog) {
			for (const binding of defaultKeymap[id]?.bindings ?? []) {
				if (/^[a-z0-9]$/.test(binding) && !browseScopes.includes(scope)) {
					problems.push(`${id} binds bare "${binding}" in scope ${scope}`);
				}
			}
		}

		expect(problems).toEqual([]);
	});

	it('avoids keys the browser will not give up', () => {
		// See docs/2026-08-15-twine-hotkey-defaults.md section 2.1.

		const reserved = [
			'mod+n',
			'mod+shift+n',
			'mod+t',
			'mod+shift+t',
			'mod+w',
			'mod+shift+w',
			'mod+l',
			'mod+q'
		];
		const problems: string[] = [];

		for (const [id, entry] of Object.entries(defaultKeymap)) {
			for (const binding of entry.bindings) {
				if (reserved.includes(normalizeKeyString(binding, 'linux'))) {
					problems.push(`${id} binds reserved key ${binding}`);
				}
			}
		}

		expect(problems).toEqual([]);
	});
});
