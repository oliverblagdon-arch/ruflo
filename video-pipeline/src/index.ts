#!/usr/bin/env node
/**
 * CLI entry point.
 *
 *   npm run produce -- --idea "Why octopuses have 3 hearts" --niche "ocean facts"
 *   npm run produce -- --topics topics.json --no-publish
 *   npm run produce -- --idea "..." --targets youtube,tiktok --schedule "2026-06-20T15:00:00Z"
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadProviders, parseTargets } from './config.js';
import { produce, type RunOptions } from './pipeline.js';
import type { Platform, VideoIdea } from './types.js';
import { log } from './util/logger.js';

interface Args {
  idea?: string;
  niche?: string;
  topics?: string;
  targets?: Platform[];
  schedule?: Date;
  noPublish: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { noPublish: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => argv[++i] ?? '';
    switch (a) {
      case '--idea': args.idea = next(); break;
      case '--niche': args.niche = next(); break;
      case '--topics': args.topics = next(); break;
      case '--targets': args.targets = parseTargets(next()); break;
      case '--schedule': args.schedule = new Date(next()); break;
      case '--no-publish': args.noPublish = true; break;
      case '--help': case '-h': printHelp(); process.exit(0);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
ai-video-pipeline — idea → published short-form video

USAGE
  npm run produce -- --idea "<topic>" [options]
  npm run produce -- --topics <file.json> [options]

OPTIONS
  --idea <text>        Single topic to produce
  --niche <text>       Voice/niche hint for the scriptwriter
  --topics <file>      JSON array of ideas: [{ "topic": "...", "niche": "...", "targets": ["youtube"] }]
  --targets <list>     Override publish targets: youtube,instagram,tiktok
  --schedule <iso>     Schedule instead of publishing now (e.g. 2026-06-20T15:00:00Z)
  --no-publish         Produce assets only; skip publishing (dry run)
  -h, --help           Show this help
`);
}

async function loadIdeas(args: Args): Promise<VideoIdea[]> {
  const defaultTargets = args.targets ?? parseTargets(process.env.PUBLISH_TARGETS ?? 'youtube,instagram,tiktok');

  if (args.topics) {
    const raw = JSON.parse(await readFile(args.topics, 'utf-8')) as Array<{
      topic: string; niche?: string; targets?: string[];
    }>;
    return raw.map((r) => ({
      id: slug(r.topic),
      topic: r.topic,
      niche: r.niche,
      targets: r.targets ? parseTargets(r.targets.join(',')) : defaultTargets,
    }));
  }

  if (args.idea) {
    return [{ id: slug(args.idea), topic: args.idea, niche: args.niche, targets: defaultTargets }];
  }

  return [];
}

function slug(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) +
    '-' + randomUUID().slice(0, 8)
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ideas = await loadIdeas(args);

  if (ideas.length === 0) {
    log.error('No idea provided. Use --idea "<topic>" or --topics <file.json> (--help for usage).');
    process.exit(1);
  }

  const providers = loadProviders();
  const opts: RunOptions = { noPublish: args.noPublish, publishAt: args.schedule };

  let failures = 0;
  for (const idea of ideas) {
    log.info(`▶ Producing: ${idea.topic}  → [${idea.targets.join(', ')}]`);
    try {
      const result = await produce(idea, providers, opts);
      const ok = result.published.every((p) => p.status !== 'failed');
      if (!ok) failures++;
      log.info(`✔ Done: ${idea.id}`);
    } catch (err) {
      failures++;
      log.error(`Pipeline failed for "${idea.topic}": ${(err as Error).message}`);
    }
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  log.error((err as Error).stack ?? String(err));
  process.exit(1);
});
