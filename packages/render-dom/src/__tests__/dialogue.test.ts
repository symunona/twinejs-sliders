import {DialogueLayer, parseLinkText, placeBubble, preferredSide} from '../dialogue';
import type {MeasuringRenderer} from '../dialogue';

describe('preferredSide', () => {
	const box = {left: 0, top: 0, width: 1600, height: 900};

	it('reads the side off the mouth -> anchor vector', () => {
		const mouth = {x: 800, y: 500};

		expect(preferredSide(mouth, {x: 900, y: 480})).toBe('right');
		expect(preferredSide(mouth, {x: 700, y: 480})).toBe('left');
		expect(preferredSide(mouth, {x: 810, y: 300})).toBe('above');
		expect(preferredSide(mouth, {x: 810, y: 700})).toBe('below');
	});

	it('falls back to above with no mouth to compare against', () => {
		expect(preferredSide(null, {x: 800, y: 500})).toBe('above');
	});

	it('hangs the bubble off the anchor in that direction', () => {
		const p = placeBubble({
			anchor: {x: 900, y: 480},
			mouth: {x: 800, y: 500},
			box,
			w: 200,
			h: 100,
			gap: 12,
			margin: 12
		});

		expect(p.side).toBe('right');
		expect(p.left).toBe(912);
		expect(p.top).toBe(430);
		// Tail rides the left edge, level with the anchor.
		expect(p.tail).toBe(50);
	});

	it('flips to the opposite side when the preferred one has no room', () => {
		const p = placeBubble({
			anchor: {x: 1580, y: 480},
			mouth: {x: 1500, y: 500},
			box,
			w: 400,
			h: 100,
			gap: 12,
			margin: 12
		});

		expect(p.side).toBe('left');
		expect(p.left).toBe(1168);
	});

	it('goes to the cross axis when neither horizontal side fits', () => {
		const narrow = {left: 0, top: 0, width: 500, height: 900};
		const p = placeBubble({
			anchor: {x: 250, y: 400},
			mouth: {x: 200, y: 410},
			box: narrow,
			w: 400,
			h: 100,
			gap: 12,
			margin: 12
		});

		expect(p.side).toBe('below');
	});
});

describe('parseLinkText', () => {
	it('passes plain text straight through', () => {
		expect(parseLinkText('You should not have come back.')).toEqual([
			{kind: 'text', value: 'You should not have come back.'}
		]);
	});

	it('splits out a bare [[name]]', () => {
		expect(parseLinkText('Will you [[stay]] or [[go]]?')).toEqual([
			{kind: 'text', value: 'Will you '},
			{kind: 'link', name: 'stay', target: 'stay'},
			{kind: 'text', value: ' or '},
			{kind: 'link', name: 'go', target: 'go'},
			{kind: 'text', value: '?'}
		]);
	});

	it('understands all three Twine arrow spellings', () => {
		expect(parseLinkText('[[stay -> Tavern Fight]]')).toEqual([
			{kind: 'link', name: 'stay', target: 'Tavern Fight'}
		]);
		expect(parseLinkText('[[Tavern Fight <- stay]]')).toEqual([
			{kind: 'link', name: 'stay', target: 'Tavern Fight'}
		]);
		expect(parseLinkText('[[stay | Tavern Fight]]')).toEqual([
			{kind: 'link', name: 'stay', target: 'Tavern Fight'}
		]);
	});

	it('handles a link at either end of the text', () => {
		expect(parseLinkText('[[go]] now')).toEqual([
			{kind: 'link', name: 'go', target: 'go'},
			{kind: 'text', value: ' now'}
		]);
		expect(parseLinkText('now [[go]]')).toEqual([
			{kind: 'text', value: 'now '},
			{kind: 'link', name: 'go', target: 'go'}
		]);
	});

	it('leaves an unclosed bracket as text rather than eating the line', () => {
		expect(parseLinkText('a [[b')).toEqual([{kind: 'text', value: 'a [[b'}]);
	});
});

describe('DialogueLayer', () => {
	function setup(measure: MeasuringRenderer['measure'] = () => ({x: 400, y: 300})) {
		const mount = document.createElement('div');

		Object.defineProperty(mount, 'clientWidth', {value: 1600, configurable: true});
		Object.defineProperty(mount, 'clientHeight', {value: 900, configurable: true});
		document.body.appendChild(mount);

		const renderer: MeasuringRenderer = {
			measure,
			stageBox: () => ({left: 0, top: 0, width: 1600, height: 900})
		};

		const dialogue = new DialogueLayer();

		dialogue.mount(mount, renderer);

		return {mount, dialogue, renderer};
	}

	afterEach(() => document.body.replaceChildren());

	it('renders a bubble tagged with its speaker', () => {
		const {mount, dialogue} = setup();

		dialogue.say('mira', 'You shouldn\'t have come back.');

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		expect(bubble.dataset.speaker).toBe('mira');
		expect(bubble.textContent).toContain('come back');
	});

	it('reuses the bubble element for the same speaker', () => {
		const {mount, dialogue} = setup();

		dialogue.say('mira', 'One.');

		const first = mount.querySelector('.sliders-bubble');

		dialogue.say('mira', 'Two.');

		expect(mount.querySelector('.sliders-bubble')).toBe(first);
		expect(mount.querySelectorAll('.sliders-bubble')).toHaveLength(1);
	});

	it('turns [[links]] into real anchors and reports clicks', () => {
		const {mount, dialogue} = setup();
		const clicked: string[] = [];

		dialogue.onLink = name => clicked.push(name);
		dialogue.say('mira', 'Will you [[stay]] or [[go -> Street]]?');

		const links = [...mount.querySelectorAll('a.sliders-link')] as HTMLElement[];

		expect(links.map(a => a.dataset.slidersLink)).toEqual(['stay', 'go']);
		expect(links[1].dataset.slidersTarget).toBe('Street');
		expect(links[1].textContent).toBe('go');

		links[0].click();
		expect(clicked).toEqual(['stay']);
	});

	it('hands the click event to onLink, so a host can read its modifiers', () => {
		const {mount, dialogue} = setup();
		const events: (MouseEvent | undefined)[] = [];

		dialogue.onLink = (_name, _target, event) => events.push(event);
		dialogue.say('mira', 'Will you [[stay]]?');

		const link = mount.querySelector('a.sliders-link') as HTMLElement;

		link.dispatchEvent(
			new MouseEvent('click', {bubbles: true, ctrlKey: true})
		);

		expect(events[0]?.ctrlKey).toBe(true);
	});

	it('never injects markup from scene text', () => {
		const {mount, dialogue} = setup();

		dialogue.say('mira', '<img src=x onerror=boom>');

		expect(mount.querySelector('img')).toBeNull();
		expect(mount.querySelector('.sliders-bubble')!.textContent).toContain('<img');
	});

	it('renders narration in a bottom bar, links included', () => {
		const {mount, dialogue} = setup();

		dialogue.setBox('The candle gutters. [[wait]]');

		const box = mount.querySelector('.sliders-box') as HTMLElement;

		expect(box.textContent).toContain('The candle gutters.');
		expect(box.querySelector('a.sliders-link')!.textContent).toBe('wait');

		dialogue.setBox(null);
		expect(mount.querySelector('.sliders-box')).toBeNull();
	});

	it('places the bubble above the anchor, and below it when there is no room', () => {
		const {mount, dialogue} = setup(() => ({x: 800, y: 400}));

		dialogue.say('mira', 'Room above.');

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		expect(bubble.dataset.side).toBe('above');
		expect(bubble.dataset.anchored).toBe('true');

		// An anchor pinned to the very top of the box has nowhere to put a bubble above it.
		dialogue.mount(mount, {
			measure: () => ({x: 800, y: 0}),
			stageBox: () => ({left: 0, top: 0, width: 1600, height: 900})
		});
		dialogue.say('mira', 'No room above.');

		expect(
			(mount.querySelector('.sliders-bubble') as HTMLElement).dataset.side
		).toBe('below');
	});

	it('still shows the line when the speaker cannot be measured', () => {
		const {mount, dialogue} = setup(() => null);

		dialogue.say('nobody', 'Losing dialogue is worse than a stray bubble.');

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		expect(bubble.dataset.anchored).toBe('false');
		expect(bubble.textContent).toContain('stray bubble');
	});

	it('drops bubbles whose speakers stopped talking', () => {
		const {mount, dialogue} = setup();

		dialogue.setBubbles([
			{who: 'mira', text: 'a'},
			{who: 'joren', text: 'b'}
		]);
		expect(mount.querySelectorAll('.sliders-bubble')).toHaveLength(2);

		dialogue.setBubbles([{who: 'mira', text: 'a'}]);
		expect(mount.querySelectorAll('.sliders-bubble')).toHaveLength(1);

		dialogue.clear();
		expect(mount.querySelectorAll('.sliders-bubble')).toHaveLength(0);
	});

	it('repositions when the renderer says something moved', () => {
		const mount = document.createElement('div');
		let x = 400;
		const listeners: (() => void)[] = [];

		document.body.appendChild(mount);

		const dialogue = new DialogueLayer();

		dialogue.mount(mount, {
			measure: () => ({x, y: 300}),
			stageBox: () => ({left: 0, top: 0, width: 1600, height: 900}),
			subscribe: fn => {
				listeners.push(fn);

				return () => undefined;
			}
		});
		dialogue.say('mira', 'hi');

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;
		const before = bubble.style.transform;

		x = 1200;
		listeners.forEach(fn => fn());

		expect(bubble.style.transform).not.toBe(before);
		expect(bubble.style.transform).toContain('1200px');
	});
});
