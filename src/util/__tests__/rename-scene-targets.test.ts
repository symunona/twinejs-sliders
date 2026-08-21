import {renameSceneTargets} from '../rename-scene-targets';

describe('renameSceneTargets', () => {
	function scene(...lines: string[]) {
		return ['[scene]', ...lines].join('\n');
	}

	it('follows a rename into `to:`, the shorthand and `from:`', () => {
		const text = scene(
			'from: Tavern',
			'cast:',
			'  mira: {at: -0.4}',
			'links:',
			'  go: {to: Tavern}',
			'  back: Tavern'
		);

		expect(renameSceneTargets(text, 'Tavern', 'Inn')).toBe(
			scene(
				'from: Inn',
				'cast:',
				'  mira: {at: -0.4}',
				'links:',
				'  go: {to: Inn}',
				'  back: Inn'
			)
		);
	});

	it('leaves the rest of the block exactly as the author wrote it', () => {
		const text = scene(
			'# where we came in',
			'links:',
			'',
			'  go:   {to: Tavern, if: brave}   # the front door',
			'  stay: Street'
		);

		expect(renameSceneTargets(text, 'Tavern', 'Inn')).toBe(
			scene(
				'# where we came in',
				'links:',
				'',
				'  go:   {to: Inn, if: brave}   # the front door',
				'  stay: Street'
			)
		);
	});

	it('renames only whole targets, never a name inside another one', () => {
		const text = scene('links:', '  go: {to: Tavern Fight}', '  back: Tavern');

		expect(renameSceneTargets(text, 'Tavern', 'Inn')).toBe(
			scene('links:', '  go: {to: Tavern Fight}', '  back: Inn')
		);
	});

	it('leaves link names, ids and speakers alone', () => {
		const text = scene(
			'id: Tavern',
			'links:',
			'  Tavern: {to: Street}',
			'',
			'say Tavern: Tavern'
		);

		expect(renameSceneTargets(text, 'Tavern', 'Inn')).toBe(text);
	});

	it('quotes a new name that would stop being a string', () => {
		const text = scene('links:', '  back: Tavern');

		expect(renameSceneTargets(text, 'Tavern', '42')).toBe(
			scene('links:', '  back: "42"')
		);
	});

	it('quotes a new name a flow map would end early', () => {
		const text = scene('links:', '  go: {to: Tavern, if: brave}');

		expect(renameSceneTargets(text, 'Tavern', 'Inn, Upstairs')).toBe(
			scene('links:', '  go: {to: "Inn, Upstairs", if: brave}')
		);
	});

	it('finds the block wherever it starts and stops at the next modifier', () => {
		const text = [
			'Before.',
			'',
			'[scene]',
			'links:',
			'  back: Tavern',
			'[note]',
			'links:',
			'  back: Tavern'
		].join('\n');

		expect(renameSceneTargets(text, 'Tavern', 'Inn')).toBe(
			[
				'Before.',
				'',
				'[scene]',
				'links:',
				'  back: Inn',
				'[note]',
				'links:',
				'  back: Tavern'
			].join('\n')
		);
	});

	it('leaves beat text to Twine, which relinks `[[…]]` itself', () => {
		const text = scene('links:', '  go: {}', '', 'say mira: [[go -> Tavern]]');

		expect(renameSceneTargets(text, 'Tavern', 'Inn')).toBe(text);
	});

	it('does nothing without a scene block, or without a change to make', () => {
		expect(renameSceneTargets('Plain [[Tavern]] prose.', 'Tavern', 'Inn')).toBe(
			'Plain [[Tavern]] prose.'
		);
		expect(
			renameSceneTargets(scene('links:', '  back: Tavern'), 'Tavern', 'Tavern')
		).toBe(scene('links:', '  back: Tavern'));
		expect(renameSceneTargets(scene('links:', '  back: Street'), 'Tavern', 'Inn')).toBe(
			scene('links:', '  back: Street')
		);
	});

	it('holds still on YAML that does not parse', () => {
		const text = scene('links:', '  go: {to: Tavern', 'cast: [');

		expect(renameSceneTargets(text, 'Tavern', 'Inn')).toBe(text);
	});
});
