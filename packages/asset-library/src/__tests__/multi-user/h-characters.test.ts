/**
 * @jest-environment node
 */
import {NameTakenError} from '../../transport';
import {png} from '../../testing/fixtures';
import {shaOf, team, upload} from '../../testing/scenario';
import {AssetRecord, CharacterRecord} from '../../types';

// H. Characters.

async function withCharacter() {
	const t = await team();
	const {world, ana, tavern} = t;
	const idle = await upload(ana, tavern.id, 'ana-char/idle', 'gold');
	const wave = await upload(ana, tavern.id, 'ana-char/wave', 'green');
	const character = ana.engine.putCharacter({
		collection: tavern.id,
		charId: 'ana-char',
		name: 'Ana',
		poses: {
			idle: {asset: idle.id},
			wave: {steps: [{asset: wave.id, dur: 200}, {asset: idle.id}]}
		}
	});

	await world.settle();

	return {...t, idle, wave, character};
}

describe('H. characters', () => {
	it('H1: a character with 2 poses reaches bo; pose assets exist there', async () => {
		const {bo, idle, wave, character} = await withCharacter();
		const got = bo.get<CharacterRecord>(character.id)!;

		expect(got).toMatchObject({charId: 'ana-char', name: 'Ana'});
		expect(got.poses!.idle.asset).toBe(idle.id);
		expect(got.poses!.wave.steps!.map(step => step.asset)).toEqual([
			wave.id,
			idle.id
		]);

		for (const id of [idle.id, wave.id]) {
			expect(bo.get<AssetRecord>(id)).toMatchObject({deleted: false});
		}

		bo.engine.createStory('S', {name: 'S'});
		bo.engine.bind('S', [character.collection]);
		expect(bo.engine.resolver('S').character('ana-char')!.id).toBe(
			character.id
		);
	});

	it('H2: repainting a pose image reaches bo', async () => {
		const {world, ana, bo, idle} = await withCharacter();

		await ana.engine.replaceBlob(idle.id, png('red'), 'image/png');
		await world.settle();

		expect(bo.get<AssetRecord>(idle.id)!.blob).toBe(await shaOf('red'));
	});

	it('H3: charId clashing with an asset name → name-taken', async () => {
		const {world, ana, bo, tavern} = await team();

		await upload(ana, tavern.id, 'stool', 'gold');
		await world.settle();

		expect(() =>
			bo.engine.putCharacter({collection: tavern.id, charId: 'stool'})
		).toThrow(NameTakenError);
		expect(() =>
			ana.engine.putCharacter({collection: tavern.id, charId: 'stool'})
		).toThrow(NameTakenError);

		// The same clash bo could not see: the server says name-taken, bo gets stool-2.
		bo.offline();
		await upload(ana, tavern.id, 'lamp', 'white');
		await world.settle();

		const lamp = bo.engine.putCharacter({
			collection: tavern.id,
			charId: 'lamp'
		});

		bo.isOnline = true;

		const mark = bo.mark();

		await bo.engine.flush();

		expect(bo.recordWrites(mark)[0]).toMatchObject({
			status: 409,
			code: 'name-taken'
		});
		expect(world.server.record('character', lamp.id)).toMatchObject({
			charId: 'lamp-2'
		});
		expect(bo.notices).toContainEqual(
			expect.objectContaining({
				kind: 'renamed-on-clash',
				type: 'character',
				from: 'lamp',
				to: 'lamp-2'
			})
		);
	});
});
