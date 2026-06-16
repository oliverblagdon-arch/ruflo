import { writeFile } from 'node:fs/promises';
import type { TtsProvider, TtsResult } from '../../types.js';
import { requireEnv, env } from '../../util/env.js';
import { probeDuration } from '../../util/proc.js';

/** Voiceover via OpenAI's speech endpoint. Cheap; good for scale. */
export class OpenAITtsProvider implements TtsProvider {
  readonly name = 'openai';
  private model = env('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts');
  private voice = env('OPENAI_TTS_VOICE', 'alloy');

  async synthesize(text: string, outPath: string): Promise<TtsResult> {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        voice: this.voice,
        input: text,
        response_format: 'mp3',
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI TTS -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(outPath, buf);
    return { audioPath: outPath, durationSec: await probeDuration(outPath) };
  }
}
