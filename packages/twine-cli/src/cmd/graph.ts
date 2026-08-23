/**
 * `graph <story> [--format tree|dot|jsonl] [--from <passage>] [--depth n]` — spec 12 §1.
 *
 * The link graph as the PLAYER can walk it, which is not always the graph Twine's editor
 * draws. A `[[link]]` written outside a `[scene]` block is parsed by Twine into an arrow on
 * the story map and then dropped before render (spec 02, D16) — so it is not an edge here,
 * and `lint` is what tells you about it. A map that shows doors nobody can open is worse
 * than no map.
 */

import {buildLinkGraph} from '../lint';
import {resolve} from '../ref';
import {EXIT} from '../types';
import type {Ctx} from '../types';

export const name = 'graph';
export const summary = 'the link graph, as tree, dot or jsonl';

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const positional = args.filter(arg => !arg.startsWith('-'));
	const target = positional[0];

	if (target === undefined) {
		ctx.out('usage: twine-cli graph <story> [--format tree|dot|jsonl] [--from <passage>] [--depth n]');

		return EXIT.usage;
	}

	const format = typeof ctx.flags.format === 'string' ? ctx.flags.format : 'tree';

	if (!['tree', 'dot', 'jsonl'].includes(format)) {
		ctx.out(`unknown --format '${format}': want tree, dot or jsonl`);

		return EXIT.usage;
	}

	const depth =
		typeof ctx.flags.depth === 'string' ? Number(ctx.flags.depth) : Infinity;

	if (Number.isNaN(depth)) {
		ctx.out('--depth wants a number');

		return EXIT.usage;
	}

	const {body} = await resolve(ctx.source, target);
	const graph = buildLinkGraph(body);
	const start =
		typeof ctx.flags.from === 'string'
			? ctx.flags.from
			: body.passages.find(
					passage => passage.id === (body.startPassage as string | undefined)
				)?.name;

	if (start !== undefined && !graph.has(start)) {
		ctx.out(`no passage '${start}' in ${target}`);

		return EXIT.notFound;
	}

	// Which nodes are in scope: the whole story, or what `--from`/`--depth` can reach.
	const reachable = new Map<string, number>();

	if (start !== undefined) {
		const queue: [string, number][] = [[start, 0]];

		while (queue.length > 0) {
			const [node, level] = queue.shift()!;

			if (reachable.has(node) || level > depth) {
				continue;
			}

			reachable.set(node, level);

			for (const next of graph.get(node) ?? []) {
				if (!reachable.has(next)) {
					queue.push([next, level + 1]);
				}
			}
		}
	} else {
		for (const node of graph.keys()) {
			reachable.set(node, 0);
		}
	}

	if (format === 'dot') {
		ctx.out('digraph story {');

		for (const [node, level] of reachable) {
			for (const next of graph.get(node) ?? []) {
				if (level + 1 <= depth) {
					ctx.out(`  ${JSON.stringify(node)} -> ${JSON.stringify(next)};`);
				}
			}
		}

		ctx.out('}');

		return EXIT.ok;
	}

	if (format === 'jsonl') {
		for (const [node, level] of reachable) {
			ctx.out(
				JSON.stringify({
					depth: level,
					links: level + 1 <= depth ? (graph.get(node) ?? []) : [],
					missing: !graph.has(node),
					passage: node
				})
			);
		}

		return EXIT.ok;
	}

	// tree — the same DFS the reader's eye does, with a marker where it loops back.
	const drawn = new Set<string>();

	function walk(node: string, level: number, indent: string): void {
		const targets = graph.get(node);

		if (targets === undefined) {
			ctx.out(`${indent}${node}  (no such passage)`);

			return;
		}

		if (drawn.has(node)) {
			ctx.out(`${indent}${node}  →`);

			return;
		}

		drawn.add(node);
		ctx.out(`${indent}${node}`);

		if (level >= depth) {
			return;
		}

		for (const next of targets) {
			walk(next, level + 1, `${indent}  `);
		}
	}

	if (start !== undefined) {
		walk(start, 0, '');
	}

	const stranded = [...graph.keys()].filter(node => !drawn.has(node));

	if (stranded.length > 0) {
		ctx.out('');
		ctx.out('UNREACHED');

		for (const node of stranded) {
			walk(node, 0, '  ');
		}
	}

	return EXIT.ok;
}
