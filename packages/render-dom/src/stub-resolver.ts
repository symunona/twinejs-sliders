/**
 * An in-memory {@link AssetResolver} that invents an asset for any id you ask for.
 *
 * Used by the harness and by tests so `render-dom` can be exercised with no asset store, no
 * twinejs and no network. Every id resolves to a solid-colour SVG data URI labelled with the
 * id, so a screenshot tells you immediately which sprite is which — and ids listed in
 * `missing` resolve to nothing, which is how the placeholder path gets exercised.
 */

import type {
	AssetKind,
	AssetMeta,
	AssetResolver,
	Character,
	Frac2
} from '@sliders/scene-types';

export interface StubAssetSpec {
	w?: number;
	h?: number;
	kind?: AssetKind;
	/** Any CSS colour. Defaults to a stable colour derived from the id. */
	color?: string;
	animated?: boolean;
}

export interface StubResolverOptions {
	/** Extra or overriding characters, merged over the canned cast. */
	characters?: Record<string, Partial<Character>>;
	/** Drop the canned mira/joren cast. */
	includeDefaultCast?: boolean;
	/** Explicit sizes/colours for particular asset ids. */
	assets?: Record<string, StubAssetSpec>;
	/**
	 * Ids that must NOT resolve — `url()` and `meta()` return undefined, and a character id
	 * here is unknown. This is how you test the labelled-placeholder path.
	 */
	missing?: string[];
	/** Draw the id as a label inside the generated image. Default true. */
	label?: boolean;
}

export interface StubResolver extends AssetResolver {
	/** Everything the stub currently knows about. Handy for harness UI. */
	characterIds(): string[];
	/** Register (or replace) an asset spec at runtime. */
	define(id: string, spec: StubAssetSpec): void;
}

const DEFAULT_ANCHORS: Record<string, Frac2> = {
	bubble: {x: 0.62, y: 0.18},
	mouth: {x: 0.5, y: 0.22},
	head: {x: 0.5, y: 0.12},
	hand: {x: 0.78, y: 0.52}
};

function character(
	id: string,
	name: string,
	frames: string[],
	overrides: Partial<Character> = {}
): Character {
	return {
		id,
		name,
		size: {w: 512, h: 1024},
		origin: {x: 0.5, y: 1},
		anchors: {...DEFAULT_ANCHORS},
		frames: Object.fromEntries(
			frames.map(frame => [frame, {asset: `a_${id}_${frame}`}])
		),
		tags: ['stub'],
		...overrides
	};
}

/** The canned cast. Two characters is enough to see layering, flip and bubbles work. */
export function defaultStubCast(): Record<string, Character> {
	return {
		mira: character('mira', 'Mira', ['idle', 'arms-crossed', 'angry', 'wave']),
		joren: character('joren', 'Joren', ['idle', 'angry'], {
			size: {w: 600, h: 1024},
			anchors: {...DEFAULT_ANCHORS, bubble: {x: 0.38, y: 0.16}}
		})
	};
}

export function createStubResolver(
	options: StubResolverOptions = {}
): StubResolver {
	const characters: Record<string, Character> = {
		...(options.includeDefaultCast === false ? {} : defaultStubCast())
	};

	for (const [id, patch] of Object.entries(options.characters ?? {})) {
		characters[id] = {
			...character(id, patch.name ?? id, ['idle']),
			...patch,
			id
		} as Character;
	}

	const assets = new Map<string, StubAssetSpec>(
		Object.entries(options.assets ?? {})
	);
	const missing = new Set(options.missing ?? []);
	const label = options.label !== false;
	const urls = new Map<string, string>();

	function specFor(id: string): StubAssetSpec {
		const explicit = assets.get(id);

		if (explicit) {
			return explicit;
		}

		// Heuristics so the harness can name assets naturally without registering them.
		if (/(^|[/_-])bg([/_-]|$)/.test(id)) {
			return {w: 1920, h: 1080, kind: 'bg'};
		}

		for (const char of Object.values(characters)) {
			for (const frame of Object.values(char.frames ?? {})) {
				if (frame.asset === id) {
					return {w: char.size.w, h: char.size.h, kind: 'frame'};
				}
			}
		}

		return {w: 256, h: 256, kind: 'object'};
	}

	return {
		async url(id) {
			if (missing.has(id)) {
				return undefined;
			}

			const cached = urls.get(id);

			if (cached) {
				return cached;
			}

			const spec = specFor(id);
			const made = svgDataUri(
				id,
				spec.w ?? 256,
				spec.h ?? 256,
				spec.color ?? colorFor(id),
				spec.kind ?? 'object',
				label
			);

			urls.set(id, made);

			return made;
		},

		async meta(id): Promise<AssetMeta | undefined> {
			if (missing.has(id)) {
				return undefined;
			}

			const spec = specFor(id);

			return {
				id,
				name: id,
				kind: spec.kind ?? 'object',
				tags: ['stub'],
				animated: !!spec.animated,
				w: spec.w ?? 256,
				h: spec.h ?? 256,
				bytes: 0,
				hash: `stub-${id}`,
				mime: 'image/svg+xml'
			};
		},

		async character(id) {
			if (missing.has(id)) {
				return undefined;
			}

			return characters[id];
		},

		characterIds() {
			return Object.keys(characters);
		},

		define(id, spec) {
			assets.set(id, spec);
			urls.delete(id);
		}
	};
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

/** Stable hue per id, so the same sprite is the same colour across runs and screenshots. */
export function colorFor(id: string): string {
	let hash = 0;

	for (let i = 0; i < id.length; i++) {
		hash = (hash * 31 + id.charCodeAt(i)) | 0;
	}

	const hue = Math.abs(hash) % 360;

	return `hsl(${hue} 62% 52%)`;
}

function svgDataUri(
	id: string,
	w: number,
	h: number,
	color: string,
	kind: AssetKind,
	label: boolean
): string {
	const fontSize = Math.max(14, Math.round(Math.min(w, h) / 12));
	const parts: string[] = [
		`<rect width="${w}" height="${h}" fill="${color}"/>`
	];

	if (kind === 'bg') {
		// A horizon line makes it obvious which way is up in a screenshot.
		parts.push(
			`<rect y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="rgba(0,0,0,0.35)"/>`,
			`<circle cx="${w * 0.78}" cy="${h * 0.22}" r="${h * 0.09}" fill="rgba(255,255,255,0.5)"/>`
		);
	} else {
		parts.push(
			`<rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="none" stroke="rgba(0,0,0,0.45)" stroke-width="3"/>`,
			// A head blob, so "up" and the feet origin are unmistakable.
			`<circle cx="${w / 2}" cy="${h * 0.12}" r="${Math.min(w, h) * 0.16}" fill="rgba(255,255,255,0.55)"/>`,
			// Origin marker: the bottom-centre notch that should sit on the scene point.
			`<polygon points="${w / 2 - w * 0.06},${h} ${w / 2 + w * 0.06},${h} ${w / 2},${h - h * 0.05}" fill="rgba(0,0,0,0.6)"/>`
		);
	}

	if (label) {
		parts.push(
			`<text x="${w / 2}" y="${h * 0.5}" fill="rgba(255,255,255,0.92)" font-family="system-ui,sans-serif" font-size="${fontSize}" font-weight="600" text-anchor="middle">${escapeXml(
				id
			)}</text>`
		);
	}

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join(
		''
	)}</svg>`;

	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(text: string): string {
	return text.replace(/[<>&'"]/g, ch =>
		ch === '<'
			? '&lt;'
			: ch === '>'
				? '&gt;'
				: ch === '&'
					? '&amp;'
					: ch === "'"
						? '&apos;'
						: '&quot;'
	);
}
