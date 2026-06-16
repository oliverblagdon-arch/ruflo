import { writeFile } from 'node:fs/promises';
import type { TtsProvider, TtsResult } from '../../types.js';
import { requireEnv, env } from '../../util/env.js';
import { probeDuration } from '../../util/proc.js';

/**
 * Voiceover via ElevenLabs. Best quality, but USAGE-BASED by characters —
 * this is the fastest-growing line item in the stack. Swap to OpenAI TTS
 * when volume makes the bill hurt (just flip TTS_PROVIDER=openai).
 */
export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = 'elevenlabs';
  private model = env('ELEVENLABS_MODEL', 'eleven_turbo_v2_5');

  async synthesize(text: string, outPath: string): Promise<TtsResult> {
    const apiKey = requireEnv('ELEVENLABS_API_KEY');
    const voiceId = requireEnv('ELEVENLABS_VOICE_ID');
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: this.model }),
      },
    );
    if (!res.ok) {
      throw new Error(`ElevenLabs TTS -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(outPath, buf);
    return { audioPath: outPath, durationSec: await probeDuration(outPath) };
  }
}
