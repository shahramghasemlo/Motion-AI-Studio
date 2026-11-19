import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, sql } from 'drizzle-orm';
import JSZip from 'jszip';
import { db } from '../db/index.ts';
import {
  mediaAssets,
  projectScenes,
  projects,
  renderJobs,
  users,
} from '../db/schema.ts';
import { logActivity } from '../db/users.ts';
import {
  buildTimelineFromProjectScenes,
  computeClipMotionFrameState,
  DEFAULT_AUDIO_SETTINGS,
  type AudioSettingsDoc,
  type TimelineDocument,
  type TrackType,
} from '../shared/motionEngine.ts';
import {
  cleanupTempJobDir,
  ensureStorageDirectories,
  EXPORTS_DIR,
  resolveSafeUserPath,
  TEMP_DIR,
  UPLOADS_DIR,
} from './storage.ts';
import { studioWsHub } from './ws.ts';

export type RenderFormat = 'mp4' | 'webm' | 'gif' | 'png';
export type RenderQuality = '720p' | '1080p' | '4k';

let fontsRegistered = false;
function ensureSystemFontsRegistered(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  const candidates: Array<{ file: string; family: string }> = [
    { file: '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf', family: 'StudioArabic' },
    { file: '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf', family: 'StudioArabic' },
    { file: '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf', family: 'StudioNaskh' },
    { file: '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf', family: 'StudioSans' },
    { file: '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', family: 'StudioSans' },
    { file: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', family: 'StudioFallback' },
  ];
  for (const c of candidates) {
    try {
      GlobalFonts.registerFromPath(c.file, c.family);
    } catch {
      // Ignore unavailable font candidate
    }
  }
}

interface ActiveJobHandle {
  cancelled: boolean;
  proc?: ChildProcess;
}

const activeRenderJobs = new Map<number, ActiveJobHandle>();

function roundToEven(val: number): number {
  const r = Math.max(64, Math.round(val));
  return r % 2 === 0 ? r : r + 1;
}

export function computeRenderResolution(
  baseWidth: number,
  baseHeight: number,
  quality: RenderQuality
): { width: number; height: number } {
  const safeW = Math.max(120, baseWidth || 1080);
  const safeH = Math.max(120, baseHeight || 1920);
  const shortTarget = quality === '4k' ? 2160 : quality === '720p' ? 720 : 1080;

  if (safeW <= safeH) {
    const ratio = safeH / safeW;
    return {
      width: roundToEven(shortTarget),
      height: roundToEven(shortTarget * ratio),
    };
  }

  const ratio = safeW / safeH;
  return {
    width: roundToEven(shortTarget * ratio),
    height: roundToEven(shortTarget),
  };
}

function wrapCanvasLines(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/);
  if (!words.length || !text.trim()) return [];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

function drawTimelineFrame(
  ctx: SKRSContext2D,
  W: number,
  H: number,
  timeMs: number,
  timeline: TimelineDocument,
  imageCache: Map<number, Image>
): void {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0B0F17';
  ctx.fillRect(0, 0, W, H);

  const mutedTracks = new Set(
    timeline.tracks.filter((t) => t.muted).map((t) => t.id)
  );

  const activeClips = timeline.clips.filter(
    (c) => !mutedTracks.has(c.trackId) && c.trackType !== 'audio'
  );

  const orderWeight: Record<TrackType, number> = {
    video: 1,
    overlay: 2,
    text: 3,
    audio: 4,
  };
  activeClips.sort((a, b) => orderWeight[a.trackType] - orderWeight[b.trackType]);

  for (const clip of activeClips) {
    const frame = computeClipMotionFrameState(clip, timeMs);
    if (!frame.visible || frame.opacity <= 0.01) continue;

    ctx.save();
    ctx.globalAlpha = frame.opacity;

    if (clip.trackType === 'video') {
      const bg = clip.bgColor || '#0F172A';
      const accent = clip.accentColor || '#2563EB';
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, bg);
      grad.addColorStop(1, '#090D16');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      const rad = ctx.createRadialGradient(
        W * 0.5,
        H * 0.35,
        W * 0.05,
        W * 0.5,
        H * 0.35,
        W * 0.75
      );
      rad.addColorStop(0, `${accent}38`);
      rad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, W, H);

      if (clip.mediaAssetId && imageCache.has(clip.mediaAssetId)) {
        const img = imageCache.get(clip.mediaAssetId)!;
        const targetScale = frame.scale * 0.72;
        const imgRatio = img.width / Math.max(1, img.height);
        let drawW = W * targetScale;
        let drawH = drawW / imgRatio;
        if (drawH > H * targetScale) {
          drawH = H * targetScale;
          drawW = drawH * imgRatio;
        }
        const cx = ((clip.xPercent ?? 50) / 100) * W + frame.translateX;
        const cy = ((clip.yPercent ?? 45) / 100) * H + frame.translateY;
        ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
      }
    } else if (clip.trackType === 'overlay') {
      const cx = ((clip.xPercent ?? 50) / 100) * W + frame.translateX;
      const cy = ((clip.yPercent ?? 20) / 100) * H + frame.translateY;
      if (clip.mediaAssetId && imageCache.has(clip.mediaAssetId)) {
        const img = imageCache.get(clip.mediaAssetId)!;
        const drawW = Math.min(W * 0.32, img.width) * frame.scale;
        const drawH = drawW * (img.height / Math.max(1, img.width));
        ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
      } else if (clip.text) {
        const fs = Math.max(16, Math.round((clip.fontSize ?? 36) * (W / 1080) * frame.scale));
        ctx.font = `700 ${fs}px StudioArabic, StudioSans, StudioFallback, sans-serif`;
        ctx.fillStyle = clip.textColor || '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.direction = /[\u0600-\u06FF]/.test(clip.text) ? 'rtl' : 'ltr';
        ctx.fillText(clip.text, cx, cy);
      }
    } else if (clip.trackType === 'text' && clip.text) {
      const cx = ((clip.xPercent ?? 50) / 100) * W + frame.translateX;
      const cy = ((clip.yPercent ?? 55) / 100) * H + frame.translateY;
      const scaledFontSize = Math.max(
        18,
        Math.round((clip.fontSize ?? 52) * (W / 1080) * frame.scale)
      );
      ctx.font = `700 ${scaledFontSize}px StudioArabic, StudioSans, StudioFallback, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const visibleLen = Math.max(1, Math.round(clip.text.length * frame.revealedCharRatio));
      const visibleText = clip.text.slice(0, visibleLen);
      const lines = wrapCanvasLines(ctx, visibleText, W * 0.82);
      const lineHeight = scaledFontSize * 1.38;
      const startY = cy - ((lines.length - 1) * lineHeight) / 2;

      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = Math.max(4, Math.round(16 * (W / 1080)));
      ctx.shadowOffsetY = Math.max(1, Math.round(4 * (W / 1080)));
      ctx.fillStyle = clip.textColor || '#F8FAFC';

      lines.forEach((line, idx) => {
        ctx.direction = /[\u0600-\u06FF]/.test(line) ? 'rtl' : 'ltr';
        ctx.fillText(line, cx, startY + idx * lineHeight);
      });

      const accentWidth = Math.min(W * 0.24, 180 * (W / 1080)) * frame.scale;
      ctx.shadowBlur = 0;
      ctx.fillStyle = clip.accentColor || '#2563EB';
      ctx.fillRect(
        cx - accentWidth / 2,
        startY + lines.length * lineHeight * 0.65,
        accentWidth,
        Math.max(3, Math.round(W * 0.005))
      );
    }

    ctx.restore();
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

interface ResolvedAudioInput {
  path: string;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
}

async function resolveAudioTracks(
  userId: number,
  audioSettings: AudioSettingsDoc,
  timeline: TimelineDocument,
  durationSec: number
): Promise<ResolvedAudioInput[]> {
  const audioTrackMuted = timeline.tracks.find((t) => t.type === 'audio')?.muted ?? false;
  if (audioTrackMuted) return [];

  const inputs: ResolvedAudioInput[] = [];
  const fadeInSec = Math.max(0, (audioSettings.fadeInMs || 0) / 1000);
  const fadeOutSec = Math.max(0, (audioSettings.fadeOutMs || 0) / 1000);

  const assetIdsToLoad: Array<{ id: number; vol: number }> = [];
  if (audioSettings.musicAssetId) {
    assetIdsToLoad.push({
      id: audioSettings.musicAssetId,
      vol: Math.max(0, Math.min(1, audioSettings.musicVolume ?? 0.55)),
    });
  }
  if (audioSettings.voiceoverAssetId) {
    assetIdsToLoad.push({
      id: audioSettings.voiceoverAssetId,
      vol: Math.max(0, Math.min(1, audioSettings.voiceoverVolume ?? 0.9)),
    });
  }

  // Fallback to timeline audio clips if audioSettings didn't select them
  if (assetIdsToLoad.length === 0) {
    for (const clip of timeline.clips) {
      if (clip.trackType === 'audio' && clip.mediaAssetId) {
        assetIdsToLoad.push({
          id: clip.mediaAssetId,
          vol: Math.max(0, Math.min(1, clip.volume ?? 0.7)),
        });
      }
    }
  }

  for (const item of assetIdsToLoad.slice(0, 2)) {
    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, item.id), eq(mediaAssets.userId, userId)))
      .limit(1);
    if (!asset) continue;
    const ext = asset.extension.toLowerCase();
    if (!['mp3', 'wav', 'mp4', 'mov', 'webm'].includes(ext)) continue;

    try {
      const safePath = resolveSafeUserPath(UPLOADS_DIR, asset.storageKey);
      if (await fileExists(safePath)) {
        inputs.push({
          path: safePath,
          volume: item.vol,
          fadeInSec: Math.min(fadeInSec, durationSec * 0.25),
          fadeOutSec: Math.min(fadeOutSec, durationSec * 0.25),
        });
      }
    } catch {
      // Skip invalid paths
    }
  }

  return inputs;
}

async function writeBufferWithBackpressure(
  stream: NodeJS.WritableStream,
  buf: Buffer
): Promise<void> {
  if (stream.write(buf)) return;
  await new Promise<void>((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

async function emitProgressUpdate(
  jobId: number,
  userId: number,
  projectId: number,
  percent: number
): Promise<void> {
  const clamped = Math.max(0, Math.min(99, Math.round(percent)));
  await db
    .update(renderJobs)
    .set({ progressPercent: clamped, updatedAt: new Date() })
    .where(eq(renderJobs.id, jobId));

  studioWsHub.emitToUser(userId, 'render:progress', {
    jobId,
    projectId,
    status: 'processing',
    progressPercent: clamped,
  });
}

export async function runRenderJob(jobId: number): Promise<void> {
  await ensureStorageDirectories();
  ensureSystemFontsRegistered();

  const [job] = await db
    .select()
    .from(renderJobs)
    .where(eq(renderJobs.id, jobId))
    .limit(1);

  if (!job || job.status === 'cancelled') return;

  const handle: ActiveJobHandle = { cancelled: false };
  activeRenderJobs.set(jobId, handle);

  const jobTempKey = `user_${job.userId}_render_${jobId}`;
  const jobTempDir = resolveSafeUserPath(TEMP_DIR, jobTempKey);

  try {
    await db
      .update(renderJobs)
      .set({ status: 'processing', progressPercent: 2, updatedAt: new Date() })
      .where(eq(renderJobs.id, jobId));

    studioWsHub.emitToUser(job.userId, 'render:progress', {
      jobId,
      projectId: job.projectId,
      status: 'processing',
      progressPercent: 2,
    });

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, job.projectId), eq(projects.userId, job.userId)))
      .limit(1);

    if (!project) {
      throw new Error('پروژه برای رندر یافت نشد.');
    }

    const scenes = await db
      .select()
      .from(projectScenes)
      .where(eq(projectScenes.projectId, project.id))
      .orderBy(asc(projectScenes.orderIndex), asc(projectScenes.id));

    const existingTimeline = project.timelineData as TimelineDocument | null;
    const timeline: TimelineDocument =
      existingTimeline && Array.isArray(existingTimeline.clips) && existingTimeline.clips.length > 0
        ? existingTimeline
        : buildTimelineFromProjectScenes(project, scenes, null);

    const audioSettings: AudioSettingsDoc = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...((project.audioSettings as Partial<AudioSettingsDoc> | null) ?? {}),
    };

    const projectTargetMs = Math.max(3000, project.durationSeconds * 1000);
    const maxClipEnd = timeline.clips.reduce(
      (max, c) => Math.max(max, c.startTimeMs + c.durationMs),
      0
    );
    const totalDurationMs = Math.max(projectTargetMs, maxClipEnd);
    const durationSec = totalDurationMs / 1000;

    const quality = (['720p', '1080p', '4k'].includes(job.quality)
      ? job.quality
      : '1080p') as RenderQuality;
    const format = (['mp4', 'webm', 'gif', 'png'].includes(job.format)
      ? job.format
      : 'mp4') as RenderFormat;

    const { width, height } = computeRenderResolution(
      project.customWidth,
      project.customHeight,
      quality
    );

    const requestedFps = Math.max(12, Math.min(60, job.fps || timeline.fps || 30));
    const effectiveFps =
      format === 'gif'
        ? Math.min(15, requestedFps)
        : format === 'png'
        ? Math.min(10, requestedFps)
        : requestedFps;

    const totalFrames = Math.max(
      1,
      format === 'png'
        ? Math.min(60, Math.max(6, Math.round(durationSec * effectiveFps)))
        : Math.round(durationSec * effectiveFps)
    );

    // Preload image media assets into Canvas Images
    const imageCache = new Map<number, Image>();
    const imageAssetIds = new Set<number>();
    for (const clip of timeline.clips) {
      if (clip.mediaAssetId) imageAssetIds.add(clip.mediaAssetId);
    }

    if (imageAssetIds.size > 0) {
      const assets = await db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.userId, job.userId));

      for (const asset of assets) {
        if (!imageAssetIds.has(asset.id)) continue;
        const ext = asset.extension.toLowerCase();
        if (!['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) continue;
        try {
          const safePath = resolveSafeUserPath(UPLOADS_DIR, asset.storageKey);
          const buf = await fs.readFile(safePath);
          const img = await loadImage(buf);
          imageCache.set(asset.id, img);
        } catch {
          // Non-fatal: skip broken/unsupported image asset
        }
      }
    }

    await fs.mkdir(jobTempDir, { recursive: true });
    const exportExt = format === 'png' ? 'zip' : format;
    const tempOutputPath = path.join(jobTempDir, `render_${jobId}.${exportExt}`);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (format === 'png') {
      const zip = new JSZip();
      const stepMs = totalDurationMs / Math.max(1, totalFrames - 1);
      let lastReported = 5;

      for (let i = 0; i < totalFrames; i++) {
        if (handle.cancelled) {
          throw new Error('__CANCELLED__');
        }
        const timeMs = Math.min(totalDurationMs, Math.round(i * stepMs));
        drawTimelineFrame(ctx, width, height, timeMs, timeline, imageCache);
        const pngBuffer = canvas.toBuffer('image/png');
        const frameName = `frame_${String(i + 1).padStart(4, '0')}.png`;
        zip.file(frameName, pngBuffer);

        const pct = 5 + Math.floor(((i + 1) / totalFrames) * 85);
        if (pct >= lastReported + 10) {
          lastReported = pct;
          await emitProgressUpdate(jobId, job.userId, job.projectId, pct);
        }
      }

      zip.file(
        'manifest.json',
        JSON.stringify(
          {
            projectId: project.id,
            title: project.title,
            width,
            height,
            frameCount: totalFrames,
            durationMs: totalDurationMs,
            quality,
            exportedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );

      const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      await fs.writeFile(tempOutputPath, zipBuf);
    } else {
      const audioInputs =
        format === 'mp4' || format === 'webm'
          ? await resolveAudioTracks(job.userId, audioSettings, timeline, durationSec)
          : [];

      const args: string[] = [
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgba',
        '-s',
        `${width}x${height}`,
        '-r',
        String(effectiveFps),
        '-i',
        'pipe:0',
      ];

      for (const aud of audioInputs) {
        args.push('-stream_loop', '-1', '-i', aud.path);
      }

      const filterParts: string[] = [];
      let audioMapArg: string | null = null;
      if (audioInputs.length === 1) {
        const a = audioInputs[0];
        const fadeOutStart = Math.max(0, durationSec - a.fadeOutSec);
        filterParts.push(
          `[1:a]atrim=0:${durationSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${a.volume.toFixed(2)},afade=t=in:st=0:d=${a.fadeInSec.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${a.fadeOutSec.toFixed(2)}[aout]`
        );
        audioMapArg = '[aout]';
      } else if (audioInputs.length >= 2) {
        const a0 = audioInputs[0];
        const a1 = audioInputs[1];
        const fadeOutStart = Math.max(0, durationSec - Math.max(a0.fadeOutSec, a1.fadeOutSec));
        filterParts.push(
          `[1:a]atrim=0:${durationSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${a0.volume.toFixed(2)}[a0]`,
          `[2:a]atrim=0:${durationSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${a1.volume.toFixed(2)}[a1]`,
          `[a0][a1]amix=inputs=2:duration=longest:normalize=0,afade=t=in:st=0:d=${a0.fadeInSec.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${Math.max(a0.fadeOutSec, a1.fadeOutSec).toFixed(2)}[aout]`
        );
        audioMapArg = '[aout]';
      }

      if (format === 'gif') {
        args.push(
          '-vf',
          'split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer',
          '-loop',
          '0',
          tempOutputPath
        );
      } else {
        if (filterParts.length > 0 && audioMapArg) {
          args.push('-filter_complex', filterParts.join(';'), '-map', '0:v:0', '-map', audioMapArg);
        } else {
          args.push('-map', '0:v:0');
        }

        if (format === 'mp4') {
          args.push(
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            quality === '4k' ? '18' : quality === '1080p' ? '21' : '24',
            '-pix_fmt',
            'yuv420p',
            '-movflags',
            '+faststart'
          );
          if (audioMapArg) {
            args.push('-c:a', 'aac', '-b:a', '160k', '-shortest');
          }
        } else {
          // webm
          args.push(
            '-c:v',
            'libvpx-vp9',
            '-b:v',
            quality === '4k' ? '4M' : quality === '1080p' ? '2M' : '1M',
            '-deadline',
            'realtime',
            '-cpu-used',
            '6',
            '-pix_fmt',
            'yuv420p'
          );
          if (audioMapArg) {
            args.push('-c:a', 'libopus', '-b:a', '128k', '-shortest');
          }
        }
        args.push('-t', durationSec.toFixed(3), tempOutputPath);
      }

      const ffProc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
      handle.proc = ffProc;

      let stderrTail = '';
      ffProc.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2500);
      });

      const exitPromise = new Promise<void>((resolve, reject) => {
        ffProc.once('error', (err) => reject(err));
        ffProc.once('close', (code) => {
          if (handle.cancelled) {
            reject(new Error('__CANCELLED__'));
          } else if (code === 0) {
            resolve();
          } else {
            reject(new Error(`خطای FFmpeg (کد ${code}): ${stderrTail.trim().slice(-240)}`));
          }
        });
      });

      let lastReported = 5;
      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        if (handle.cancelled) {
          ffProc.kill('SIGKILL');
          throw new Error('__CANCELLED__');
        }
        const timeMs = (frameIdx / effectiveFps) * 1000;
        drawTimelineFrame(ctx, width, height, timeMs, timeline, imageCache);
        const rgbaBuffer = canvas.data();
        await writeBufferWithBackpressure(ffProc.stdin!, rgbaBuffer);

        const pct = 5 + Math.floor(((frameIdx + 1) / totalFrames) * 85);
        if (pct >= lastReported + 8) {
          lastReported = pct;
          await emitProgressUpdate(jobId, job.userId, job.projectId, pct);
        }
      }

      ffProc.stdin!.end();
      await emitProgressUpdate(jobId, job.userId, job.projectId, 93);
      await exitPromise;
    }

    if (handle.cancelled) {
      throw new Error('__CANCELLED__');
    }

    const stat = await fs.stat(tempOutputPath);
    if (!stat.size || stat.size < 64) {
      throw new Error('فایل خروجی تولیدشده خالی است.');
    }

    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.id, job.userId))
      .limit(1);

    if (owner && owner.storageUsedBytes + stat.size > owner.storageQuotaBytes) {
      throw new Error('فضای ذخیره‌سازی حساب برای ذخیره فایل خروجی کافی نیست.');
    }

    const userExportDir = path.join(EXPORTS_DIR, `user_${job.userId}`);
    await fs.mkdir(userExportDir, { recursive: true });
    const relativeStorageKey = path.join(`user_${job.userId}`, `job_${jobId}.${exportExt}`);
    const finalExportPath = resolveSafeUserPath(EXPORTS_DIR, relativeStorageKey);
    await fs.copyFile(tempOutputPath, finalExportPath);

    await db
      .update(renderJobs)
      .set({
        status: 'completed',
        progressPercent: 100,
        outputPath: relativeStorageKey,
        outputSizeBytes: stat.size,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(renderJobs.id, jobId));

    await db
      .update(users)
      .set({
        storageUsedBytes: sql`${users.storageUsedBytes} + ${stat.size}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, job.userId));

    await db
      .update(projects)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(projects.id, job.projectId));

    await logActivity(
      job.userId,
      'render.completed',
      `خروجی ${format.toUpperCase()} (${quality}) برای پروژه «${project.title}» آماده دانلود شد`,
      job.projectId,
      { jobId, format, quality, sizeBytes: stat.size }
    );

    studioWsHub.emitToUser(job.userId, 'render:completed', {
      jobId,
      projectId: job.projectId,
      format,
      quality,
      outputSizeBytes: stat.size,
    });
  } catch (err) {
    const isCancelled = err instanceof Error && err.message === '__CANCELLED__';
    const message =
      err instanceof Error ? err.message : 'خطای ناشناخته در پردازش رندر ویدئو';

    if (isCancelled || handle.cancelled) {
      await db
        .update(renderJobs)
        .set({
          status: 'cancelled',
          errorMessage: 'توسط کاربر لغو شد.',
          updatedAt: new Date(),
        })
        .where(eq(renderJobs.id, jobId));

      await db
        .update(projects)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(eq(projects.id, job.projectId));

      studioWsHub.emitToUser(job.userId, 'render:cancelled', {
        jobId,
        projectId: job.projectId,
      });
    } else {
      console.error(`Render job ${jobId} failed:`, err);
      await db
        .update(renderJobs)
        .set({
          status: 'failed',
          errorMessage: message.slice(0, 400),
          updatedAt: new Date(),
        })
        .where(eq(renderJobs.id, jobId));

      await db
        .update(projects)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(eq(projects.id, job.projectId));

      await logActivity(
        job.userId,
        'render.failed',
        `رندر پروژه با خطا متوقف شد: ${message.slice(0, 120)}`,
        job.projectId,
        { jobId }
      );

      studioWsHub.emitToUser(job.userId, 'render:failed', {
        jobId,
        projectId: job.projectId,
        error: message,
      });
    }
  } finally {
    activeRenderJobs.delete(jobId);
    await cleanupTempJobDir(jobTempKey).catch(() => {});
  }
}

export function startRenderJobInBackground(jobId: number): void {
  setImmediate(() => {
    void runRenderJob(jobId);
  });
}

export function signalRenderJobCancellation(jobId: number): boolean {
  const handle = activeRenderJobs.get(jobId);
  if (!handle) return false;
  handle.cancelled = true;
  if (handle.proc && !handle.proc.killed) {
    try {
      handle.proc.kill('SIGKILL');
    } catch {
      // Ignore kill error if process already exited
    }
  }
  return true;
}
