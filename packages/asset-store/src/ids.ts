import type {AssetId, SidecarKind} from '@sliders/scene-types';

const ID_ALPHABET = '0123456789abcdef';
const ID_LENGTH = 4;

/**
 * A sidecar kind is a slug. It ends up as a filename on both sides of the wire, and it
 * must stay clear of the `a_` + hex shape an asset id has.
 */
const SIDECAR_KIND = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Where an asset's extra blobs live: `a_8f21.src`, `a_8f21.cutout`.
 *
 * The kind IS the suffix. The key used to be `#` plus a two-name mapping table, and both
 * halves were wrong: a table between the manifest's word and the blob's drifts, and `#`
 * is rejected by the sync server's `ValidID` (`server/store/store.go`, which allows
 * `[A-Za-z0-9._-]`), so a sidecar stored under one could never be pushed anywhere. `.`
 * passes that pattern as it stands, so syncing costs the server no change.
 *
 * Backends key blobs by an opaque string, so a sidecar needs nothing new from them, and
 * nothing can collide: `randomAssetId` emits `a_` and hex, and every name that reaches a
 * key is slugged to `[a-z0-9/_-]` — neither can contain a dot.
 */
export function sidecarKey(id: AssetId, kind: SidecarKind): string {
	// Loud, because the alternative is a blob under a key the server will later refuse,
	// discovered a release after the kind was added.
	if (!SIDECAR_KIND.test(kind)) {
		throw new Error(
			`"${kind}" is not a usable sidecar kind: it must be a slug like "cutout".`
		);
	}

	return `${id}.${kind}`;
}

function webCrypto(): Crypto {
	const crypto = globalThis.crypto;

	if (!crypto) {
		throw new Error('This environment has no Web Crypto implementation.');
	}

	return crypto;
}

/**
 * A short random asset id, e.g. `a_8f21` (spec 03). Ids are identity, not content — a file
 * re-uploaded after an edit keeps its id, which is why the content hash is stored
 * separately.
 */
export function randomAssetId(): AssetId {
	const bytes = new Uint8Array(ID_LENGTH);

	webCrypto().getRandomValues(bytes);

	let id = 'a_';

	for (const byte of bytes) {
		id += ID_ALPHABET[byte % ID_ALPHABET.length];
	}

	return id;
}

/** Random id that doesn't collide with anything already in use. */
export function uniqueAssetId(taken: Iterable<AssetId>): AssetId {
	const used = new Set(taken);

	// The id space is 65,536 wide. Widen the id rather than spin forever if a library ever
	// gets big enough for that to matter.

	for (let attempt = 0; attempt < 64; attempt++) {
		const id = randomAssetId();

		if (!used.has(id)) {
			return id;
		}
	}

	let id = randomAssetId() + randomAssetId().slice(2);

	while (used.has(id)) {
		id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
	}

	return id;
}

/** SHA-256 of the file bytes, hex encoded. Used to warn about duplicate uploads. */
export async function contentHash(
	source: ArrayBuffer | Uint8Array
): Promise<string> {
	const subtle = webCrypto().subtle;

	if (!subtle) {
		throw new Error(
			'This environment has no SubtleCrypto. Asset hashing requires a secure context.'
		);
	}

	const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
	// Copy into a standalone buffer: a Uint8Array view may not span its whole buffer.
	const buffer = new Uint8Array(bytes).buffer;
	const digest = await subtle.digest('SHA-256', buffer);

	return Array.from(new Uint8Array(digest))
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Turns a filename into an asset name. `Tavern Night.png` becomes `tavern-night`; folder
 * separators survive, because names like `tavern/night` are the convention in spec 03.
 */
export function nameFromFilename(filename: string): string {
	const withoutExtension = filename.replace(/\.[^./\\]+$/, '');

	return (
		withoutExtension
			.replace(/\\/g, '/')
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9/_-]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '') || 'untitled'
	);
}

/** Slug suitable for a character id or a YAML key. */
export function slugify(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '') || 'untitled'
	);
}

/**
 * `base`, or `base-2`, `base-3`, … until one is free.
 *
 * Scene YAML names assets by NAME and characters by ID, and looks both up in one flat
 * namespace (`createNamedResolver`). So two assets called `lamp`, or an asset called `mira`
 * next to a character `mira`, is not a cosmetic clash: one of them becomes unaddressable
 * and the resolver's name index silently keeps whichever it saw last.
 *
 * Numbered rather than suffixed with the id, because the result is something an author has
 * to type into a scene. `-2` is the first suffix, since `lamp` already IS the first one.
 */
export function uniqueName(base: string, taken: Set<string>): string {
	if (!taken.has(base)) {
		return base;
	}

	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;

		if (!taken.has(candidate)) {
			return candidate;
		}
	}
}
