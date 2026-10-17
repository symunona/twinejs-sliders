import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {parseScene} from '@sliders/scene-schema';
import type {AssetResolver, Scene} from '@sliders/scene-types';
import {
	SceneSettingsPanel,
	formatBubble,
	formatFx,
	formatMusic,
	formatTransition,
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

function renderPanel(yaml: string, editable = true) {
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
		/>
	);

	return {onWrite};
}

const row = (testId: string) => screen.getByTestId(testId);
const select = (testId: string) =>
	within(row(testId)).getByRole('combobox') as HTMLSelectElement;
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

describe('<SceneSettingsPanel>', () => {
	it('renders nothing when not editable', () => {
		renderPanel('bg: cellar', false);
		expect(screen.queryByTestId('scene-settings-panel')).toBeNull();
	});

	it('shows the stated backdrop, highlighted, and its X removes it', () => {
		const {onWrite} = renderPanel('bg: cellar');

		expect(select('scene-settings-bg').value).toBe('cellar');
		expect(row('scene-settings-bg').dataset.overridden).toBe('true');
		fireEvent.click(reset('scene-settings-bg'));
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: undefined, sceneKey: 'bg'}
		]);
	});

	it('changes the backdrop and keeps its motion', () => {
		const {onWrite} = renderPanel('bg: {id: cellar, fx: earthquake}');

		fireEvent.change(select('scene-settings-bg'), {target: {value: 'street'}});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: '{id: street, fx: earthquake}', sceneKey: 'bg'}
		]);
	});

	it('offers a stated backdrop the asset list lacks', () => {
		renderPanel('bg: attic');
		expect(select('scene-settings-bg').value).toBe('attic');
	});

	it('disables motion without art', () => {
		renderPanel('bg: ~');
		expect(select('scene-settings-bg').value).toBe('~');
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
		const {onWrite} = renderPanel('bg: cellar');
		const box = number('scene-settings-auto-advance');

		fireEvent.change(box, {target: {value: '2'}});
		fireEvent.change(box, {target: {value: '2.5'}});
		expect(onWrite).not.toHaveBeenCalled();
		fireEvent.blur(box);
		expect(onWrite).toHaveBeenCalledTimes(1);
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: '2.5', sceneKey: 'autoAdvance'}
		]);
	});

	it('removes autoAdvance when the box is emptied', () => {
		const {onWrite} = renderPanel('autoAdvance: 0');
		const box = number('scene-settings-auto-advance');

		expect(box.value).toBe('0');
		fireEvent.change(box, {target: {value: ''}});
		fireEvent.keyDown(box, {key: 'Enter'});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: undefined, sceneKey: 'autoAdvance'}
		]);
	});

	it('shows a per-kind ease map as a readout that writes nothing', () => {
		const {onWrite} = renderPanel('ease: {move: back_out}');
		const box = select('scene-settings-ease');

		expect(box.selectedOptions[0].textContent).toBe(
			'dialogs.passageEdit.scenePreview.settings.easePerKind'
		);
		fireEvent.change(box, {target: {value: 'ease_out'}});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: 'ease_out', sceneKey: 'ease'}
		]);
	});

	it('adds and removes an effect', () => {
		const {onWrite} = renderPanel('fx: [rain@0.6]');

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
		const {onWrite} = renderPanel('bg: cellar');

		fireEvent.change(select('scene-settings-music'), {target: {value: 'rain'}});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: 'rain', sceneKey: 'music'}
		]);
	});

	it('changes the bed and keeps its volume', () => {
		const {onWrite} = renderPanel('music: rain@0.4');

		fireEvent.change(select('scene-settings-music'), {
			target: {value: 'strings'}
		});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: 'strings@0.4', sceneKey: 'music'}
		]);
	});

	it('sets a single track to play once', () => {
		const {onWrite} = renderPanel('music: rain');

		fireEvent.change(select('scene-settings-music-main-loop'), {
			target: {value: 'false'}
		});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: '{id: rain, loop: false}', sceneKey: 'music'}
		]);
	});

	it('removes one keyed track and leaves the other', () => {
		const {onWrite} = renderPanel('music: {mellow: strings, drums: rain@0.3}');

		fireEvent.click(reset('scene-settings-track-drums-name'));
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: '{mellow: strings}', sceneKey: 'music'}
		]);
	});

	it('writes one bubble key into the scene bubble map', () => {
		const {onWrite} = renderPanel('bubble: {as: yell}');

		fireEvent.change(select('scene-settings-bubble-place'), {
			target: {value: 'top'}
		});
		expect(onWrite).toHaveBeenCalledWith([
			{formatted: '{as: yell, place: top}', sceneKey: 'bubble'}
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
