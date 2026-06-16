import { join } from 'node:path';
import type {
  VisualAsset,
  VisualsFetchOptions,
  VisualsProvider,
} from '../../types.js';
import { getJson, download } from '../../util/http.js';
import { requireEnv } from '../../util/env.js';
import { probeDuration } from '../../util/proc.js';
import { log } from '../../util/logger.js';

interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  quality: string;
  file_type: string;
}
interface PexelsVideo {
  id: number;
  duration: number;
  video_files: PexelsVideoFile[];
}
interface PexelsSearch {
  videos: PexelsVideo[];
}

/**
 * Lane A visuals: royalty-free stock footage from Pexels.
 * Reliable + cheap + scalable (free API). The dependable workhorse vs.
 * generative AI video, which still has length/consistency/cost ceilings.
 */
export class PexelsVisualsProvider implements VisualsProvider {
  readonly name = 'pexels';

  async fetch(keywords: string[], opts: VisualsFetchOptions): Promise<VisualAsset[]> {
    const apiKey = requireEnv('PEXELS_API_KEY');
    const orientation = opts.orientation === 'vertical' ? 'portrait' : 'landscape';
    const assets: VisualAsset[] = [];
    const queries = keywords.length ? keywords : ['abstract background'];

    let qi = 0;
    while (assets.length < opts.count && qi < queries.length * 3) {
      const query = queries[qi % queries.length];
      qi++;
      try {
        const data = await getJson<PexelsSearch>(
          `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}` +
            `&orientation=${orientation}&per_page=5&size=medium`,
          { Authorization: apiKey },
        );
        const video = data.videos?.[Math.floor(Math.random() * Math.min(3, data.videos.length))];
        const file = pickFile(video, opts.orientation);
        if (!video || !file) continue;

        const dest = join(opts.outDir, `clip_${assets.length}_${video.id}.mp4`);
        await download(file.link, dest);
        assets.push({
          path: dest,
          durationSec: await probeDuration(dest).catch(() => video.duration || 5),
          source: `pexels:${video.id} (${query})`,
        });
        log.step('visuals', `+ clip ${assets.length}/${opts.count} "${query}"`);
      } catch (err) {
        log.warn(`pexels query "${query}" failed: ${(err as Error).message}`);
      }
    }

    if (assets.length === 0) {
      throw new Error('No stock footage could be fetched. Check PEXELS_API_KEY / keywords.');
    }
    return assets;
  }
}

/** Prefer an HD file roughly matching the target orientation. */
function pickFile(video: PexelsVideo | undefined, orientation: string): PexelsVideoFile | undefined {
  if (!video) return undefined;
  const wantVertical = orientation === 'vertical';
  const sorted = [...video.video_files]
    .filter((f) => f.file_type === 'video/mp4')
    .sort((a, b) => b.height - a.height);
  return (
    sorted.find((f) => (wantVertical ? f.height > f.width : f.width >= f.height) && f.height <= 1920) ??
    sorted[0]
  );
}
