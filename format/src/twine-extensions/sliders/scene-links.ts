/**
 * Pulling passage names out of a scene — its `links:` block and every clickable entity's
 * `link:` — for Twine's story map.
 *
 * The scanner itself lives in `@sliders/scene-schema` — one `links:` grammar, read the
 * same way by this format's `parse-references.ts`, by the editor and by twine-cli's `map`
 * and `lint`. There used to be a second hand-rolled copy here, which is exactly how the
 * story map and the CLI drift apart.
 *
 * `vite.extensions.config.js` aliases the `@sliders` scope onto `../packages`, the same
 * way the runtime config does, so the bundled format compiles the package's own source
 * rather than a stale build.
 */

export {sceneEntityLinkTargets, sceneLinkTargets} from '@sliders/scene-schema';
