import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Type } from '@google/genai';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { aiProviders, referenceScenes, referenceVideos } from '../db/schema.ts';
import { logActivity } from '../db/users.ts';
import { getGeminiClient, isGeminiConfigured } from './gemini.ts';
import { FRAMES_DIR, resolveSafeUserPath } from './storage.ts';
import { studioWsHub } from './ws.ts';

const execFileAsync = promisify(execFile);

export interface VideoProbeInfo {
  durationMs: number;
  width: number;
  height: number;
  fps: string;
  hasAudio: boolean;
}

export interface SceneInterval {
  sceneNumber: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
}

export async function probeVideoMetadata(filePath: string): Promise<VideoProbeInfo> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeout: 15000 }
  );

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      duration?: string;
    }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');

  const rawDurSec = Number(parsed.format?.duration || videoStream?.duration || 0);
  const durationMs = Math.max(1000, Math.round(rawDurSec * 1000));

  let fps = '30';
  if (videoStream?.r_frame_rate && videoStream.r_frame_rate.includes('/')) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (den > 0 && num > 0) {
      fps = (num / den).toFixed(2).replace(/\.00$/, '');
    }
  }

  return {
    durationMs,
    width: videoStream?.width || 1080,
    height: videoStream?.height || 1920,
    fps,
    hasAudio: Boolean(audioStream),
  };
}

export async function detectSceneSegments(
  filePath: string,
  durationMs: number
): Promise<SceneInterval[]> {
  const cutTimesMs: number[] = [];

  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      ['-i', filePath, '-vf', "select='gt(scene,0.28)',showinfo", '-f', 'null', '-'],
      { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
    );

    const matches = stderr.matchAll(/pts_time:([0-9.]+)/g);
    for (const m of matches) {
      const ms = Math.round(Number(m[1]) * 1000);
      if (ms > 600 && ms < durationMs - 600) {
        const last = cutTimesMs[cutTimesMs.length - 1] ?? 0;
        if (ms - last >= 800) {
          cutTimesMs.push(ms);
        }
      }
    }
  } catch {
    // Fallback to uniform scene sampling if scene filter exits non-zero
  }

  // If continuous motion graphic with < 2 hard cuts, sample evenly into 3-8 scenes
  if (cutTimesMs.length < 2) {
    const targetScenes = Math.max(3, Math.min(8, Math.round(durationMs / 3000)));
    const step = Math.floor(durationMs / targetScenes);
    cutTimesMs.length = 0;
    for (let i = 1; i < targetScenes; i++) {
      cutTimesMs.push(i * step);
    }
  }

  const boundaries = [0, ...cutTimesMs.slice(0, 9), durationMs];
  const intervals: SceneInterval[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startTimeMs = boundaries[i];
    const endTimeMs = boundaries[i + 1];
    const segDur = endTimeMs - startTimeMs;
    if (segDur >= 300) {
      intervals.push({
        sceneNumber: intervals.length + 1,
        startTimeMs,
        endTimeMs,
        durationMs: segDur,
      });
    }
  }

  if (intervals.length === 0) {
    intervals.push({
      sceneNumber: 1,
      startTimeMs: 0,
      endTimeMs: durationMs,
      durationMs,
    });
  }

  return intervals;
}

export async function extractSceneKeyframe(
  filePath: string,
  midpointMs: number,
  outPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const sec = (midpointMs / 1000).toFixed(3);
  await execFileAsync(
    'ffmpeg',
    ['-y', '-ss', sec, '-i', filePath, '-frames:v', '1', '-q:v', '3', '-vf', 'scale=640:-2', outPath],
    { timeout: 15000 }
  );
}

export async function extractDominantColors(framePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'ffmpeg',
      ['-v', 'error', '-i', framePath, '-vf', 'scale=16:16:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
      { encoding: 'buffer', timeout: 10000 }
    );

    const buckets = new Map<string, number>();
    for (let i = 0; i + 2 < stdout.length; i += 3) {
      // Quantize to 32-step grid to cluster visually distinct dominant colors
      const r = Math.min(255, Math.round(stdout[i] / 32) * 32);
      const g = Math.min(255, Math.round(stdout[i + 1] / 32) * 32);
      const b = Math.min(255, Math.round(stdout[i + 2] / 32) * 32);
      const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
        .toString(16)
        .padStart(2, '0')}`.toUpperCase();
      buckets.set(hex, (buckets.get(hex) ?? 0) + 1);
    }

    return [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([hex]) => hex);
  } catch {
    return ['#0F172A', '#3B82F6', '#F8FAFC'];
  }
}

interface GeminiSceneReport {
  sceneNumber: number;
  detectedText: string;
  textAnimation: string;
  visualEffects: string[];
  cameraMotion: string;
  transitionType: string;
  typographyNotes: string;
  aiDescription: string;
}

interface GeminiFullReport {
  overallSummary: {
    rhythm: string;
    bpmEstimate: string;
    audioVisualSync: string;
    visualStyle: string;
    typographyStyle: string;
    structureOverview: string;
  };
  scenes: GeminiSceneReport[];
}

async function runMultimodalGeminiAnalysis(
  userId: number,
  probe: VideoProbeInfo,
  scenesWithFrames: Array<SceneInterval & { frameBuffer: Buffer; colors: string[] }>,
  language: 'fa' | 'en'
): Promise<{ report: GeminiFullReport | null; errorNote?: string }> {
  if (!isGeminiConfigured()) {
    return {
      report: null,
      errorNote: 'کلید Gemini روی سرور تنظیم نشده است؛ تحلیل فنی با FFmpeg انجام شد.',
    };
  }

  try {
    const ai = getGeminiClient();
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [];

    const sceneSummaryText = scenesWithFrames
      .map(
        (s) =>
          `Scene ${s.sceneNumber}: start=${s.startTimeMs}ms, end=${s.endTimeMs}ms, duration=${s.durationMs}ms, dominantColors=${s.colors.join(',')}`
      )
      .join('\n');

    parts.push({
      text: `You are a senior motion graphics director and video editor. Analyze this commercial reference video (${probe.width}x${probe.height}, ${probe.fps}fps, total duration ${probe.durationMs}ms, hasAudio=${probe.hasAudio}).
I have extracted ${scenesWithFrames.length} keyframe images in chronological order corresponding to these exact FFmpeg timestamps:
${sceneSummaryText}

Output ALL descriptive fields in ${
        language === 'fa' ? 'natural, professional Persian (فارسی)' : 'clear professional English'
      }.
For each scene, analyze:
- detectedText: visible on-screen text/headline or "بدون متن"
- textAnimation: how text enters/exits (e.g., Slide Up + Fade, Kinetic Pop, Typewriter, Static)
- visualEffects: array of 1-4 concise visual effects (e.g., Glow, Motion Blur, Gradient Overlay, Vignette, Drop Shadow, Particle Dust)
- cameraMotion: camera/layer movement (e.g., Zoom In, Pan Left, Parallax, Static Lock)
- transitionType: transition into/out of scene (e.g., Cross Dissolve, Hard Cut, Whip Pan, Slide Wipe)
- typographyNotes: font family category, weight, alignment, contrast
- aiDescription: concise director note explaining what happens visually and why it works

And provide overallSummary covering rhythm, bpmEstimate, audioVisualSync, visualStyle, typographyStyle, and structureOverview (Hook -> Body -> CTA).`,
    });

    for (const sc of scenesWithFrames) {
      parts.push({
        text: `Keyframe for Scene ${sc.sceneNumber} (${sc.startTimeMs}ms - ${sc.endTimeMs}ms):`,
      });
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: sc.frameBuffer.toString('base64'),
        },
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallSummary: {
              type: Type.OBJECT,
              properties: {
                rhythm: { type: Type.STRING },
                bpmEstimate: { type: Type.STRING },
                audioVisualSync: { type: Type.STRING },
                visualStyle: { type: Type.STRING },
                typographyStyle: { type: Type.STRING },
                structureOverview: { type: Type.STRING },
              },
              required: [
                'rhythm',
                'bpmEstimate',
                'audioVisualSync',
                'visualStyle',
                'typographyStyle',
                'structureOverview',
              ],
            },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sceneNumber: { type: Type.INTEGER },
                  detectedText: { type: Type.STRING },
                  textAnimation: { type: Type.STRING },
                  visualEffects: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  cameraMotion: { type: Type.STRING },
                  transitionType: { type: Type.STRING },
                  typographyNotes: { type: Type.STRING },
                  aiDescription: { type: Type.STRING },
                },
                required: [
                  'sceneNumber',
                  'detectedText',
                  'textAnimation',
                  'visualEffects',
                  'cameraMotion',
                  'transitionType',
                  'typographyNotes',
                  'aiDescription',
                ],
              },
            },
          },
          required: ['overallSummary', 'scenes'],
        },
      },
    });

    await db
      .update(aiProviders)
      .set({
        quotaUsed: sql`${aiProviders.quotaUsed} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiProviders.userId, userId),
          eq(aiProviders.providerKey, 'gemini'),
          eq(aiProviders.capability, 'video_analysis')
        )
      );

    const parsed = JSON.parse((response.text ?? '{}').trim()) as GeminiFullReport;
    if (!parsed.overallSummary || !Array.isArray(parsed.scenes)) {
      return { report: null, errorNote: 'ساختار پاسخ هوش مصنوعی کامل نبود؛ گزارش فنی FFmpeg ثبت شد.' };
    }
    return { report: parsed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Gemini multimodal analysis error:', message);
    if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
      return {
        report: null,
        errorNote: 'سهمیه سرویس Gemini موقتاً به پایان رسیده است؛ تحلیل فریم و رنگ‌بندی با موتور محلی FFmpeg کامل شد.',
      };
    }
    return {
      report: null,
      errorNote: `تحلیل هوشمند با خطا مواجه شد (${message.slice(0, 120)})؛ فریم‌ها و رنگ‌ها با FFmpeg استخراج شدند.`,
    };
  }
}

export async function analyzeReferenceVideoJob(
  referenceVideoId: number,
  userId: number,
  projectId: number,
  videoFilePath: string,
  language: 'fa' | 'en'
): Promise<void> {
  try {
    await db
      .update(referenceVideos)
      .set({ analysisStatus: 'extracting_frames', analysisError: null, updatedAt: new Date() })
      .where(eq(referenceVideos.id, referenceVideoId));

    studioWsHub.emitToUser(userId, 'analysis:progress', {
      referenceVideoId,
      projectId,
      status: 'extracting_frames',
    });

    const probe = await probeVideoMetadata(videoFilePath);
    const intervals = await detectSceneSegments(videoFilePath, probe.durationMs);

    await db
      .update(referenceVideos)
      .set({
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        hasAudio: probe.hasAudio,
        analysisStatus: 'analyzing_ai',
        updatedAt: new Date(),
      })
      .where(eq(referenceVideos.id, referenceVideoId));

    studioWsHub.emitToUser(userId, 'analysis:progress', {
      referenceVideoId,
      projectId,
      status: 'analyzing_ai',
      sceneCount: intervals.length,
    });

    const scenesWithFrames: Array<
      SceneInterval & {
        frameStorageKey: string;
        frameBuffer: Buffer;
        colors: string[];
      }
    > = [];

    for (const seg of intervals) {
      const midpointMs = Math.round((seg.startTimeMs + seg.endTimeMs) / 2);
      const frameStorageKey = path.join(
        `user_${userId}`,
        `ref_${referenceVideoId}`,
        `scene_${seg.sceneNumber}.jpg`
      );
      const fullFramePath = resolveSafeUserPath(FRAMES_DIR, frameStorageKey);
      await extractSceneKeyframe(videoFilePath, midpointMs, fullFramePath);
      const [frameBuffer, colors] = await Promise.all([
        fs.readFile(fullFramePath),
        extractDominantColors(fullFramePath),
      ]);
      scenesWithFrames.push({
        ...seg,
        frameStorageKey,
        frameBuffer,
        colors,
      });
    }

    const aiResult = await runMultimodalGeminiAnalysis(
      userId,
      probe,
      scenesWithFrames,
      language
    );

    await db.delete(referenceScenes).where(eq(referenceScenes.referenceVideoId, referenceVideoId));

    const avgSceneSec = (probe.durationMs / 1000 / Math.max(1, scenesWithFrames.length)).toFixed(1);
    const fallbackSummary = {
      rhythm:
        Number(avgSceneSec) <= 2.5
          ? language === 'fa'
            ? 'ریتم تند و پرانرژی'
            : 'Fast-paced commercial rhythm'
          : language === 'fa'
          ? 'ریتم متعادل و روایت‌محور'
          : 'Balanced narrative rhythm',
      bpmEstimate: Number(avgSceneSec) <= 2.5 ? '115-130 BPM' : '90-108 BPM',
      audioVisualSync: probe.hasAudio
        ? language === 'fa'
          ? 'دارای ترک صوتی همگام با برش‌های صحنه'
          : 'Audio stream detected aligned with scene cuts'
        : language === 'fa'
        ? 'ویدئوی نمونه فاقد ترک صوتی است'
        : 'No audio track in reference video',
      visualStyle:
        language === 'fa'
          ? 'استخراج ساختار بصری و رنگ‌بندی با موتور FFmpeg'
          : 'Visual structure & palette extracted via FFmpeg',
      typographyStyle:
        language === 'fa'
          ? 'تایپوگرافی تبلیغاتی خوانا (بررسی محلی)'
          : 'Commercial display typography',
      structureOverview:
        language === 'fa'
          ? `${scenesWithFrames.length} صحنه با میانگین ${avgSceneSec} ثانیه`
          : `${scenesWithFrames.length} scenes averaging ${avgSceneSec}s each`,
      analysisMode: aiResult.report ? 'gemini_multimodal' : 'ffmpeg_local',
      note: aiResult.errorNote || null,
    };

    const overallSummary = aiResult.report
      ? {
          ...aiResult.report.overallSummary,
          analysisMode: 'gemini_multimodal',
          palette: [...new Set(scenesWithFrames.flatMap((s) => s.colors))].slice(0, 6),
        }
      : {
          ...fallbackSummary,
          palette: [...new Set(scenesWithFrames.flatMap((s) => s.colors))].slice(0, 6),
        };

    await db.insert(referenceScenes).values(
      scenesWithFrames.map((sc) => {
        const aiScene = aiResult.report?.scenes.find(
          (item) => item.sceneNumber === sc.sceneNumber
        );
        return {
          referenceVideoId,
          projectId,
          sceneNumber: sc.sceneNumber,
          startTimeMs: sc.startTimeMs,
          endTimeMs: sc.endTimeMs,
          durationMs: sc.durationMs,
          frameStorageKey: sc.frameStorageKey,
          detectedText: aiScene?.detectedText || (language === 'fa' ? 'در انتظار بازبینی دستی' : 'Pending review'),
          textAnimation: aiScene?.textAnimation || 'Fade + Slide',
          visualEffects: aiScene?.visualEffects?.length ? aiScene.visualEffects : ['Color Grading'],
          cameraMotion: aiScene?.cameraMotion || (language === 'fa' ? 'حرکت نرم دوربین' : 'Smooth Motion'),
          dominantColors: sc.colors,
          transitionType: aiScene?.transitionType || 'Cut / Cross Dissolve',
          typographyNotes: aiScene?.typographyNotes || (language === 'fa' ? 'سنس‌سریف مدرن' : 'Modern Sans'),
          aiDescription:
            aiScene?.aiDescription ||
            (language === 'fa'
              ? `فریم کلیدی صحنه ${sc.sceneNumber} در بازه ${(sc.startTimeMs / 1000).toFixed(1)} تا ${(sc.endTimeMs / 1000).toFixed(1)} ثانیه استخراج شد.`
              : `Scene ${sc.sceneNumber} extracted from ${(sc.startTimeMs / 1000).toFixed(1)}s to ${(sc.endTimeMs / 1000).toFixed(1)}s.`),
        };
      })
    );

    await db
      .update(referenceVideos)
      .set({
        analysisStatus: 'completed',
        overallSummary,
        analysisError: aiResult.errorNote || null,
        updatedAt: new Date(),
      })
      .where(eq(referenceVideos.id, referenceVideoId));

    await logActivity(
      userId,
      'reference.analyzed',
      `تحلیل ویدئوی نمونه (#${referenceVideoId}) با ${scenesWithFrames.length} صحنه تکمیل شد`,
      projectId
    );

    studioWsHub.emitToUser(userId, 'analysis:completed', {
      referenceVideoId,
      projectId,
      sceneCount: scenesWithFrames.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای ناشناخته در تحلیل ویدئو';
    console.error('Reference video analysis failed:', err);
    await db
      .update(referenceVideos)
      .set({
        analysisStatus: 'failed',
        analysisError: message,
        updatedAt: new Date(),
      })
      .where(eq(referenceVideos.id, referenceVideoId));

    studioWsHub.emitToUser(userId, 'analysis:failed', {
      referenceVideoId,
      projectId,
      error: message,
    });
  }
}

export interface BriefImageInput {
  assetId: number;
  filePath: string;
  mimeType: string;
  displayName: string;
}

export interface BriefProjectContext {
  title: string;
  topic: string;
  businessName: string;
  productType: string;
  targetAudience: string;
  designStyle: string;
  durationSeconds: number;
  aspectRatio: string;
}

export async function convertImageToKeyframe(
  inputImagePath: string,
  outJpegPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(outJpegPath), { recursive: true });
  await execFileAsync(
    'ffmpeg',
    ['-y', '-i', inputImagePath, '-vf', 'scale=640:-2', '-frames:v', '1', '-q:v', '3', outJpegPath],
    { timeout: 15000 }
  );
}

interface GeminiBriefSceneReport {
  sceneNumber: number;
  imageIndex: number;
  durationSharePercent: number;
  detectedText: string;
  textAnimation: string;
  visualEffects: string[];
  cameraMotion: string;
  dominantColors: string[];
  transitionType: string;
  typographyNotes: string;
  aiDescription: string;
}

interface GeminiBriefReport {
  overallSummary: {
    rhythm: string;
    bpmEstimate: string;
    audioVisualSync: string;
    visualStyle: string;
    typographyStyle: string;
    structureOverview: string;
    palette: string[];
  };
  scenes: GeminiBriefSceneReport[];
}

async function runBriefGeminiAnalysis(
  userId: number,
  description: string,
  preparedImages: Array<{
    index: number;
    displayName: string;
    frameBuffer: Buffer;
    colors: string[];
  }>,
  projectContext: BriefProjectContext,
  language: 'fa' | 'en'
): Promise<{ report: GeminiBriefReport | null; errorNote?: string }> {
  if (!isGeminiConfigured()) {
    return {
      report: null,
      errorNote: 'کلید Gemini روی سرور تنظیم نشده است؛ استوری‌بورد پایه از توضیحات و رنگ‌های استخراج‌شده ساخته شد.',
    };
  }

  try {
    const ai = getGeminiClient();
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [];

    const imageNote = preparedImages.length
      ? preparedImages
          .map(
            (img) =>
              `Image #${img.index} (${img.displayName}): extracted dominant colors ${img.colors.join(', ')}`
          )
          .join('\n')
      : 'No reference images provided; design based purely on the text brief and project metadata.';

    parts.push({
      text: `You are a senior motion graphics director. The user does NOT have a reference video and has instead provided a creative text description and/or reference images.
Project Info:
- Title: ${projectContext.title}
- Topic: ${projectContext.topic || 'Commercial promotion'}
- Business: ${projectContext.businessName || 'Brand'}
- Product/Service: ${projectContext.productType || 'Product'}
- Target Audience: ${projectContext.targetAudience || 'General audience'}
- Design Style: ${projectContext.designStyle}
- Aspect Ratio: ${projectContext.aspectRatio}
- Total Target Duration: ${projectContext.durationSeconds} seconds

User's Creative Brief / Description:
${description || '(User provided reference images without text notes; infer the best commercial ad direction from the images.)'}

Reference Images Provided (${preparedImages.length}):
${imageNote}

Design a compelling 4 to 6 scene motion graphics storyboard that matches the user's description and images.
Output ALL descriptive fields in ${
        language === 'fa' ? 'natural, professional Persian (فارسی)' : 'clear professional English'
      }.
For each scene:
- sceneNumber: 1..N
- imageIndex: integer index (0 to ${Math.max(0, preparedImages.length - 1)}) if this scene should prominently feature one of the uploaded reference images, or -1 if it is a pure motion-graphics/typography scene
- durationSharePercent: percentage of total video duration (sum across all scenes ~100)
- detectedText: suggested short punchy on-screen commercial headline/copy for that scene
- textAnimation: motion preset (e.g., Slide Up + Fade, Kinetic Pop, Mask Reveal, Typewriter)
- visualEffects: 1-4 concise effects (e.g., Soft Glow, Gradient Overlay, Parallax Depth, Light Sweep)
- cameraMotion: layer/camera movement (e.g., Smooth Zoom In, Pan Left, Parallax Push)
- dominantColors: 3-4 hex colors (#RRGGBB) matching the brand/reference images
- transitionType: transition into/out of scene (e.g., Whip Pan, Cross Dissolve, Scale Zoom Cut)
- typographyNotes: font style, weight, alignment, contrast notes
- aiDescription: clear director's note for how this scene looks and animates`,
    });

    for (const img of preparedImages) {
      parts.push({
        text: `Reference Image #${img.index} (${img.displayName}):`,
      });
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: img.frameBuffer.toString('base64'),
        },
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallSummary: {
              type: Type.OBJECT,
              properties: {
                rhythm: { type: Type.STRING },
                bpmEstimate: { type: Type.STRING },
                audioVisualSync: { type: Type.STRING },
                visualStyle: { type: Type.STRING },
                typographyStyle: { type: Type.STRING },
                structureOverview: { type: Type.STRING },
                palette: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'rhythm',
                'bpmEstimate',
                'audioVisualSync',
                'visualStyle',
                'typographyStyle',
                'structureOverview',
                'palette',
              ],
            },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sceneNumber: { type: Type.INTEGER },
                  imageIndex: { type: Type.INTEGER },
                  durationSharePercent: { type: Type.NUMBER },
                  detectedText: { type: Type.STRING },
                  textAnimation: { type: Type.STRING },
                  visualEffects: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  cameraMotion: { type: Type.STRING },
                  dominantColors: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  transitionType: { type: Type.STRING },
                  typographyNotes: { type: Type.STRING },
                  aiDescription: { type: Type.STRING },
                },
                required: [
                  'sceneNumber',
                  'imageIndex',
                  'durationSharePercent',
                  'detectedText',
                  'textAnimation',
                  'visualEffects',
                  'cameraMotion',
                  'dominantColors',
                  'transitionType',
                  'typographyNotes',
                  'aiDescription',
                ],
              },
            },
          },
          required: ['overallSummary', 'scenes'],
        },
      },
    });

    await db
      .update(aiProviders)
      .set({
        quotaUsed: sql`${aiProviders.quotaUsed} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiProviders.userId, userId),
          eq(aiProviders.providerKey, 'gemini'),
          eq(aiProviders.capability, 'video_analysis')
        )
      );

    const parsed = JSON.parse((response.text ?? '{}').trim()) as GeminiBriefReport;
    if (!parsed.overallSummary || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      return { report: null, errorNote: 'ساختار پاسخ هوش مصنوعی کامل نبود؛ استوری‌بورد پایه ایجاد شد.' };
    }
    return { report: parsed };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Gemini brief/image analysis error:', message);
    if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
      return {
        report: null,
        errorNote: 'سهمیه سرویس Gemini موقتاً به پایان رسیده است؛ استوری‌بورد پایه با استفاده از رنگ‌های تصاویر و اطلاعات پروژه ساخته شد.',
      };
    }
    return {
      report: null,
      errorNote: `تحلیل هوشمند با خطا مواجه شد (${message.slice(0, 100)})؛ استوری‌بورد پایه ساخته شد.`,
    };
  }
}

export async function analyzeCreativeBriefJob(
  referenceVideoId: number,
  userId: number,
  projectId: number,
  options: {
    description: string;
    images: BriefImageInput[];
    projectContext: BriefProjectContext;
    language: 'fa' | 'en';
  }
): Promise<void> {
  const { description, images, projectContext, language } = options;
  const totalDurationMs = Math.max(5000, projectContext.durationSeconds * 1000);

  try {
    await db
      .update(referenceVideos)
      .set({ analysisStatus: 'extracting_frames', analysisError: null, updatedAt: new Date() })
      .where(eq(referenceVideos.id, referenceVideoId));

    studioWsHub.emitToUser(userId, 'analysis:progress', {
      referenceVideoId,
      projectId,
      status: 'extracting_frames',
    });

    const preparedImages: Array<{
      index: number;
      assetId: number;
      displayName: string;
      frameStorageKey: string;
      frameBuffer: Buffer;
      colors: string[];
    }> = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const frameStorageKey = path.join(
        `user_${userId}`,
        `ref_${referenceVideoId}`,
        `image_${i + 1}.jpg`
      );
      const fullFramePath = resolveSafeUserPath(FRAMES_DIR, frameStorageKey);
      await convertImageToKeyframe(img.filePath, fullFramePath);
      const [frameBuffer, colors] = await Promise.all([
        fs.readFile(fullFramePath),
        extractDominantColors(fullFramePath),
      ]);
      preparedImages.push({
        index: i,
        assetId: img.assetId,
        displayName: img.displayName,
        frameStorageKey,
        frameBuffer,
        colors,
      });
    }

    await db
      .update(referenceVideos)
      .set({ analysisStatus: 'analyzing_ai', updatedAt: new Date() })
      .where(eq(referenceVideos.id, referenceVideoId));

    studioWsHub.emitToUser(userId, 'analysis:progress', {
      referenceVideoId,
      projectId,
      status: 'analyzing_ai',
    });

    const aiResult = await runBriefGeminiAnalysis(
      userId,
      description,
      preparedImages,
      projectContext,
      language
    );

    const extractedPalette = [...new Set(preparedImages.flatMap((img) => img.colors))];
    const defaultPalette =
      extractedPalette.length > 0 ? extractedPalette.slice(0, 6) : ['#0F172A', '#2563EB', '#F8FAFC', '#38BDF8'];

    let rawScenes: GeminiBriefSceneReport[];
    if (aiResult.report) {
      rawScenes = aiResult.report.scenes;
    } else {
      const count = Math.max(4, preparedImages.length || 4);
      const share = 100 / count;
      rawScenes = Array.from({ length: count }, (_, idx) => {
        const mappedImg = preparedImages[idx % Math.max(1, preparedImages.length)];
        const sceneLabel =
          idx === 0
            ? projectContext.businessName || projectContext.title
            : idx === count - 1
            ? language === 'fa'
              ? 'همین حالا سفارش دهید'
              : 'Get Started Today'
            : projectContext.topic || projectContext.productType || `Scene ${idx + 1}`;
        return {
          sceneNumber: idx + 1,
          imageIndex: mappedImg ? mappedImg.index : -1,
          durationSharePercent: share,
          detectedText: sceneLabel,
          textAnimation: idx === 0 ? 'Kinetic Pop + Scale' : 'Slide Up + Fade',
          visualEffects: ['Soft Glow', 'Gradient Overlay'],
          cameraMotion: idx % 2 === 0 ? 'Smooth Zoom In' : 'Parallax Pan',
          dominantColors: mappedImg?.colors?.length ? mappedImg.colors : defaultPalette,
          transitionType: idx === count - 1 ? 'Fade Out' : 'Cross Dissolve',
          typographyNotes: language === 'fa' ? 'وزیرمتن بولد با کنتراست بالا' : 'Bold modern sans-serif',
          aiDescription:
            description
              ? `${language === 'fa' ? 'صحنه طراحی‌شده بر اساس توضیحات: ' : 'Designed from brief: '}${description.slice(0, 140)}`
              : language === 'fa'
              ? `صحنه ${idx + 1} متناسب با سبک ${projectContext.designStyle} برای معرفی ${projectContext.productType || projectContext.title}.`
              : `Scene ${idx + 1} styled in ${projectContext.designStyle} showcasing ${projectContext.productType || projectContext.title}.`,
        };
      });
    }

    // Normalize percentages into exact start/end/duration timestamps
    const totalShare = rawScenes.reduce((acc, s) => acc + Math.max(5, Number(s.durationSharePercent) || 20), 0);
    let cursorMs = 0;
    const normalizedScenes = rawScenes.map((sc, idx) => {
      const isLast = idx === rawScenes.length - 1;
      const weight = Math.max(5, Number(sc.durationSharePercent) || 20) / totalShare;
      const dur = isLast
        ? Math.max(500, totalDurationMs - cursorMs)
        : Math.max(800, Math.round(totalDurationMs * weight));
      const startTimeMs = cursorMs;
      const endTimeMs = isLast ? totalDurationMs : Math.min(totalDurationMs, cursorMs + dur);
      cursorMs = endTimeMs;

      const linkedImg =
        sc.imageIndex >= 0 && sc.imageIndex < preparedImages.length
          ? preparedImages[sc.imageIndex]
          : null;

      const validColors = (Array.isArray(sc.dominantColors) ? sc.dominantColors : []).filter((c) =>
        /^#[0-9A-Fa-f]{6}$/.test(c)
      );

      return {
        referenceVideoId,
        projectId,
        sceneNumber: idx + 1,
        startTimeMs,
        endTimeMs,
        durationMs: Math.max(500, endTimeMs - startTimeMs),
        frameStorageKey: linkedImg ? linkedImg.frameStorageKey : '',
        detectedText: sc.detectedText || projectContext.title,
        textAnimation: sc.textAnimation || 'Slide Up + Fade',
        visualEffects: sc.visualEffects?.length ? sc.visualEffects : ['Gradient Overlay'],
        cameraMotion: sc.cameraMotion || 'Smooth Zoom In',
        dominantColors: validColors.length
          ? validColors.map((c) => c.toUpperCase())
          : linkedImg?.colors || defaultPalette,
        transitionType: sc.transitionType || 'Cross Dissolve',
        typographyNotes: sc.typographyNotes || (language === 'fa' ? 'تایپوگرافی مدرن بولد' : 'Modern Bold Sans'),
        aiDescription: sc.aiDescription || '',
      };
    });

    await db.delete(referenceScenes).where(eq(referenceScenes.referenceVideoId, referenceVideoId));
    await db.insert(referenceScenes).values(normalizedScenes);

    const overallSummary = {
      ...(aiResult.report
        ? aiResult.report.overallSummary
        : {
            rhythm: language === 'fa' ? 'ریتم تبلیغاتی پویا' : 'Dynamic commercial pacing',
            bpmEstimate: '110-124 BPM',
            audioVisualSync:
              language === 'fa'
                ? 'آماده همگام‌سازی ضرب‌آهنگ با برش صحنه‌ها'
                : 'Ready for beat-synced scene cuts',
            visualStyle: projectContext.designStyle,
            typographyStyle: language === 'fa' ? 'تیترهای بولد خوانا با سلسله‌مراتب واضح' : 'Bold display typography',
            structureOverview:
              language === 'fa'
                ? `طراحی ${normalizedScenes.length} صحنه بر اساس توضیحات و تصاویر ورودی (قلاب آغازین -> معرفی مزیت -> دعوت به اقدام)`
                : `${normalizedScenes.length}-scene storyboard generated from creative brief & images`,
            palette: defaultPalette,
          }),
      palette:
        aiResult.report?.overallSummary.palette?.length
          ? aiResult.report.overallSummary.palette
          : defaultPalette,
      analysisMode: aiResult.report
        ? images.length > 0
          ? 'gemini_image_brief'
          : 'gemini_text_brief'
        : 'local_brief_fallback',
      inputBrief: description,
      inputAssetIds: images.map((img) => img.assetId),
      note: aiResult.errorNote || null,
    };

    await db
      .update(referenceVideos)
      .set({
        analysisStatus: 'completed',
        overallSummary,
        analysisError: aiResult.errorNote || null,
        updatedAt: new Date(),
      })
      .where(eq(referenceVideos.id, referenceVideoId));

    await logActivity(
      userId,
      'reference.brief_analyzed',
      `استوری‌بورد هوشمند (#${referenceVideoId}) از ${images.length > 0 ? `${images.length} تصویر و ` : ''}توضیحات متنی با ${normalizedScenes.length} صحنه ساخته شد`,
      projectId
    );

    studioWsHub.emitToUser(userId, 'analysis:completed', {
      referenceVideoId,
      projectId,
      sceneCount: normalizedScenes.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطای ناشناخته در طراحی استوری‌بورد از توضیحات/تصویر';
    console.error('Creative brief analysis failed:', err);
    await db
      .update(referenceVideos)
      .set({
        analysisStatus: 'failed',
        analysisError: message,
        updatedAt: new Date(),
      })
      .where(eq(referenceVideos.id, referenceVideoId));

    studioWsHub.emitToUser(userId, 'analysis:failed', {
      referenceVideoId,
      projectId,
      error: message,
    });
  }
}
