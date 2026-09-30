import {storyColors} from '../story-colors';

const passages = (...texts: string[]) => texts.map(text => ({text}));

describe('storyColors', () => {
	it('finds hex, rgb and hsl literals across passages and the stylesheet', () => {
		expect(
			storyColors({
				passages: passages(
					'bubble: {bg: "#fdfdfb", color: rgba(0, 0, 0, 0.6)}',
					'sliders.bubble.accent: #F66'
				),
				stylesheet: '.x { color: hsl(10, 50%, 50%); }'
			})
		).toEqual(['#fdfdfb', 'rgba(0, 0, 0, 0.6)', '#F66', 'hsl(10, 50%, 50%)']);
	});

	it('orders by use, ties by first appearance, and counts spellings once', () => {
		expect(
			storyColors({
				passages: passages(
					'#111 #222',
					'#222 #333',
					'rgba(0,0,0,1) RGBA(0, 0, 0, 1) #333'
				)
			})
		).toEqual(['#222', '#333', 'rgba(0,0,0,1)', '#111']);
	});

	it('ignores entities, anchors inside words, headings and too-long hex', () => {
		expect(
			storyColors({
				passages: passages('&#123; foo#abc # heading #abcdefg #12345 #aa-bb')
			})
		).toEqual([]);
	});

	it('caps the list', () => {
		const texts = Array.from(
			{length: 30},
			(_, i) => `#${i.toString(16).padStart(6, '0')}`
		);

		expect(storyColors({passages: passages(...texts)}, 5)).toHaveLength(5);
	});
});
