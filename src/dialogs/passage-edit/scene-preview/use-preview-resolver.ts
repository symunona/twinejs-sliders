import * as React from 'react';
import {AssetStore} from '@sliders/asset-store';
import {AssetId, AssetMeta, AssetResolver, Character} from '@sliders/scene-types';
import {slidersAssetStore} from '../../sliders-assets/asset-store-context';

/**
 * Bridges the gap between how authors write scenes and how the store keys things.
 *
 * Scene YAML refers to assets by NAME (`bg: tavern-night`), because ids like `a_8f21` are
 * unwritable. The store keys by id. This resolver accepts either: it tries the id first,
 * then falls back to a name lookup.
 */
export function createNamedResolver(store: AssetStore): AssetResolver & {
	invalidate: () => void;
} {
	let byName: Map<string, AssetMeta> | undefined;
	let loading: Promise<Map<string, AssetMeta>> | undefined;

	async function index(): Promise<Map<string, AssetMeta>> {
		if (byName) {
			return byName;
		}

		if (!loading) {
			loading = store.list({includeFrames: true}).then(all => {
				byName = new Map(all.map(asset => [asset.name, asset]));
				loading = undefined;
				return byName;
			});
		}

		return loading;
	}

	async function resolveMeta(key: string): Promise<AssetMeta | undefined> {
		const direct = await store.meta(key);

		if (direct) {
			return direct;
		}

		return (await index()).get(key);
	}

	return {
		invalidate() {
			byName = undefined;
		},
		async url(key: AssetId) {
			const meta = await resolveMeta(key);

			return meta ? store.url(meta.id) : undefined;
		},
		async meta(key: AssetId) {
			return resolveMeta(key);
		},
		async character(id: string): Promise<Character | undefined> {
			return store.character(id);
		}
	};
}

/**
 * A resolver for the passage preview.
 *
 * Stable across renders — the renderer is mounted once and must not be torn down when
 * the passage text changes (spec 06).
 */
export function usePreviewResolver(): AssetResolver {
	const resolver = React.useMemo(
		() => createNamedResolver(slidersAssetStore()),
		[]
	);

	// Uploads happen in another dialog, so drop the name index when the window regains
	// focus rather than trying to observe the store.
	React.useEffect(() => {
		const onFocus = () => resolver.invalidate();

		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [resolver]);

	return resolver;
}
