/**
 * Shared contracts for the pipeline.
 *
 * Each stage is an interface. Swapping a tool = writing a new class that
 * implements the interface and wiring it in config.ts. Nothing else changes.
 */

export type Platform = 'youtube' | 'instagram' | 'tiktok';
export type Orientation = 'vertical' | 'horizontal';

/** A single unit of work: one idea -> one (set of) published video(s). */
export interface VideoIdea {
  id: string;
  topic: string;
  niche?: string;
  targets: Platform[];
}

// ----- Stage 1: Script -------------------------------------------------------

export interface ScriptResult {
  title: string;
  /** Short attention hook spoken in the first ~2 seconds. */
  hook: string;
  /** Full narration text (what the TTS will read). */
  body: string;
  /** Long-form description for the video post. */
  description: string;
  hashtags: string[];
  /** Search terms used to pull matching stock footage. */
  keywords: string[];
}

export interface ScriptProvider {
  readonly name: string;
  generate(idea: VideoIdea): Promise<ScriptResult>;
}

// ----- Stage 2: Voiceover (TTS) ----------------------------------------------

export interface TtsResult {
  audioPath: string;
  durationSec: number;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(text: string, outPath: string): Promise<TtsResult>;
}

// ----- Stage 3: Visuals ------------------------------------------------------

export interface VisualAsset {
  path: string;
  durationSec: number;
  source: string;
}

export interface VisualsFetchOptions {
  count: number;
  orientation: Orientation;
  outDir: string;
}

export interface VisualsProvider {
  readonly name: string;
  fetch(keywords: string[], opts: VisualsFetchOptions): Promise<VisualAsset[]>;
}

// ----- Stage 4: Captions -----------------------------------------------------

export interface CaptionResult {
  /** Path to an SRT file aligned to the voiceover. */
  srtPath: string;
}

export interface CaptionsProvider {
  readonly name: string;
  transcribe(audioPath: string, outDir: string): Promise<CaptionResult>;
}

// ----- Stage 5: Assembly / formatting ----------------------------------------

export interface RenderInput {
  visuals: VisualAsset[];
  audioPath: string;
  /** Optional SRT to burn into the frame. */
  srtPath?: string;
  orientation: Orientation;
  /** Final video length, in seconds (usually the voiceover length). */
  durationSec: number;
  outPath: string;
}

export interface AssemblyProvider {
  readonly name: string;
  render(input: RenderInput): Promise<string>;
}

// ----- Stage 6: Publishing ---------------------------------------------------

export interface PublishInput {
  videoPath: string;
  title: string;
  description: string;
  hashtags: string[];
  /** When set, schedule for this time instead of publishing immediately. */
  publishAt?: Date;
}

export type PublishStatus =
  | 'published'
  | 'scheduled'
  | 'draft'
  | 'skipped'
  | 'failed';

export interface PublishResult {
  platform: Platform;
  status: PublishStatus;
  id?: string;
  url?: string;
  message?: string;
}

export interface Publisher {
  readonly platform: Platform;
  publish(input: PublishInput): Promise<PublishResult>;
}

// ----- Assembled stage set ---------------------------------------------------

export interface Providers {
  script: ScriptProvider;
  tts: TtsProvider;
  visuals: VisualsProvider;
  captions: CaptionsProvider;
  assembly: AssemblyProvider;
  publishers: Publisher[];
  ytOrientation: Orientation;
  visualsClipCount: number;
}
