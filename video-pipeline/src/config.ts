/**
 * Provider selection. This is the "swap any tool at any stage" layer:
 * each stage reads a *_PROVIDER env var and instantiates the matching adapter.
 * Add a new tool = add a case here + a class implementing the stage interface.
 */

import type { Platform, Providers, Orientation, Publisher } from './types.js';
import { env, envInt } from './util/env.js';

import { OpenAIScriptProvider } from './stages/script/openai.js';
import { AnthropicScriptProvider } from './stages/script/anthropic.js';
import { OpenAITtsProvider } from './stages/tts/openai.js';
import { ElevenLabsTtsProvider } from './stages/tts/elevenlabs.js';
import { PexelsVisualsProvider } from './stages/visuals/pexels.js';
import { WhisperCaptionsProvider } from './stages/captions/whisper.js';
import { FfmpegAssemblyProvider } from './stages/assembly/ffmpeg.js';
import { YouTubePublisher } from './stages/publish/youtube.js';
import { InstagramPublisher } from './stages/publish/instagram.js';
import { TikTokPublisher } from './stages/publish/tiktok.js';

export function loadProviders(): Providers {
  const scriptName = env('SCRIPT_PROVIDER', 'openai');
  const ttsName = env('TTS_PROVIDER', 'openai');

  const script =
    scriptName === 'anthropic' ? new AnthropicScriptProvider() : new OpenAIScriptProvider();

  const tts =
    ttsName === 'elevenlabs' ? new ElevenLabsTtsProvider() : new OpenAITtsProvider();

  // Only one option each today, but keep the switch shape for future swaps.
  const visuals = new PexelsVisualsProvider();
  const captions = new WhisperCaptionsProvider();
  const assembly = new FfmpegAssemblyProvider();

  const targets = parseTargets(env('PUBLISH_TARGETS', 'youtube,instagram,tiktok'));
  const publishers: Publisher[] = [];
  if (targets.includes('youtube')) publishers.push(new YouTubePublisher());
  if (targets.includes('instagram')) publishers.push(new InstagramPublisher());
  if (targets.includes('tiktok')) publishers.push(new TikTokPublisher());

  const ytOrientation = (env('YT_ORIENTATION', 'vertical') as Orientation);

  return {
    script,
    tts,
    visuals,
    captions,
    assembly,
    publishers,
    ytOrientation,
    visualsClipCount: envInt('VISUALS_CLIP_COUNT', 6),
  };
}

export function parseTargets(raw: string): Platform[] {
  const valid: Platform[] = ['youtube', 'instagram', 'tiktok'];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Platform => valid.includes(s as Platform));
}
