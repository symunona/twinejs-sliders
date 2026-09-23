import {voiceTools} from '../../tools';
import {systemInstruction} from '../system-instruction';
import {
	audioMessage,
	base64FromBytes,
	bytesFromBase64,
	floatToPcm16Base64,
	imageTurnMessage,
	parseLiveMessage,
	pcm16Base64ToFloat,
	resample,
	setupMessage,
	textTurnMessage,
	toFunctionDeclaration,
	toolResponseMessage
} from '../protocol';

describe('setupMessage', () => {
	const setup = () =>
		(
			setupMessage({
				model: 'gemini-3.8-live',
				systemInstruction: 'be brief',
				tools: voiceTools
			}) as any
		).setup;

	it('prefixes the model with models/, which the API requires', () => {
		expect(setup().model).toBe('models/gemini-3.8-live');
	});

	it('asks for exactly one response modality — both is rejected', () => {
		expect(setup().generationConfig.responseModalities).toEqual(['AUDIO']);
	});

	it('turns on transcription both ways, because the transcript is the audit trail', () => {
		expect(setup().inputAudioTranscription).toBeDefined();
		expect(setup().outputAudioTranscription).toBeDefined();
	});

	it('declares every tool', () => {
		expect(setup().tools[0].functionDeclarations).toHaveLength(voiceTools.length);
	});

	it('omits thinkingConfig when the model has no thinking level — 3.8 Live rejects it', () => {
		expect(setup().generationConfig).not.toHaveProperty('thinkingConfig');
	});

	it('sends the thinking level when the model needs one', () => {
		expect(
			(
				setupMessage({
					model: 'gemini-3.8-live-extended-thinking',
					systemInstruction: '',
					thinkingLevel: 'low',
					tools: []
				}) as any
			).setup.generationConfig.thinkingConfig
		).toEqual({thinkingLevel: 'low'});
	});

	it('omits speechConfig entirely when no voice was named', () => {
		expect(setup().generationConfig.speechConfig).toBeUndefined();
	});
});

describe('toFunctionDeclaration', () => {
	it('keeps the parameter schema as written — the rename is the whole adapter', () => {
		const tool = voiceTools.find(candidate => candidate.name === 'read_passage')!;

		expect(toFunctionDeclaration(tool)).toEqual({
			description: tool.description,
			name: 'read_passage',
			parameters: tool.parameters
		});
	});

	it('does not leak our own `kind` field into the declaration', () => {
		expect(toFunctionDeclaration(voiceTools[0])).not.toHaveProperty('kind');
	});
});

describe('outbound messages', () => {
	it('labels microphone audio with the rate the API expects', () => {
		expect((audioMessage('AAA') as any).realtimeInput.audio).toEqual({
			data: 'AAA',
			mimeType: 'audio/pcm;rate=16000'
		});
	});

	it('marks a typed turn complete, or the model waits for more', () => {
		expect((textTurnMessage('hello') as any).clientContent.turnComplete).toBe(true);
	});

	it('sends an image as a user turn with its caption first', () => {
		const parts = (imageTurnMessage('AAA', 'image/png', 'the tavern') as any)
			.clientContent.turns[0].parts;

		expect(parts[0]).toEqual({text: 'the tavern'});
		expect(parts[1].inlineData).toEqual({data: 'AAA', mimeType: 'image/png'});
	});

	it('wraps a non-object tool response, which the API rejects bare', () => {
		const responses = (
			toolResponseMessage([{id: '1', name: 'map', response: 'done'}]) as any
		).toolResponse.functionResponses;

		expect(responses[0].response).toEqual({result: 'done'});
	});

	it('passes an object response through untouched', () => {
		const responses = (
			toolResponseMessage([{name: 'map', response: {ok: true}}]) as any
		).toolResponse.functionResponses;

		expect(responses[0].response).toEqual({ok: true});
	});
});

describe('parseLiveMessage', () => {
	it('reports setup completion', () => {
		expect(parseLiveMessage('{"setupComplete":{}}').setupComplete).toBe(true);
	});

	it('collects audio parts in order', () => {
		const event = parseLiveMessage(
			JSON.stringify({
				serverContent: {
					modelTurn: {
						parts: [
							{inlineData: {data: 'one', mimeType: 'audio/pcm'}},
							{inlineData: {data: 'two', mimeType: 'audio/pcm'}}
						]
					}
				}
			})
		);

		expect(event.audio).toEqual(['one', 'two']);
	});

	it('reads both transcriptions', () => {
		const event = parseLiveMessage(
			JSON.stringify({
				serverContent: {
					inputTranscription: {text: 'move mara left'},
					outputTranscription: {text: 'moving her'}
				}
			})
		);

		expect(event.inputText).toBe('move mara left');
		expect(event.outputText).toBe('moving her');
	});

	it('reports an interruption, which is what barge-in is made of', () => {
		expect(
			parseLiveMessage('{"serverContent":{"interrupted":true}}').interrupted
		).toBe(true);
	});

	it('reads function calls with their ids', () => {
		const event = parseLiveMessage(
			JSON.stringify({
				toolCall: {
					functionCalls: [{args: {ref: 'Tavern'}, id: 'c1', name: 'goto'}]
				}
			})
		);

		expect(event.calls).toEqual([{args: {ref: 'Tavern'}, id: 'c1', name: 'goto'}]);
	});

	it('defaults missing args to an empty object rather than undefined', () => {
		const event = parseLiveMessage(
			'{"toolCall":{"functionCalls":[{"id":"c1","name":"map"}]}}'
		);

		expect(event.calls[0].args).toEqual({});
	});

	it('reads a cancellation', () => {
		expect(
			parseLiveMessage('{"toolCallCancellation":{"ids":["c1","c2"]}}').cancelled
		).toEqual(['c1', 'c2']);
	});

	it('reads a turn that ends while the model is still reasoning', () => {
		const event = parseLiveMessage(
			JSON.stringify({
				serverContent: {interactionStatus: 'IN_PROGRESS', turnComplete: true}
			})
		);

		expect(event.turnComplete).toBe(true);
		expect(event.stillThinking).toBe(true);
	});

	it('turns goAway into an error the panel can show', () => {
		expect(parseLiveMessage('{"goAway":{"timeLeft":"5s"}}').error).toMatch(
			/about to close/
		);
	});

	it('survives a frame it has never seen — this protocol is in preview', () => {
		expect(() => parseLiveMessage('{"somethingNew":{"a":1}}')).not.toThrow();
		expect(parseLiveMessage('{"somethingNew":{"a":1}}').calls).toEqual([]);
	});

	it('survives a frame that is not JSON', () => {
		expect(parseLiveMessage('<html>502</html>').error).toMatch(/not JSON/);
	});

	it('survives a frame that is JSON but not an object', () => {
		expect(() => parseLiveMessage('[1,2,3]')).not.toThrow();
	});
});

describe('PCM', () => {
	it('round-trips samples through base64 PCM16', () => {
		const original = new Float32Array([0, 0.5, -0.5, 0.25]);
		const back = pcm16Base64ToFloat(floatToPcm16Base64(original));

		expect(back).toHaveLength(4);
		back.forEach((value, i) => expect(value).toBeCloseTo(original[i], 3));
	});

	it('does not wrap full scale to silence-with-a-click', () => {
		// 1.0 * 32768 overflows int16 to -32768: a full-scale click on every loud syllable.
		const back = pcm16Base64ToFloat(floatToPcm16Base64(new Float32Array([1])));

		expect(back[0]).toBeGreaterThan(0.99);
	});

	it('clamps samples past full scale instead of wrapping them', () => {
		const back = pcm16Base64ToFloat(
			floatToPcm16Base64(new Float32Array([2, -2]))
		);

		expect(back[0]).toBeGreaterThan(0.99);
		expect(back[1]).toBeCloseTo(-1, 3);
	});

	it('encodes little-endian, which is what the API reads', () => {
		// 0.5 -> 16383 -> 0xff 0x3f little-endian.
		const bytes = bytesFromBase64(floatToPcm16Base64(new Float32Array([0.5])));

		expect([...bytes]).toEqual([0xff, 0x3f]);
	});

	it('survives a buffer big enough to blow the stack on a spread', () => {
		const big = new Float32Array(200_000);

		expect(() => floatToPcm16Base64(big)).not.toThrow();
	});

	it('round-trips bytes through base64', () => {
		const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);

		expect([...bytesFromBase64(base64FromBytes(bytes))]).toEqual([...bytes]);
	});
});

describe('resample', () => {
	it('returns the same array when the rates match', () => {
		const samples = new Float32Array([1, 2, 3]);

		expect(resample(samples, 16_000, 16_000)).toBe(samples);
	});

	it('takes every third sample going 48k to 16k', () => {
		const samples = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);

		expect([...resample(samples, 48_000, 16_000)]).toEqual([0, 3, 6]);
	});

	it('never reads past the end of the input', () => {
		expect([...resample(new Float32Array([1, 2]), 48_000, 16_000)]).toEqual([1]);
	});
});

describe('systemInstruction', () => {
	const text = systemInstruction({sceneIds: ['tavern'], storyName: 'Trip'});

	it('names the story', () => {
		expect(text).toContain('"Trip"');
	});

	it('states the wake gate', () => {
		expect(text).toMatch(/addressed to you/);
		expect(text).toMatch(/not an instruction/);
	});

	it('requires a read before a write, because the runner enforces it anyway', () => {
		expect(text).toMatch(/read_passage/);
	});

	it('requires goto before an edit, so the author watches it land', () => {
		expect(text).toMatch(/goto/);
	});

	it('prefers the surgical writers over a whole-text rewrite', () => {
		expect(text).toMatch(/patch_scene/);
	});

	it('lists the scenes that exist, so naming one costs no tool call', () => {
		expect(text).toContain('tavern');
	});

	it('omits the scene line entirely when the story has no scenes', () => {
		expect(systemInstruction({sceneIds: [], storyName: 'Trip'})).not.toContain(
			'SCENES IN THIS STORY'
		);
	});
});
