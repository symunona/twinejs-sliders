/**
 * The particle pack: white sprites on transparent, plus one ready emitter per preset, as
 * the shared collection `particles` on a library server. Run via the .mjs next to it:
 *
 *   node scripts/particle-pack.mjs [--out <dir>] [--dry-run] [--server URL --token T | --profile P]
 *
 * Sprites are DRAWN here, not stored: tweak a shape function, re-run, every story that
 * attached the collection gets the new pixels. White so an emitter's `color` tints them.
 * `--out` also writes the PNGs to a folder, to look at.
 *
 * Idempotent. An asset that exists by name gets new bytes (and, for an emitter, its
 * preset numbers) only when something changed.
 */

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {
	HttpTransport,
	LibraryEngine,
	MemoryBlobCache,
	MemoryLocalDb
} from '@sliders/asset-library';
import {DEFAULT_EMIT_BOX, EMIT_PRESETS} from '@sliders/scene-types';

const COLLECTION = 'particles';
const SIZE = 64;

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC = new Int32Array(256).map((_, n) => {
	let c = n;

	for (let k = 0; k < 8; k++) {
		c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	}

	return c;
});

function crc32(bytes: Uint8Array): number {
	let c = -1;

	for (const b of bytes) {
		c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
	}

	return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
	const out = Buffer.alloc(12 + data.length);

	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, 'ascii');
	out.set(data, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);

	return out;
}

/** RGBA, white, alpha from `shape(x, y)` with x, y in -1..1. 4x supersampled. */
function png(shape: (x: number, y: number) => number): Uint8Array {
	const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);

	for (let py = 0; py < SIZE; py++) {
		raw[py * (SIZE * 4 + 1)] = 0;

		for (let px = 0; px < SIZE; px++) {
			let sum = 0;

			for (let sy = 0; sy < 4; sy++) {
				for (let sx = 0; sx < 4; sx++) {
					const x = ((px + (sx + 0.5) / 4) / SIZE) * 2 - 1;
					const y = ((py + (sy + 0.5) / 4) / SIZE) * 2 - 1;

					sum += Math.min(1, Math.max(0, shape(x, y)));
				}
			}

			const o = py * (SIZE * 4 + 1) + 1 + px * 4;

			raw[o] = raw[o + 1] = raw[o + 2] = 255;
			raw[o + 3] = Math.round((sum / 16) * 255);
		}
	}

	const head = Buffer.alloc(13);

	head.writeUInt32BE(SIZE, 0);
	head.writeUInt32BE(SIZE, 4);
	head[8] = 8;
	head[9] = 6;

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', head),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', new Uint8Array(0))
	]);
}

// ---------------------------------------------------------------------------
// Shapes. x, y in -1..1, y down. Return alpha 0..1.
// ---------------------------------------------------------------------------

const soft = (d: number, edge = 0.08) => Math.min(1, Math.max(0, (1 - d) / edge));

function hash2(x: number, y: number): number {
	const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;

	return s - Math.floor(s);
}

function noise(x: number, y: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const u = fx * fx * (3 - 2 * fx);
	const v = fy * fy * (3 - 2 * fy);
	const a = hash2(ix, iy);
	const b = hash2(ix + 1, iy);
	const c = hash2(ix, iy + 1);
	const d = hash2(ix + 1, iy + 1);

	return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function starShape(x: number, y: number, points: number, inner: number): number {
	const r = Math.hypot(x, y);
	const a = Math.atan2(y, x) + Math.PI / 2;
	const seg = (Math.PI * 2) / points;
	const t = Math.abs(((((a % seg) + seg) % seg) / seg) * 2 - 1);
	const edge = inner + (0.9 - inner) * t ** 1.5;

	return soft(r / edge, 0.12);
}

export const SPRITES: Record<string, {desc: string; shape: (x: number, y: number) => number}> = {
	'p-dot': {desc: 'soft round dot', shape: (x, y) => (1 - Math.min(1, Math.hypot(x, y))) ** 2},
	'p-glow': {
		desc: 'wide faint halo',
		shape: (x, y) => Math.exp(-(x * x + y * y) * 4) * (1 - Math.min(1, Math.hypot(x, y)))
	},
	'p-flame': {
		desc: 'teardrop flame tongue, point up',
		shape: (x, y) => {
			const cy = 0.35;
			const r = 0.5;
			let d: number;

			if (y >= cy) {
				d = Math.hypot(x, y - cy) / r;
			} else {
				const t = (y + 0.95) / (cy + 0.95);

				d = t <= 0 ? 2 : Math.abs(x) / (r * t ** 1.4);
			}

			return (1 - Math.min(1, d)) ** 0.8 * Math.min(1, (y + 0.95) * 2);
		}
	},
	'p-puff': {
		desc: 'lumpy smoke puff',
		shape: (x, y) => {
			const n = noise(x * 3 + 10, y * 3 + 10) * 0.6 + noise(x * 7, y * 7) * 0.4;
			const d = Math.hypot(x, y) / (0.65 + 0.3 * n);

			return (1 - Math.min(1, d)) ** 1.2 * (0.55 + 0.45 * n);
		}
	},
	'p-spark': {
		desc: 'four-point glint',
		shape: (x, y) => {
			const ax = Math.abs(x);
			const ay = Math.abs(y);
			const rays =
				Math.exp(-ax * 14) * Math.exp(-ay * 2.4) + Math.exp(-ay * 14) * Math.exp(-ax * 2.4);

			return rays + Math.exp(-(x * x + y * y) * 30);
		}
	},
	'p-star': {desc: 'five-point star', shape: (x, y) => starShape(x, y, 5, 0.38)},
	'p-flake': {
		desc: 'six-arm snowflake',
		shape: (x, y) => {
			const r = Math.hypot(x, y);
			let best = 0;

			for (let k = 0; k < 6; k++) {
				const a = (k * Math.PI) / 3;
				const along = x * Math.cos(a) + y * Math.sin(a);
				const across = Math.abs(-x * Math.sin(a) + y * Math.cos(a));

				if (along > 0 && along < 0.9) {
					best = Math.max(best, soft(across / 0.07, 0.5));

					// Two side twigs per arm.
					for (const at of [0.45, 0.7]) {
						const bx = along - at;
						const twig = Math.abs(across - bx * 0.9);

						if (bx > 0 && bx < 0.2) {
							best = Math.max(best, soft(twig / 0.05, 0.5));
						}
					}
				}
			}

			return r < 0.95 ? best : 0;
		}
	},
	'p-ring': {
		desc: 'thin soft ring',
		shape: (x, y) => soft(Math.abs(Math.hypot(x, y) - 0.72) / 0.14, 0.6)
	},
	'p-pixel': {
		desc: 'hard square, for pixel-art dust',
		shape: (x, y) => (Math.abs(x) < 0.6 && Math.abs(y) < 0.6 ? 1 : 0)
	},
	'p-drop': {
		desc: 'vertical streak, for rain',
		shape: (x, y) => soft(Math.hypot(x / 0.12, y / 0.95), 0.4)
	},
	'p-leaf': {
		desc: 'almond leaf with a midrib',
		shape: (x, y) => {
			const u = (x - y) / Math.SQRT2;
			const v = (x + y) / Math.SQRT2;
			const half = 0.38 * (1 - (u / 0.9) ** 2);
			const body = half > 0 ? soft(Math.abs(v) / half, 0.25) : 0;
			const rib = Math.abs(v) < 0.025 && Math.abs(u) < 0.85 ? 0.45 : 1;

			return body * rib;
		}
	}
};

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

interface Args {
	out?: string;
	dryRun: boolean;
	server?: string;
	token?: string;
	profile?: string;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {dryRun: false};

	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case '--out':
				args.out = argv[++i];
				break;
			case '--dry-run':
				args.dryRun = true;
				break;
			case '--server':
				args.server = argv[++i];
				break;
			case '--token':
				args.token = argv[++i];
				break;
			case '--profile':
				args.profile = argv[++i];
				break;
			case '-h':
			case '--help':
				console.log(
					'particle-pack [--out dir] [--dry-run] [--server URL --token T | --profile P]'
				);
				process.exit(0);
				break;
			default:
				throw new Error(`unknown argument ${argv[i]}`);
		}
	}

	return args;
}

function target(args: Args): {server: string; token: string} {
	let server = args.server ?? process.env.LIB_SERVER_URL;
	let token = args.token ?? process.env.LIB_TOKEN;

	if (!server || !token) {
		const config = JSON.parse(
			readFileSync(join(homedir(), '.config/twine-cli/config.json'), 'utf8')
		);
		const profile = config.profiles?.[args.profile ?? config.profile ?? 'live'];

		server = server ?? profile?.server;
		token = token ?? profile?.token;
	}

	if (!server || !token) {
		throw new Error('no server/token: --server/--token, LIB_SERVER_URL/LIB_TOKEN or a twine-cli profile');
	}

	return {server, token};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const pngs = Object.fromEntries(
		Object.entries(SPRITES).map(([name, {shape}]) => [name, png(shape)])
	);

	if (args.out) {
		mkdirSync(args.out, {recursive: true});

		for (const [name, bytes] of Object.entries(pngs)) {
			writeFileSync(join(args.out, `${name}.png`), bytes);
		}

		console.log(`wrote ${Object.keys(pngs).length} sprites to ${args.out}`);
	}

	if (args.dryRun) {
		return;
	}

	const {server, token} = target(args);
	const engine = new LibraryEngine({
		blobs: new MemoryBlobCache(),
		clientName: 'particle-pack',
		db: new MemoryLocalDb(),
		debounceMs: 60_000,
		transport: new HttpTransport(server, token, 'particle-pack')
	});

	await engine.start();
	await engine.sync();

	const collection =
		engine.collectionByName(COLLECTION) ??
		engine.createCollection({
			description: 'Particle sprites (white, tint with color) and ready emitters.',
			kind: 'shared',
			name: COLLECTION
		});
	const existing = new Map(engine.assets(collection.id).map(a => [a.name, a]));
	const { createHash } = await import('node:crypto');
	const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
	const items = [
		...Object.entries(SPRITES).map(([name, sprite]) => ({
			bytes: pngs[name],
			kind: 'object' as const,
			name,
			recipe: undefined as Record<string, unknown> | undefined,
			tags: ['particle-sprite']
		})),
		...Object.entries(EMIT_PRESETS).map(([name, preset]) => ({
			bytes: pngs[preset.texture],
			kind: 'fx' as const,
			name,
			recipe: {
				particles: {...preset.params, box: preset.box ?? DEFAULT_EMIT_BOX},
				...(preset.origin ? {origin: preset.origin} : {})
			},
			tags: ['particles']
		}))
	];

	for (const item of items) {
		const found = existing.get(item.name);

		if (!found) {
			await engine.addAsset(item.bytes, 'image/png', {
				allowDuplicate: true,
				collection: collection.id,
				h: SIZE,
				kind: item.kind,
				name: item.name,
				tags: item.tags,
				w: SIZE,
				...(item.recipe ? {recipe: item.recipe} : {})
			});
			console.log(`+ ${item.name}`);
			continue;
		}

		if (found.blob !== sha(item.bytes)) {
			await engine.replaceBlob(found.id, item.bytes, 'image/png');
			console.log(`~ ${item.name} bytes`);
		}

		if (
			item.recipe &&
			(JSON.stringify(found.recipe?.particles) !== JSON.stringify(item.recipe.particles) ||
				JSON.stringify(found.recipe?.origin) !== JSON.stringify(item.recipe.origin))
		) {
			engine.updateAsset(found.id, {recipe: item.recipe});
			console.log(`~ ${item.name} emitter`);
		}
	}

	await engine.flush();
	await engine.idle();

	const status = engine.status();

	await engine.dispose();
	console.log(`collection ${COLLECTION}: pending ${status.pending}, conflicts ${status.conflicts}`);

	if (status.pending || status.conflicts) {
		process.exitCode = 1;
	}
}

main().catch(error => {
	console.error(`particle-pack: ${(error as Error).message}`);
	process.exit(2);
});
