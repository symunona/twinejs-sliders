/**
 * @jest-environment node
 */
import {isSha} from '../../hash';
import {NameTakenError} from '../../transport';
import {mulberry32, png, seededUuid} from '../../testing/fixtures';
import {upload} from '../../testing/scenario';
import {Browser, World} from '../../testing/world';
import {
	AssetRecord,
	LibRecord,
	RECORD_TYPES,
	recordBlobs,
	recordKey
} from '../../types';

// I. Convergence (property): seeded random ops over 3 browsers, random offline windows
// and reloads. After a final settle and resolving every conflict with "theirs", everyone
// agrees with the server and nothing acknowledged-free was silently lost.

const NAMES = ['stool', 'lamp', 'night', 'door', 'rug', 'bar', 'crate', 'sign'];
const RECIPE_KEYS = ['effect', 'mask', 'edits'];
const STUCK = new Set([
	'conflict',
	'blob-lost',
	'rejected',
	'collection-missing'
]);

/** Seeds that once failed get pinned here as fixed cases. */
const PINNED_SEEDS = [1, 7, 42, 1337, 20260928];

/** `LIB_FUZZ=500 npx jest i-convergence` runs 500 more seeds from 100000 up. */
const FUZZ = Number(process.env.LIB_FUZZ ?? 0);
const SEEDS = [
	...PINNED_SEEDS,
	...Array.from({length: FUZZ}, (_, i) => 100000 + i)
];

interface Outcome {
	settlePasses: number[];
	conflicts: number;
	ops: Record<string, number>;
}

async function converge(seed: number, steps = 200): Promise<Outcome> {
	const random = mulberry32(seed);
	const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
	const [world, ...browsers] = await World.create(['ana', 'bo', 'cy'], {
		newId: seededUuid(mulberry32(seed ^ 0x5eed))
	});
	const [ana] = browsers;
	const sets = [
		ana.engine.createCollection({name: 'set-a'}),
		ana.engine.createCollection({name: 'set-b'})
	];
	const settlePasses: number[] = [];
	const ops: Record<string, number> = {};
	const tagAdds: {browser: Browser; id: string; tag: string}[] = [];
	const creates: {browser: Browser; id: string}[] = [];
	const unborn = new Set<string>(); // created and deleted before the server saw it

	settlePasses.push(await world.settle());

	const liveAssets = (browser: Browser): AssetRecord[] =>
		browser.engine.assets().sort((a, b) => (a.id < b.id ? -1 : 1));

	for (let step = 0; step < steps; step++) {
		const browser = pick(browsers);
		const roll = random();
		const assets = liveAssets(browser);
		const target = assets.length ? pick(assets) : undefined;
		let op: string;

		if (roll < 0.15 || !target) {
			op = 'create';
			const asset = await upload(
				browser,
				pick(sets).id,
				pick(NAMES),
				1000 + step
			);

			creates.push({browser, id: asset.id});
		} else if (roll < 0.38) {
			op = 'tag';
			const tag = `t${step}`;

			browser.engine.updateAsset(target.id, {
				tags: [...(target.tags ?? []), tag]
			});
			tagAdds.push({browser, id: target.id, tag});
		} else if (roll < 0.46) {
			op = 'rename';
			try {
				browser.engine.rename(target.id, pick(NAMES));
			} catch (error) {
				if (!(error instanceof NameTakenError)) throw error;
			}
		} else if (roll < 0.53) {
			op = 'delete';
			if (!browser.engine.state(target.id)!.base) {
				unborn.add(target.id);
			}
			browser.engine.delete(target.id);
		} else if (roll < 0.64) {
			op = 'repaint';
			await browser.engine.replaceBlob(
				target.id,
				png(5000 + step),
				'image/png'
			);
		} else if (roll < 0.7) {
			op = 'recipe';
			browser.engine.updateAsset(target.id, {
				recipe: {[pick(RECIPE_KEYS)]: {step}}
			});
		} else if (roll < 0.76) {
			op = 'move';
			const to = sets.find(set => set.id !== target.collection)!;

			try {
				browser.engine.move(target.id, to.id);
			} catch (error) {
				if (!(error instanceof NameTakenError)) throw error;
			}
		} else if (roll < 0.84) {
			op = browser.isOnline ? 'offline' : 'online';
			if (browser.isOnline) {
				browser.offline();
			} else {
				await browser.online();
			}
		} else if (roll < 0.89) {
			op = 'reload';
			await browser.reload();
		} else if (roll < 0.95) {
			op = 'tick';
			world.clock.advance(1000);
			await world.idle();
			await world.deliver();
		} else {
			op = 'settle';
			settlePasses.push(await world.settle());
		}

		ops[op] = (ops[op] ?? 0) + 1;
	}

	for (const browser of browsers) {
		if (!browser.isOnline) {
			await browser.online();
		}
	}

	settlePasses.push(await world.settle());

	let conflicts = 0;

	for (let round = 0; round < 10; round++) {
		let resolved = 0;

		for (const browser of browsers) {
			for (const conflict of browser.engine.conflicts()) {
				browser.engine.resolve(conflict.id, 'theirs', conflict.type);
				resolved++;
			}
		}

		settlePasses.push(await world.settle());
		conflicts += resolved;

		if (!resolved) {
			break;
		}
	}

	// ---- every browser == server ------------------------------------------

	const server = new Map<string, LibRecord>(
		world.server
			.allRecords()
			.map(record => [recordKey(record.type, record.id), record])
	);

	for (const browser of browsers) {
		expect(browser.engine.status()).toEqual({
			pending: 0,
			conflicts: 0,
			offline: false
		});

		const local = new Map<string, LibRecord>();

		for (const type of RECORD_TYPES) {
			for (const record of browser.engine.list(type, {includeDeleted: true})) {
				local.set(recordKey(record.type, record.id), record);
				expect(browser.engine.state(record.id, record.type)!.dirty).toBe(false);
			}
		}

		expect([...local.keys()].sort()).toEqual([...server.keys()].sort());

		for (const [key, record] of server) {
			expect({key, record: local.get(key)}).toEqual({key, record});
		}
	}

	// ---- every blob any record names is on the server ---------------------

	for (const record of server.values()) {
		for (const sha of recordBlobs(record)) {
			expect(isSha(sha)).toBe(true);
			expect({sha, on: world.server.hasBlob(sha)}).toEqual({sha, on: true});
		}
	}

	// ---- nothing lost without a conflict to show for it -------------------

	const stuck = new Set<string>();

	for (const browser of browsers) {
		for (const notice of browser.notices) {
			if (STUCK.has(notice.kind) && 'id' in notice) {
				stuck.add(`${browser.name}:${notice.id}`);
			}
		}
	}

	for (const {id} of creates) {
		if (!unborn.has(id)) {
			expect({id, onServer: server.has(recordKey('asset', id))}).toEqual({
				id,
				onServer: true
			});
		}
	}

	for (const {browser, id, tag} of tagAdds) {
		if (stuck.has(`${browser.name}:${id}`) || unborn.has(id)) {
			continue;
		}

		const tags =
			(server.get(recordKey('asset', id)) as AssetRecord | undefined)?.tags ??
			[];

		expect({id, tag, kept: tags.includes(tag)}).toEqual({id, tag, kept: true});
	}

	// Invariant 1, observed: no record PUT ever reached the server ahead of its blob.
	for (const browser of browsers) {
		expect(browser.requests.filter(r => r.code === 'blob-missing')).toEqual([]);
	}

	return {settlePasses, conflicts, ops};
}

describe('I. convergence', () => {
	it.each(SEEDS)('seed %i: 200 ops over 3 browsers converge', async seed => {
		const outcome = await converge(seed);

		expect(Math.max(...outcome.settlePasses)).toBeLessThanOrEqual(12);
		// The run exercised what it claims to.
		expect(Object.keys(outcome.ops).sort()).toEqual(
			expect.arrayContaining([
				'create',
				'delete',
				'move',
				'offline',
				'reload',
				'rename',
				'repaint',
				'tag'
			])
		);
	});
});
