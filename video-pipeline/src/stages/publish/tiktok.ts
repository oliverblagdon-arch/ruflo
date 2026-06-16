import { stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import type { Publisher, PublishInput, PublishResult } from '../../types.js';
import { env } from '../../util/env.js';
import { log } from '../../util/logger.js';

const API = 'https://open.tiktokapis.com/v2';

/**
 * TikTok via the Content Posting API.
 *
 * ⚠️ THE BIG AUTOMATION WALL. Unaudited apps can ONLY post privately
 * (SELF_ONLY) or push to the in-app DRAFT inbox — you CANNOT publicly
 * auto-post until your app passes TikTok's audit, which is not guaranteed
 * for automated/AI-content use cases.
 *
 * This publisher uses the DRAFT INBOX flow by default (the safe, no-audit
 * path): the video lands in the user's TikTok inbox and they tap "post"
 * manually. To go fully public you must (a) pass the audit and (b) switch to
 * the direct-post endpoint with privacy_level=PUBLIC_TO_EVERYONE.
 */
export class TikTokPublisher implements Publisher {
  readonly platform = 'tiktok' as const;

  async publish(input: PublishInput): Promise<PublishResult> {
    const token = env('TIKTOK_ACCESS_TOKEN');
    if (!token) {
      return { platform: this.platform, status: 'skipped', message: 'TIKTOK_ACCESS_TOKEN not set' };
    }

    try {
      const size = (await stat(input.videoPath)).size;

      // 1) Init an inbox (draft) upload.
      const initRes = await fetch(`${API}/post/publish/inbox/video/init/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: size,
            chunk_size: size,
            total_chunk_count: 1,
          },
        }),
      });
      if (!initRes.ok) {
        return { platform: this.platform, status: 'failed', message: `init ${initRes.status}: ${(await initRes.text()).slice(0, 400)}` };
      }
      const init = (await initRes.json()) as { data?: { publish_id: string; upload_url: string }; error?: { message: string } };
      if (!init.data?.upload_url) {
        return { platform: this.platform, status: 'failed', message: init.error?.message ?? 'no upload_url' };
      }

      // 2) Upload the bytes to the signed URL.
      const bytes = await readFile(input.videoPath);
      const put = await fetch(init.data.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes 0-${size - 1}/${size}`,
        },
        body: bytes,
      });
      if (!put.ok) {
        return { platform: this.platform, status: 'failed', message: `upload ${put.status}` };
      }

      log.step('publish', `tiktok → draft inbox (manual publish required): ${init.data.publish_id}`);
      return {
        platform: this.platform,
        status: 'draft',
        id: init.data.publish_id,
        message: 'Sent to TikTok drafts — open the app and tap Post (public auto-post needs audit approval).',
      };
    } catch (err) {
      return { platform: this.platform, status: 'failed', message: (err as Error).message };
    }
  }
}
