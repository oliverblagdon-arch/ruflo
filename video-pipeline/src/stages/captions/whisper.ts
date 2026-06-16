import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { basename } from 'node:path';
import type { CaptionResult, CaptionsProvider } from '../../types.js';
import { requireEnv, env } from '../../util/env.js';

/**
 * Captions via OpenAI Whisper transcription. Cheap and reliable — this stage
 * is essentially solved. Returns an SRT aligned to the voiceover, which the
 * assembly stage burns into the frame.
 */
export class WhisperCaptionsProvider implements CaptionsProvider {
  readonly name = 'whisper';
  private model = env('WHISPER_MODEL', 'whisper-1');

  async transcribe(audioPath: string, outDir: string): Promise<CaptionResult> {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const bytes = await readFile(audioPath);

    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/mpeg' }), basename(audioPath));
    form.append('model', this.model);
    form.append('response_format', 'srt');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`Whisper -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }

    const srt = await res.text();
    const srtPath = join(outDir, 'captions.srt');
    await writeFile(srtPath, srt, 'utf-8');
    return { srtPath };
  }
}
