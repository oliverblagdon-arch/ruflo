/**
 * Orchestrator: idea → script → voiceover → visuals → captions → render →
 * publish. Renders one master per needed orientation and fans out to every
 * configured publisher.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Orientation,
  Providers,
  PublishResult,
  ScriptResult,
  VideoIdea,
} from './types.js';
import { log } from './util/logger.js';

export interface RunResult {
  idea: VideoIdea;
  script: ScriptResult;
  renders: Record<string, string>; // orientation -> file path
  published: PublishResult[];
}

export interface RunOptions {
  /** Produce assets but skip the publish stage (dry run). */
  noPublish?: boolean;
  /** Schedule instead of publishing immediately. */
  publishAt?: Date;
  /** Root directory for outputs. */
  outRoot?: string;
}

export async function produce(
  idea: VideoIdea,
  providers: Providers,
  opts: RunOptions = {},
): Promise<RunResult> {
  const outRoot = opts.outRoot ?? 'output';
  const workDir = join(outRoot, idea.id);
  await mkdir(workDir, { recursive: true });

  // 1) Script
  log.step('script', `${providers.script.name}: "${idea.topic}"`);
  const script = await providers.script.generate(idea);
  log.info(`title: ${script.title}`);

  // 2) Voiceover (hook + body)
  log.step('tts', providers.tts.name);
  const narration = `${script.hook} ${script.body}`.trim();
  const tts = await providers.tts.synthesize(narration, join(workDir, 'voice.mp3'));
  log.info(`voiceover: ${tts.durationSec.toFixed(1)}s`);

  // 3) Captions (aligned to the voiceover)
  log.step('captions', providers.captions.name);
  const captions = await providers.captions.transcribe(tts.audioPath, workDir).catch((err) => {
    log.warn(`captions failed (continuing without): ${(err as Error).message}`);
    return undefined;
  });

  // Which orientations do we need? TikTok/IG are always vertical; YT is configurable.
  const orientations = neededOrientations(idea, providers.ytOrientation);

  // 4) Visuals + 5) Render, per orientation
  const renders: Record<string, string> = {};
  for (const orientation of orientations) {
    const clipDir = join(workDir, orientation);
    await mkdir(clipDir, { recursive: true });
    log.step('visuals', `${providers.visuals.name} (${orientation})`);
    const visuals = await providers.visuals.fetch(script.keywords, {
      count: providers.visualsClipCount,
      orientation,
      outDir: clipDir,
    });

    const outPath = join(workDir, `video_${orientation}.mp4`);
    await providers.assembly.render({
      visuals,
      audioPath: tts.audioPath,
      srtPath: captions?.srtPath,
      orientation,
      durationSec: tts.durationSec,
      outPath,
    });
    renders[orientation] = outPath;
    log.info(`rendered ${orientation}: ${outPath}`);
  }

  // 6) Publish
  const published: PublishResult[] = [];
  if (opts.noPublish) {
    log.warn('--no-publish set: skipping publish stage');
  } else {
    for (const publisher of providers.publishers) {
      const orientation = publisher.platform === 'youtube' ? providers.ytOrientation : 'vertical';
      const videoPath = renders[orientation] ?? Object.values(renders)[0];
      const result = await publisher.publish({
        videoPath,
        title: script.title,
        description: script.description,
        hashtags: script.hashtags,
        publishAt: opts.publishAt,
      });
      published.push(result);
      const line = `${result.platform}: ${result.status}${result.message ? ` — ${result.message}` : ''}`;
      result.status === 'failed' ? log.error(line) : log.info(line);
    }
  }

  return { idea, script, renders, published };
}

function neededOrientations(idea: VideoIdea, yt: Orientation): Orientation[] {
  const set = new Set<Orientation>();
  for (const t of idea.targets) {
    set.add(t === 'youtube' ? yt : 'vertical');
  }
  return [...set];
}
