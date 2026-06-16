import type { ScriptProvider, ScriptResult, VideoIdea } from '../../types.js';
import { postJson } from '../../util/http.js';
import { requireEnv, env } from '../../util/env.js';

const SYSTEM = `You are a short-form video scriptwriter for vertical social video
(TikTok, Reels, YouTube Shorts). Write tight, high-retention scripts with a strong
first-line hook. Return STRICT JSON only, no markdown, matching this shape:
{
  "title": string,            // <= 70 chars, punchy
  "hook": string,             // first spoken line, <= 12 words
  "body": string,             // full narration AFTER the hook, ~110-160 words
  "description": string,      // post caption, 1-3 sentences
  "hashtags": string[],       // 5-8, no '#' prefix
  "keywords": string[]        // 4-8 concrete VISUAL nouns for stock-footage search
}`;

interface ChatResponse {
  choices: { message: { content: string } }[];
}

/** Script via OpenAI chat completions with JSON mode. */
export class OpenAIScriptProvider implements ScriptProvider {
  readonly name = 'openai';
  private model = env('OPENAI_SCRIPT_MODEL', 'gpt-4o');

  async generate(idea: VideoIdea): Promise<ScriptResult> {
    const apiKey = requireEnv('OPENAI_API_KEY');
    const userPrompt =
      `Topic: ${idea.topic}\n` +
      (idea.niche ? `Niche/voice: ${idea.niche}\n` : '') +
      `Write the script now as JSON.`;

    const res = await postJson<ChatResponse>(
      'https://api.openai.com/v1/chat/completions',
      {
        model: this.model,
        response_format: { type: 'json_object' },
        temperature: 0.8,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt },
        ],
      },
      { Authorization: `Bearer ${apiKey}` },
    );

    const raw = res.choices?.[0]?.message?.content;
    if (!raw) throw new Error('OpenAI returned no script content');
    return normalize(JSON.parse(raw));
  }
}

export function normalize(obj: Record<string, unknown>): ScriptResult {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x).replace(/^#/, '').trim()).filter(Boolean) : [];
  return {
    title: String(obj.title ?? 'Untitled').slice(0, 100),
    hook: String(obj.hook ?? ''),
    body: String(obj.body ?? ''),
    description: String(obj.description ?? ''),
    hashtags: arr(obj.hashtags),
    keywords: arr(obj.keywords),
  };
}
