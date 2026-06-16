import { basename } from 'node:path';
import type { Publisher, PublishInput, PublishResult } from '../../types.js';
import { getJson, postJson } from '../../util/http.js';
import { env } from '../../util/env.js';
import { log } from '../../util/logger.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Instagram Reels via the Graph API. Requires an IG Business/Creator account
 * linked to a Facebook Page + app review for content publishing.
 *
 * IMPORTANT: the Graph API PULLS the video from a public URL — it does not
 * accept a local file. You must host output/ somewhere reachable and set
 * PUBLIC_BASE_URL. video_url = `${PUBLIC_BASE_URL}/${filename}`.
 *
 * RATE FLAG: ~25 API-published posts per 24h per account.
 */
export class InstagramPublisher implements Publisher {
  readonly platform = 'instagram' as const;

  async publish(input: PublishInput): Promise<PublishResult> {
    const igUserId = env('IG_USER_ID');
    const token = env('IG_ACCESS_TOKEN');
    const baseUrl = env('PUBLIC_BASE_URL');

    if (!igUserId || !token) {
      return { platform: this.platform, status: 'skipped', message: 'IG_USER_ID / IG_ACCESS_TOKEN not set' };
    }
    if (!baseUrl) {
      return {
        platform: this.platform,
        status: 'skipped',
        message: 'PUBLIC_BASE_URL not set — Graph API needs a public video_url (host output/ on a CDN/static server)',
      };
    }

    const videoUrl = `${baseUrl.replace(/\/$/, '')}/${basename(input.videoPath)}`;
    const caption = `${input.title}\n\n${input.description}\n\n${input.hashtags.map((t) => `#${t}`).join(' ')}`.trim();

    try {
      // 1) Create the media container.
      const container = await postJson<{ id: string }>(
        `${GRAPH}/${igUserId}/media`,
        { media_type: 'REELS', video_url: videoUrl, caption, access_token: token },
      );

      // 2) Poll until the container finishes processing.
      const ready = await this.waitForContainer(container.id, token);
      if (!ready) {
        return { platform: this.platform, status: 'failed', message: 'IG container processing timed out / errored' };
      }

      // 3) Publish.
      const published = await postJson<{ id: string }>(
        `${GRAPH}/${igUserId}/media_publish`,
        { creation_id: container.id, access_token: token },
      );

      log.step('publish', `instagram published: ${published.id}`);
      return { platform: this.platform, status: 'published', id: published.id };
    } catch (err) {
      return { platform: this.platform, status: 'failed', message: (err as Error).message };
    }
  }

  private async waitForContainer(id: string, token: string): Promise<boolean> {
    for (let i = 0; i < 30; i++) {
      const status = await getJson<{ status_code: string }>(
        `${GRAPH}/${id}?fields=status_code&access_token=${token}`,
      );
      if (status.status_code === 'FINISHED') return true;
      if (status.status_code === 'ERROR') return false;
      await new Promise((r) => setTimeout(r, 4000));
    }
    return false;
  }
}
