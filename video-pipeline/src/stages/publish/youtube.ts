import { createReadStream } from 'node:fs';
import { google } from 'googleapis';
import type { Publisher, PublishInput, PublishResult } from '../../types.js';
import { requireEnv, env } from '../../util/env.js';
import { log } from '../../util/logger.js';

/**
 * YouTube upload via Data API v3 (OAuth2 refresh token).
 *
 * QUOTA FLAG: default quota is 10,000 units/day and an upload costs ~1,600
 * units → only ~6 uploads/day out of the box. Scaling past that needs a
 * formal quota-increase request to Google (audited, not guaranteed).
 */
export class YouTubePublisher implements Publisher {
  readonly platform = 'youtube' as const;

  async publish(input: PublishInput): Promise<PublishResult> {
    let auth;
    try {
      auth = new google.auth.OAuth2(
        requireEnv('YOUTUBE_CLIENT_ID'),
        requireEnv('YOUTUBE_CLIENT_SECRET'),
        env('YOUTUBE_REDIRECT_URI', 'http://localhost:3000/oauth2callback'),
      );
      auth.setCredentials({ refresh_token: requireEnv('YOUTUBE_REFRESH_TOKEN') });
    } catch (err) {
      return { platform: this.platform, status: 'skipped', message: (err as Error).message };
    }

    const youtube = google.youtube({ version: 'v3', auth });
    const scheduled = !!input.publishAt;

    try {
      const res = await youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: input.title.slice(0, 100),
            description: `${input.description}\n\n${input.hashtags.map((t) => `#${t}`).join(' ')}`.trim(),
            tags: input.hashtags,
          },
          status: {
            // Scheduling requires privacyStatus 'private' + publishAt.
            privacyStatus: scheduled ? 'private' : 'public',
            publishAt: scheduled ? input.publishAt!.toISOString() : undefined,
            selfDeclaredMadeForKids: false,
          },
        },
        media: { body: createReadStream(input.videoPath) },
      });

      const id = res.data.id ?? undefined;
      log.step('publish', `youtube ${scheduled ? 'scheduled' : 'published'}: ${id}`);
      return {
        platform: this.platform,
        status: scheduled ? 'scheduled' : 'published',
        id,
        url: id ? `https://youtu.be/${id}` : undefined,
      };
    } catch (err) {
      return { platform: this.platform, status: 'failed', message: (err as Error).message };
    }
  }
}
