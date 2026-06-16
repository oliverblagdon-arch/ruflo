import type { ScriptProvider, ScriptResult, VideoIdea } from '../../types.js';
import { postJson } from '../../util/http.js';
import { requireEnv, env } from '../../util/env.js';
import { normalize } from './openai.js';

const SYSTEM = `You are a short-form video scriptwriter for vertical social video.
Write tight, high-retention scripts with a strong first-line hook. Respond with
STRICT JSON ONLY (no prose, no code fences) of shape: {"title","hook","body",
"description","hashtags":[],"keywords":[]}. keywords = concrete visual nouns for
stock-footage search. body ~110-160 words. hashtags without '#'.`;

interface MessagesResponse {
  content: { type: string; text: string }[];
}

/** Script via Anthropic Messages API. */
export class AnthropicScriptProvider implements ScriptProvider {
  readonly name = 'anthropic';
  private model = env('ANTHROPIC_SCRIPT_MODEL', 'claude-sonnet-4-6');

  async generate(idea: VideoIdea): Promise<ScriptResult> {
    const apiKey = requireEnv('ANTHROPIC_API_KEY');
    const res = await postJson<MessagesResponse>(
      'https://api.anthropic.com/v1/messages',
      {
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content:
              `Topic: ${idea.topic}\n` +
              (idea.niche ? `Niche/voice: ${idea.niche}\n` : '') +
              `Return the script JSON now.`,
          },
        ],
      },
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    );

    const text = res.content?.find((c) => c.type === 'text')?.text;
    if (!text) throw new Error('Anthropic returned no script content');
    return normalize(JSON.parse(stripFences(text)));
  }
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
}
