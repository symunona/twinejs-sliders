import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {parseScene} from '@sliders/scene-schema';
import type {AssetResolver, Scene} from '@sliders/scene-types';
import {
	SceneSettingsPanel,
	formatBubble,
	formatFx,
	formatMusic,
	formatSfx,
	formatTransition,
	sceneBubbleWrite,
	sceneGlobalKeyWrite,
	splitTransition
} from '../scene-settings-panel';

const assets: AssetResolver = {
	character: async () => undefined,
	meta: async () => undefined,
	url: async () => undefined
};

/** The scene a block of YAML parses to. Parsed for real, so the shapes are the parser's. */
function scene(yaml: string): Scene {
	const parsed = parseScene(yaml);

	if (!parsed.scene) {
		throw new Error(`no scene: ${JSON.stringify(parsed.errors)}`);
	}

	return parsed.scene;
}

function renderPanel(
	yaml: string,
	editable = true,
	extra: Partial<React.ComponentProps<typeof SceneSettingsPanel>> = {}
) {
	const onWrite = jest.fn();

	render(
		<SceneSettingsPanel
			assetNames={{
				audio: ['rain', 'strings'],
				backgrounds: ['cellar', 'street']
			}}
			assets={assets}
			editable={editable}
			onWrite={onWrite}
			scene={scene(yaml)}
			{...extra}
		/>
	);

	return {onWrite};
}

const camera = (yaml: string, extra = {}) =>
	renderPanel(yaml, true, {pane: 'camera', ...extra});

const sounds = (yaml: string, extra = {}) =>
	renderPanel(yaml, true, {pane: 'sounds', ...extra});

const row = (testId: string) => screen.getByTestId(testId);
const select = (testId: string) =>
	within(row(testId)).getByRole('combobox') as HTMLSelectElement;
/** A `PreviewSelect`'s button: shows the value, opens the list. */
const picker = (testId: string) =>
	row(testId).querySelector('.preview-select-button') as HTMLButtonElement;
/** Opens a `PreviewSelect` and picks the option of that name. */
function pick(testId: string, name: string | RegExp) {
	fireEvent.click(picker(testId));
	fireEvent.pointerDown(
		within(screen.getByRole('listbox')).getByRole('option', {name})
	);
}
const number = (testId: string) =>
	within(row(testId)).getByRole('spinbutton') as HTMLInputElement;
const reset = (testId: string) =>
	within(row(testId)).getByRole('button', {
		name: 'dialogs.passageEdit.scenePreview.settings.reset'
	});

describe('formatting', () => {
	it('splits a transition string back into its words', () => {
		expect(splitTransition('push-left 0.6s in_out')).toEqual({
			dur: 0.6,
			ease: 'in_out',
			kind: 'push-left'
		});
		expect(splitTransition('crossfade 600ms')).toEqual({
			dur: 0.6,
			kind: 'fade'
		});
		expect(splitTransition('zoom cubic-bezier(0, 0, 1, 1)')).toEqual({
			ease: 'cubic-bezier(0, 0, 1, 1)',
			kind: 'zoom'
		});
	});

	it('writes a transition as one line, nothing left = remove', () => {
		expect(formatTransition({dur: 0.6, kind: 'push-left'})).toBe(
			'push-left 0.6s'
		);
		expect(formatTransition({})).toBeUndefined();
	});

	it('writes fx with amount 1 left out', () => {
		expect(
			formatFx([
				{amount: 0.6, id: 'rain'},
				{amount: 1, id: 'dark'}
			])
		).toBe('[rain@0.6, dark]');
		expect(formatFx([])).toBeUndefined();
	});

	it('writes sfx with volume only when not 1', () => {
		expect(formatSfx({amount: 1, id: 'door'})).toBe('door');
		expect(formatSfx({amount: 0.4, id: 'door'})).toBe('door@0.4');
	});

	it('round-trips single-form music', () => {
		expect(formatMusic(scene('music: rain').music!)).toBe('rain');
		expect(formatMusic(scene('music: rain@0.4').music!)).toBe('rain@0.4');
		expect(
			formatMusic(scene('music: {id: rain, loop: false, fade: 3s}').music!)
		).toBe('{id: rain, loop: false, fade: 3}');
		expect(formatMusic(null)).toBe('~');
	});

	it('keeps a keyed main track keyed, so its play-once default holds', () => {
		expect(formatMusic(scene('music: {main: rain}').music!)).toBe(
			'{main: rain}'
		);
	});

	it('writes keyed tracks, patches and stop-other-tracks', () => {
		const spec = scene(
			'music:\n  mellow: {id: strings, loop: true}\n  wind: {volume: 1}\n  rain: ~\n  stop-other-tracks: all'
		).music!;

		expect(formatMusic(spec)).toBe(
			'{mellow: {id: strings, loop: true}, wind: {volume: 1}, rain: ~, stop-other-tracks: all}'
		);
	});

	it('writes bubble pairs as [x, y], in key order', () => {
		expect(
			formatBubble({as: 'yell', at: {x: 0.5, y: 0.2}, font: 'Georgia, serif'})
		).toBe('{as: yell, at: [0.5, 0.2], font: "Georgia, serif"}');
		expect(formatBubble({})).toBeUndefined();
	});
});

describe('Step 0 writes (beat tab, scene scope)', () => {
	it('maps dur to autoAdvance and ease to ease, null removes', () => {
		expect(sceneGlobalKeyWrite('dur', 2.5)).toEqual({
			formatted: '2.5',
			sceneKey: 'autoAdvance'
		});
		expect(sceneGlobalKeyWrite('dur', 0)).toEqual({
			formatted: '0',
			sceneKey: 'autoAdvance'
		});
		expect(sceneGlobalKeyWrite('dur', null)).toEqual({
			formatted: undefined,
			sceneKey: 'autoAdvance'
		});
		expect(sceneGlobalKeyWrite('ease', 'ease_out')).toEqual({
			formatted: 'ease_out',
			sceneKey: 'ease'
		});
		expect(sceneGlobalKeyWrite('ease', null)).toEqual({
			formatted: undefined,
			sceneKey: 'ease'
		});
		expect(sceneGlobalKeyWrite('pose', 'x')).toBeUndefined();
	});

	it('writes one bubble key into the scene bubble map, alignment too', () => {
		const bubble = scene('bubble: {as: yell}').bubble;

		expect(sceneBubbleWrite(bubble, 'place', 'top')).toEqual({
			formatted: '{as: yell, place: top}',
			sceneKey: 'bubble'
		});
		expect(sceneBubbleWrite(bubble, 'align', 'right')).toEqual({
			formatted: '{as: yell, align: right}',
			sceneKey: 'bubble'
		});
		expect(sceneBubbleWrite(bubble, 'as', null)).toEqual({
			formatted: undefined,
			sceneKey: 'bubble'
		});
	});

	it('round-trips through the parser', () => {
		const write = sceneBubbleWrite({}, 'valign', 'bottom');

		expect(scene(`bubble: ${write.formatted}`).bubble).toEqual({
			valign: 'bottom'
		});
	});
});

describe('<SceneSettingsPanel>', () => {
	it('renders nothing when not editable', () => {
		renderPanel('bg: cellar', false);
		expect(screen.queryByTestId('scene-settings-panel')).toBeNull();
	});

	it('shows the stated backdrop, highlighted, and its X removes it', () => {
		const {onWrite} = renderPanel('bg: cellar');

		expect(picker('scene-settings-bg')).toHaveTextContent('cellar');
		expect(row('scene-settings-bg').dataset.overridden).toBe('true');
		fireEvent.click(reset('scene-settings-bg'));
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: undefined, sceneKey: 'bg'}
		]);
	});

	it('changes the backdrop and keeps its motion', () => {
		const {onWrite} = renderPanel('bg: {id: cellar, fx: earthquake}');

		pick('scene-settings-bg', 'street');
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: '{id: street, fx: earthquake}', sceneKey: 'bg'}
		]);
	});

	it('offers a stated backdrop the asset list lacks', () => {
		renderPanel('bg: attic');
		expect(picker('scene-settings-bg')).toHaveTextContent('attic');
	});

	it('disables motion without art', () => {
		camera('bg: ~');
		expect(select('scene-settings-bg-fx').disabled).toBe(true);
	});

	it('edits the transition kind and keeps its duration', () => {
		const {onWrite} = renderPanel('transition: fade 0.6s');

		fireEvent.change(select('scene-settings-transition'), {
			target: {value: 'push-left'}
		});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: 'push-left 0.6s', sceneKey: 'transition'}
		]);
	});

	it('commits a number on blur, not per keystroke', () => {
		const {onWrite} = renderPanel('transition: fade');
		const box = number('scene-settings-transition-dur');

		fireEvent.change(box, {target: {value: '0.4'}});
		fireEvent.change(box, {target: {value: '0.5'}});
		expect(onWrite).not.toHaveBeenCalled();
		fireEvent.blur(box);
		expect(onWrite).toHaveBeenCalledTimes(1);
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: 'fade 0.5s', sceneKey: 'transition'}
		]);
	});

	it('leaves the beat defaults (pacing, bubble) to the beat tab', () => {
		renderPanel('autoAdvance: 2\nease: ease_out\nbubble: {as: yell}');
		expect(screen.queryByTestId('scene-settings-auto-advance')).toBeNull();
		expect(screen.queryByTestId('scene-settings-ease')).toBeNull();
		expect(screen.queryByTestId('scene-settings-bubble-group')).toBeNull();
	});

	it('adds and removes an effect', () => {
		const {onWrite} = camera('fx: [rain@0.6]');

		fireEvent.change(select('scene-settings-fx-add'), {
			target: {value: 'dark'}
		});
		expect(onWrite).toHaveBeenLastCalledWith([
			{formatted: '[rain@0.6, dark]', sceneKey: 'fx'}
		]);
		fireEvent.click(reset('scene-settings-fx-rain'));
		expect(onWrite).toHaveBeenLastCalledWith([
			{formatted: undefined, sceneKey: 'fx'}
		]);
	});

	it('picks a sound when the scene has no music', () => {
		const {onWrite} = sounds('bg: cellar');

		fireEvent.change(select('scene-settings-music'), {target: {value: 'rain'}});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: 'rain', sceneKey: 'music'}
		]);
	});

	it('changes the bed and keeps its volume', () => {
		const {onWrite} = sounds('music: rain@0.4');

		fireEvent.change(select('scene-settings-music'), {
			target: {value: 'strings'}
		});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: 'strings@0.4', sceneKey: 'music'}
		]);
	});

	it('sets a single track to play once', () => {
		const {onWrite} = sounds('music: rain');

		fireEvent.change(select('scene-settings-music-main-loop'), {
			target: {value: 'false'}
		});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: '{id: rain, loop: false}', sceneKey: 'music'}
		]);
	});

	// Bug report: an explicit `loop: true` on the bed snapped to "—", because it equals the
	// default. Unset and stated are different things — changing the default must not lose it.
	describe('loop: stated vs unset', () => {
		const loopSelect = () => select('scene-settings-music-main-loop');

		it('shows a stated loop as loop, not as unset', () => {
			sounds('music: {id: rain, loop: true}');

			expect(loopSelect().value).toBe('true');
		});

		it('shows an unstated loop as unset', () => {
			sounds('music: rain');

			expect(loopSelect().value).toBe('');
		});

		it('writes a picked loop out loud, even though it is the default', () => {
			const {onWrite} = sounds('music: rain');

			fireEvent.change(loopSelect(), {target: {value: 'true'}});
			expect(onWrite).toHaveBeenCalledWith([
				{formatted: '{id: rain, loop: true}', sceneKey: 'music'}
			]);
		});

		it('picking unset removes the key', () => {
			const {onWrite} = sounds('music: {id: rain, loop: true}');

			fireEvent.change(loopSelect(), {target: {value: ''}});
			expect(onWrite).toHaveBeenCalledWith([
				{formatted: 'rain', sceneKey: 'music'}
			]);
		});

		it('keeps a keyed track\'s stated play-once', () => {
			sounds('music: {drums: {id: rain, loop: false}}');

			expect(select('scene-settings-music-drums-loop').value).toBe('false');
		});

		it('round-trips a stated default', () => {
			expect(
				formatMusic(scene('music: {id: rain, loop: true}').music!)
			).toBe('{id: rain, loop: true}');
			expect(
				formatMusic(scene('music: {drums: {id: x, loop: false}}').music!)
			).toBe('{drums: {id: x, loop: false}}');
		});
	});

	it('removes one keyed track and leaves the other', () => {
		const {onWrite} = sounds('music: {mellow: strings, drums: rain@0.3}');

		fireEvent.click(reset('scene-settings-track-drums-name'));
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: '{mellow: strings}', sceneKey: 'music'}
		]);
	});

	it('keeps music off the scene pane: it lives on sounds', () => {
		renderPanel('music: rain');
		expect(screen.queryByTestId('scene-settings-music-group')).toBeNull();
	});

	describe('sounds pane, beat scope', () => {
		const yaml =
			'music: rain\ncast: {mira: {at: [0.5, 0.9]}}\nbeats:\n  - mira: {say: hi, sfx: door@0.4}\n  - mira: hello\n  - sfx: bell';
		const beat = (index: number) => scene(yaml).beats[index];

		function renderBeat(index: number) {
			const onWriteBeat = jest.fn();
			const {onWrite} = sounds(yaml, {onWriteBeat, soundBeat: beat(index)});

			return {onWrite, onWriteBeat};
		}

		it('reads the beat, not the scene', () => {
			renderBeat(1);
			expect(select('scene-settings-music').value).toBe('');
			expect(row('scene-settings-music').dataset.overridden).toBeUndefined();
			expect(row('scene-settings-music')).toHaveTextContent(
				'dialogs.passageEdit.scenePreview.settings.musicKeep'
			);
		});

		it('writes the beat\'s music, never the scene key', () => {
			const {onWrite, onWriteBeat} = renderBeat(1);

			fireEvent.change(select('scene-settings-music'), {
				target: {value: 'strings'}
			});
			expect(onWriteBeat).toHaveBeenCalledWith('music', 'strings');
			fireEvent.change(select('scene-settings-music'), {target: {value: '~'}});
			expect(onWriteBeat).toHaveBeenLastCalledWith('music', '~');
			expect(onWrite).not.toHaveBeenCalled();
		});

		it('edits the beat\'s sfx: sound, volume, remove', () => {
			const {onWriteBeat} = renderBeat(0);

			expect(select('scene-settings-sfx').value).toBe('door');
			expect(number('scene-settings-sfx-volume').value).toBe('0.4');
			fireEvent.change(select('scene-settings-sfx'), {target: {value: 'rain'}});
			expect(onWriteBeat).toHaveBeenLastCalledWith('sfx', 'rain@0.4');
			fireEvent.click(reset('scene-settings-sfx-volume'));
			expect(onWriteBeat).toHaveBeenLastCalledWith('sfx', 'door');
			fireEvent.click(reset('scene-settings-sfx'));
			expect(onWriteBeat).toHaveBeenLastCalledWith('sfx', undefined);
		});

		it('has no sfx row at Step 0: sfx: only belongs to a beat', () => {
			sounds(yaml);
			expect(screen.getByTestId('scene-settings-music-group')).toBeInTheDocument();
			expect(screen.queryByTestId('scene-settings-sfx-group')).toBeNull();
		});

		it('says why a sound-command beat offers no rows', () => {
			renderBeat(2);
			expect(screen.queryByTestId('scene-settings-music-group')).toBeNull();
			expect(screen.getByTestId('scene-settings-sound-note')).toHaveTextContent(
				'dialogs.passageEdit.scenePreview.settings.soundCommand'
			);
		});
	});

	it('searches backdrops and shows their previews', () => {
		renderPanel('bg: cellar', true, {
			bgPreview: name => <i data-testid={`thumb-${name}`} />
		});
		// The closed button carries the current one's thumbnail.
		expect(
			within(row('scene-settings-bg')).getByTestId('thumb-cellar')
		).toBeInTheDocument();
		fireEvent.click(picker('scene-settings-bg'));
		fireEvent.change(
			screen.getByRole('textbox', {name: 'components.previewSelect.search'}),
			{target: {value: 'str'}}
		);

		const listbox = screen.getByRole('listbox');

		expect(within(listbox).getAllByRole('option')).toHaveLength(1);
		expect(within(listbox).getByTestId('thumb-street')).toBeInTheDocument();
	});

	it('splits over panes: backdrop on scene, motion and effects on camera', () => {
		renderPanel('bg: cellar');
		expect(screen.getByTestId('scene-settings-bg')).toBeInTheDocument();
		expect(screen.queryByTestId('scene-settings-bg-fx')).toBeNull();
		expect(screen.queryByTestId('scene-settings-fx-group')).toBeNull();
		expect(screen.queryByTestId('scene-settings-camera-group')).toBeNull();
	});

	it('shows the camera pane: coords, motion, effects, no backdrop', () => {
		camera('bg: cellar', {camera: {at: {x: 0.25, y: -0.1}, zoom: 1.5}});
		expect(screen.queryByTestId('scene-settings-bg')).toBeNull();
		expect(screen.getByTestId('scene-settings-motion-group')).toBeInTheDocument();
		expect(screen.getByTestId('scene-settings-fx-group')).toBeInTheDocument();
		expect(number('scene-settings-camera-x').value).toBe('0.25');
		expect(number('scene-settings-camera-y').value).toBe('-0.1');
		expect(number('scene-settings-camera-zoom').value).toBe('1.5');
	});

	it('writes the whole camera from one coord, rest = removed', () => {
		const {onWrite} = camera('camera: {zoom: 2}', {
			camera: {at: {x: 0, y: 0}, zoom: 2}
		});

		expect(row('scene-settings-camera-zoom').dataset.overridden).toBe('true');
		fireEvent.change(number('scene-settings-camera-x'), {
			target: {value: '0.5'}
		});
		fireEvent.blur(number('scene-settings-camera-x'));
		expect(onWrite).toHaveBeenLastCalledWith([
			{formatted: '{at: [0.5, 0], zoom: 2}', sceneKey: 'camera'}
		]);
		fireEvent.click(reset('scene-settings-camera-zoom'));
		expect(onWrite).toHaveBeenLastCalledWith([
			{formatted: undefined, sceneKey: 'camera'}
		]);
	});

	it('resets the whole camera from the heading: key removed', () => {
		const {onWrite} = camera('camera: {at: [0.3, -0.2], zoom: 2}', {
			camera: {at: {x: 0.3, y: -0.2}, zoom: 2}
		});
		const button = screen.getByTestId(
			'scene-settings-camera-reset'
		) as HTMLButtonElement;

		expect(button.disabled).toBe(false);
		fireEvent.click(button);
		expect(onWrite).toHaveBeenLastCalledWith([
			{formatted: undefined, sceneKey: 'camera'}
		]);
	});

	it('greys the camera reset when the camera is at rest', () => {
		camera('camera: {at: [0, 0], zoom: 1}', {
			camera: {at: {x: 0, y: 0}, zoom: 1}
		});
		expect(
			(screen.getByTestId('scene-settings-camera-reset') as HTMLButtonElement)
				.disabled
		).toBe(true);
	});

	it('greys the camera reset under a locked backdrop', () => {
		camera('camera: {zoom: 2}\nlocked: [bg]', {
			camera: {at: {x: 0, y: 0}, zoom: 2},
			cameraLockedReason: 'locked by scene'
		});
		expect(
			(screen.getByTestId('scene-settings-camera-reset') as HTMLButtonElement)
				.disabled
		).toBe(true);
	});

	it('locks the camera coords when the scene locks the backdrop', () => {
		camera('locked: [bg]', {cameraLockedReason: 'locked by scene'});
		expect(number('scene-settings-camera-x').disabled).toBe(true);
		expect(row('scene-settings-camera-x')).toHaveTextContent('locked by scene');
	});

	it('picks a template passage for from:, with a ? that explains', () => {
		const {onWrite} = renderPanel('bg: cellar', true, {
			templates: ['Tavern Night', 'Street']
		});

		expect(screen.getByTestId('scene-settings-from-help')).toHaveAttribute(
			'title',
			'dialogs.passageEdit.scenePreview.settings.fromHelp'
		);
		pick('scene-settings-from', 'Tavern Night');
		expect(onWrite).toHaveBeenLastCalledWith([
			{formatted: 'Tavern Night', sceneKey: 'from'}
		]);
	});

	it('keeps a stated from: with a mark, and its X removes it', () => {
		const {onWrite} = renderPanel('from: Tavern Night@tense', true, {
			templates: ['Tavern Night']
		});

		expect(picker('scene-settings-from')).toHaveTextContent(
			'Tavern Night@tense'
		);
		fireEvent.click(reset('scene-settings-from'));
		expect(onWrite).toHaveBeenLastCalledWith([
			{formatted: undefined, sceneKey: 'from'}
		]);
	});

	it('locks the backdrop', () => {
		const {onWrite} = renderPanel('bg: cellar');

		fireEvent.change(select('scene-settings-locked'), {target: {value: 'bg'}});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: '[bg]', sceneKey: 'locked'}
		]);
	});
});
