import {Editor} from 'codemirror';
import {commands} from '../codemirror-commands';
import {toolbar} from '../codemirror-toolbar';
import {
	LAST_NAMED_SCENE_KEY,
	LAST_SCENE_KEY,
	LastSceneRecord
} from '../sliders/last-scene';
import {SCENE_MENU_LABEL} from '../sliders/scene-toolbar';

interface Menu {
	label: string;
	items: {label: string; command?: string; disabled?: boolean}[];
}

function fakeEditor(selection = false) {
	const replaceSelection = jest.fn();

	return {
		editor: {
			focus: jest.fn(),
			getDoc: () => ({somethingSelected: () => selection}),
			replaceSelection
		} as unknown as Editor,
		replaceSelection
	};
}

function menus(selection = false): Menu[] {
	return toolbar(fakeEditor(selection).editor, {
		appTheme: 'light',
		foregroundColor: '#000',
		locale: 'en'
	}) as unknown as Menu[];
}

function store(record: Partial<LastSceneRecord>, key = LAST_SCENE_KEY) {
	window.localStorage.setItem(
		key,
		JSON.stringify({passageName: 'Alley', text: 'id: alley\n', ...record})
	);
}

beforeEach(() => window.localStorage.clear());

describe('the toolbar', () => {
	it('offers the Scene menu first, under the label the editor looks for', () => {
		const [first] = menus();

		expect(first.label).toBe(SCENE_MENU_LABEL);
		expect(SCENE_MENU_LABEL).toBe('Scene');
	});

	it("keeps Chapbook's own menus", () => {
		expect(menus().map(menu => menu.label)).toEqual([
			'Scene',
			'Style',
			'Link',
			'Modifiers',
			'Embed',
			'Input'
		]);
	});

	it('offers every scene command', () => {
		expect(menus()[0].items.map(item => item.command)).toEqual([
			'insertScene',
			'insertLastScene',
			'insertLastSceneOverlay',
			undefined,
			'insertSceneCast',
			'insertSceneBeats',
			'insertSceneLinks'
		]);
	});

	it('disables the handoff items when the editor has stored nothing', () => {
		const items = menus()[0].items;

		expect(items[1]).toMatchObject({label: 'Insert Last Scene', disabled: true});
		expect(items[2]).toMatchObject({
			label: 'Overlay on Last Scene',
			disabled: true
		});
	});

	it('names the stored scene once the editor has stored one', () => {
		store({id: 'alley'});
		store({id: 'alley'}, LAST_NAMED_SCENE_KEY);

		const items = menus()[0].items;

		expect(items[1]).toMatchObject({
			label: 'Insert Last Scene (alley)',
			disabled: false
		});
		expect(items[2]).toMatchObject({
			label: "Overlay on 'alley'",
			disabled: false
		});
	});

	it('falls back to the passage name for an unnamed scene', () => {
		store({passageName: 'Alley'});

		expect(menus()[0].items[1].label).toBe('Insert Last Scene (Alley)');
	});
});

describe('the scene commands', () => {
	it('are all present', () => {
		for (const name of [
			'insertScene',
			'insertLastScene',
			'insertLastSceneOverlay',
			'insertSceneCast',
			'insertSceneBeats',
			'insertSceneLinks'
		]) {
			expect(typeof (commands as Record<string, unknown>)[name]).toBe(
				'function'
			);
		}
	});

	it('insert a skeleton that teaches every top-level key', () => {
		const {editor, replaceSelection} = fakeEditor();

		(commands as any).insertScene(editor);

		const text = replaceSelection.mock.calls[0][0] as string;

		expect(text).toMatch(/^\n\[scene\]\n/);
		expect(text).toMatch(/\n\[continued\]\n$/);

		for (const key of ['id:', 'from:', 'bg:', 'camera:', 'cast:', 'props:', 'fx:', 'beats:', 'links:']) {
			expect(text).toContain(key);
		}
	});

	it('leaves the skeleton links: block where the editor expects it', () => {
		// prefill-links.ts rewrites the example links as the skeleton lands, and finds
		// them by a `links:` line at column 0 with indented entries under it.
		const {editor, replaceSelection} = fakeEditor();

		(commands as any).insertScene(editor);

		const lines = (replaceSelection.mock.calls[0][0] as string).split('\n');
		const start = lines.findIndex(line => /^links:\s*$/.test(line));

		expect(start).toBeGreaterThan(-1);
		expect(lines[start + 1]).toMatch(/^\s+\w[\w .-]*:/);
	});

	it('pastes the stored scene without its id', () => {
		store({id: 'alley', text: 'id: alley\nbg: dusk\n'});

		const {editor, replaceSelection} = fakeEditor();

		(commands as any).insertLastScene(editor);

		const text = replaceSelection.mock.calls[0][0] as string;

		expect(text).toContain("# Copy of scene 'alley'");
		expect(text).toContain('bg: dusk');
		expect(text).not.toContain('id: alley');
	});

	it('writes an overlay that inherits from the stored scene', () => {
		store(
			{cast: ['mira'], id: 'alley', props: ['candle'], text: 'id: alley\n'},
			LAST_NAMED_SCENE_KEY
		);

		const {editor, replaceSelection} = fakeEditor();

		(commands as any).insertLastSceneOverlay(editor);

		const text = replaceSelection.mock.calls[0][0] as string;

		expect(text).toContain('id: alley-next');
		expect(text).toContain('from: alley');
		expect(text).toContain('# Inherited cast: mira');
		expect(text).toContain('# Inherited props: candle');
	});

	it('falls back to the skeleton when nothing is stored', () => {
		const {editor, replaceSelection} = fakeEditor();

		(commands as any).insertLastScene(editor);
		(commands as any).insertLastSceneOverlay(editor);

		for (const call of replaceSelection.mock.calls) {
			expect(call[0]).toContain('# Every key Sliders understands.');
		}
	});

	it('survives a corrupt handoff record', () => {
		window.localStorage.setItem(LAST_SCENE_KEY, 'not json');

		expect(menus()[0].items[1].disabled).toBe(true);
	});
});
