import type { AssemblyProvider, Orientation, RenderInput } from '../../types.js';
import { run } from '../../util/proc.js';
import { log } from '../../util/logger.js';

const DIMS: Record<Orientation, { w: number; h: number }> = {
  vertical: { w: 1080, h: 1920 },
  horizontal: { w: 1920, h: 1080 },
};

// Big, centered, readable captions — the short-form look.
const CAPTION_STYLE =
  "FontName=Arial,Fontsize=16,Bold=1,PrimaryColour=&H00FFFFFF," +
  "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=120";

/**
 * Assembles stock clips + voiceover + burned captions into a platform-ready
 * MP4. Pure FFmpeg — no per-render API cost, fully scalable on your own CPU.
 *
 * Requires ffmpeg + ffprobe on PATH.
 */
export class FfmpegAssemblyProvider implements AssemblyProvider {
  readonly name = 'ffmpeg';

  async render(input: RenderInput): Promise<string> {
    const { visuals, audioPath, srtPath, orientation, durationSec, outPath } = input;
    if (visuals.length === 0) throw new Error('No visuals to assemble');

    const { w, h } = DIMS[orientation];
    const perClip = Math.max(1.5, durationSec / visuals.length);

    const args: string[] = ['-y'];
    // Each visual: loop to guarantee it fills its slice, trimmed to perClip.
    for (const v of visuals) {
      args.push('-stream_loop', '-1', '-t', perClip.toFixed(3), '-i', v.path);
    }
    // Voiceover is the last input.
    args.push('-i', audioPath);
    const audioIdx = visuals.length;

    // Build the filtergraph: scale/crop each clip, concat, then burn captions.
    const parts: string[] = [];
    const labels: string[] = [];
    visuals.forEach((_, i) => {
      parts.push(
        `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
          `crop=${w}:${h},setsar=1,fps=30,format=yuv420p[v${i}]`,
      );
      labels.push(`[v${i}]`);
    });
    parts.push(`${labels.join('')}concat=n=${visuals.length}:v=1:a=0[vcat]`);

    let finalVideo = '[vcat]';
    if (srtPath) {
      const esc = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
      parts.push(`[vcat]subtitles=${esc}:force_style='${CAPTION_STYLE}'[vout]`);
      finalVideo = '[vout]';
    }

    args.push(
      '-filter_complex', parts.join(';'),
      '-map', finalVideo,
      '-map', `${audioIdx}:a`,
      '-t', durationSec.toFixed(3),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      outPath,
    );

    log.step('assembly', `ffmpeg → ${orientation} ${w}x${h}, ${visuals.length} clips, ${durationSec.toFixed(1)}s`);
    await run('ffmpeg', args);
    return outPath;
  }
}
