import {
  Film,
  Layers,
  Lock,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiFetch, fetchAuthenticatedBlobUrl } from '../lib/api.ts';
import {
  computeClipMotionFrameState,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_TIMELINE_TRACKS,
  type AudioSettingsDoc,
  type TimelineClipItem,
  type TimelineDocument,
  type TrackType,
} from '../shared/motionEngine.ts';
import {
  useStudioStore,
  type StudioMediaAsset,
  type StudioProject,
} from '../store/useStudioStore.ts';

function formatTimecode(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = clamped / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = (totalSec % 60).toFixed(1).padStart(4, '0');
  return `${String(mins).padStart(2, '0')}:${secs}`;
}

function wrapCanvasLines(
  ctx: CanvasRenderingContext2D,
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

export function TimelineEditorView({
  project,
  onProjectUpdated,
}: {
  project: StudioProject;
  onProjectUpdated: () => Promise<void>;
}) {
  const { getToken } = useAuth();
  const locale = useStudioStore((s) => s.locale);
  const timelinePulse = useStudioStore((s) => s.timelinePulse);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);

  const [timeline, setTimeline] = useState<TimelineDocument>({
    fps: 30,
    zoomPxPerSec: 60,
    tracks: DEFAULT_TIMELINE_TRACKS,
    clips: [],
  });
  const [undoStack, setUndoStack] = useState<TimelineDocument[]>([]);
  const [audioSettings, setAudioSettings] = useState<AudioSettingsDoc>(DEFAULT_AUDIO_SETTINGS);
  const [mediaAssets, setMediaAssets] = useState<StudioMediaAsset[]>([]);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopPlayback, setLoopPlayback] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const imageCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
  const audioBlobCacheRef = useRef<Map<number, string>>(new Map());
  const musicAudioElRef = useRef<HTMLAudioElement | null>(null);
  const voiceAudioElRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  const totalDurationMs = useMemo(() => {
    const projectTargetMs = Math.max(5000, project.durationSeconds * 1000);
    const maxClipEnd = timeline.clips.reduce(
      (max, c) => Math.max(max, c.startTimeMs + c.durationMs),
      0
    );
    return Math.max(projectTargetMs, maxClipEnd);
  }, [project.durationSeconds, timeline.clips]);

  const selectedClip = useMemo(
    () => timeline.clips.find((c) => c.id === selectedClipId) ?? null,
    [timeline.clips, selectedClipId]
  );

  const loadTimeline = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await apiFetch<{
        timelineData: TimelineDocument;
        audioSettings: AudioSettingsDoc;
        mediaAssets: StudioMediaAsset[];
      }>(`/api/projects/${project.id}/timeline`, {}, token);

      setTimeline(data.timelineData);
      setAudioSettings(data.audioSettings);
      setMediaAssets(data.mediaAssets);
      if (data.timelineData.clips.length > 0 && !selectedClipId) {
        setSelectedClipId(data.timelineData.clips[0].id);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در بارگذاری تایم‌لاین');
    } finally {
      setLoading(false);
    }
  }, [project.id, getToken, setErrorBanner]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline, timelinePulse]);

  // Preload referenced image & audio assets via authenticated Blob URLs
  useEffect(() => {
    let cancelled = false;
    const preloadAssets = async () => {
      const token = await getToken();
      if (!token) return;

      const assetIds = new Set<number>();
      for (const clip of timeline.clips) {
        if (clip.mediaAssetId) assetIds.add(clip.mediaAssetId);
      }
      if (audioSettings.musicAssetId) assetIds.add(audioSettings.musicAssetId);
      if (audioSettings.voiceoverAssetId) assetIds.add(audioSettings.voiceoverAssetId);

      for (const assetId of assetIds) {
        const asset = mediaAssets.find((a) => a.id === assetId);
        if (!asset) continue;

        const ext = asset.extension.toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext)) {
          if (imageCacheRef.current.has(assetId)) continue;
          try {
            const url = await fetchAuthenticatedBlobUrl(`/api/media/${assetId}/file`, token);
            if (cancelled) {
              URL.revokeObjectURL(url);
              continue;
            }
            const img = new Image();
            img.onload = () => {
              imageCacheRef.current.set(assetId, img);
            };
            img.src = url;
          } catch {
            // Ignore non-fatal asset preload error
          }
        } else if (['mp3', 'wav'].includes(ext)) {
          if (audioBlobCacheRef.current.has(assetId)) continue;
          try {
            const url = await fetchAuthenticatedBlobUrl(`/api/media/${assetId}/file`, token);
            if (cancelled) {
              URL.revokeObjectURL(url);
              continue;
            }
            audioBlobCacheRef.current.set(assetId, url);
          } catch {
            // Ignore non-fatal audio preload error
          }
        }
      }
    };

    void preloadAssets();
    return () => {
      cancelled = true;
    };
  }, [timeline.clips, audioSettings.musicAssetId, audioSettings.voiceoverAssetId, mediaAssets, getToken]);

  // Sync HTMLAudioElements with playback & volume settings
  useEffect(() => {
    const audioTrackMuted = timeline.tracks.find((t) => t.type === 'audio')?.muted ?? false;

    const syncAudioEl = (
      refObj: { current: HTMLAudioElement | null },
      assetId: number | null,
      volume: number
    ) => {
      if (!assetId || !audioBlobCacheRef.current.has(assetId)) {
        if (refObj.current) {
          refObj.current.pause();
          refObj.current = null;
        }
        return;
      }
      const srcUrl = audioBlobCacheRef.current.get(assetId)!;
      if (!refObj.current || refObj.current.src !== srcUrl) {
        if (refObj.current) refObj.current.pause();
        refObj.current = new Audio(srcUrl);
        refObj.current.loop = true;
      }
      refObj.current.volume = audioTrackMuted ? 0 : Math.max(0, Math.min(1, volume));
      if (isPlaying) {
        if (Math.abs(refObj.current.currentTime - playheadMs / 1000) > 0.35) {
          refObj.current.currentTime = (playheadMs / 1000) % (refObj.current.duration || 60);
        }
        void refObj.current.play().catch(() => {});
      } else {
        refObj.current.pause();
      }
    };

    syncAudioEl(musicAudioElRef, audioSettings.musicAssetId, audioSettings.musicVolume);
    syncAudioEl(voiceAudioElRef, audioSettings.voiceoverAssetId, audioSettings.voiceoverVolume);
  }, [
    isPlaying,
    audioSettings.musicAssetId,
    audioSettings.musicVolume,
    audioSettings.voiceoverAssetId,
    audioSettings.voiceoverVolume,
    timeline.tracks,
  ]);

  useEffect(() => {
    return () => {
      musicAudioElRef.current?.pause();
      voiceAudioElRef.current?.pause();
    };
  }, []);

  // Real-time Canvas Motion Renderer
  const drawFrame = useCallback(
    (timeMs: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0B0F17';
      ctx.fillRect(0, 0, W, H);

      const mutedTracks = new Set(
        timeline.tracks.filter((t) => t.muted).map((t) => t.id)
      );

      const activeClips = timeline.clips.filter(
        (c) => !mutedTracks.has(c.trackId) && c.trackType !== 'audio'
      );

      // Layering order: video -> overlay -> text
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

          // Subtle geometric studio accent glow
          const rad = ctx.createRadialGradient(
            W * 0.5,
            H * 0.35,
            W * 0.05,
            W * 0.5,
            H * 0.35,
            W * 0.75
          );
          rad.addColorStop(0, `${accent}38`);
          rad.addColorStop(1, 'transparent');
          ctx.fillStyle = rad;
          ctx.fillRect(0, 0, W, H);

          if (clip.mediaAssetId && imageCacheRef.current.has(clip.mediaAssetId)) {
            const img = imageCacheRef.current.get(clip.mediaAssetId)!;
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
          if (clip.mediaAssetId && imageCacheRef.current.has(clip.mediaAssetId)) {
            const img = imageCacheRef.current.get(clip.mediaAssetId)!;
            const drawW = Math.min(W * 0.32, img.width) * frame.scale;
            const drawH = drawW * (img.height / Math.max(1, img.width));
            ctx.drawImage(img, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
          } else if (clip.text) {
            const fs = Math.round((clip.fontSize ?? 36) * (W / 1080) * frame.scale);
            ctx.font = `700 ${fs}px "Vazirmatn", "Plus Jakarta Sans", sans-serif`;
            ctx.fillStyle = clip.textColor || '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(clip.text, cx, cy);
          }
        } else if (clip.trackType === 'text' && clip.text) {
          const cx = ((clip.xPercent ?? 50) / 100) * W + frame.translateX;
          const cy = ((clip.yPercent ?? 55) / 100) * H + frame.translateY;
          const scaledFontSize = Math.max(
            20,
            Math.round((clip.fontSize ?? 52) * (W / 1080) * frame.scale)
          );
          ctx.font = `700 ${scaledFontSize}px "Vazirmatn", "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const visibleLen = Math.max(
            1,
            Math.round(clip.text.length * frame.revealedCharRatio)
          );
          const visibleText = clip.text.slice(0, visibleLen);
          const lines = wrapCanvasLines(ctx, visibleText, W * 0.82);
          const lineHeight = scaledFontSize * 1.38;
          const startY = cy - ((lines.length - 1) * lineHeight) / 2;

          ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
          ctx.shadowBlur = 16;
          ctx.shadowOffsetY = 4;
          ctx.fillStyle = clip.textColor || '#F8FAFC';

          lines.forEach((line, idx) => {
            ctx.fillText(line, cx, startY + idx * lineHeight);
          });

          // Crisp accent underline
          const accentWidth = Math.min(W * 0.24, 180) * frame.scale;
          ctx.shadowBlur = 0;
          ctx.fillStyle = clip.accentColor || '#2563EB';
          ctx.fillRect(
            cx - accentWidth / 2,
            startY + lines.length * lineHeight * 0.65,
            accentWidth,
            Math.max(4, Math.round(W * 0.005))
          );
        }

        ctx.restore();
      }
    },
    [timeline.clips, timeline.tracks]
  );

  useEffect(() => {
    drawFrame(playheadMs);
  }, [playheadMs, drawFrame]);

  // 60fps requestAnimationFrame loop during playback
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    lastFrameTimeRef.current = performance.now();
    const tick = (now: number) => {
      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;
      setPlayheadMs((prev) => {
        const next = prev + delta;
        if (next >= totalDurationMs) {
          if (loopPlayback) return 0;
          setIsPlaying(false);
          return totalDurationMs;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, totalDurationMs, loopPlayback]);

  const commitTimelineEdit = (updater: (prev: TimelineDocument) => TimelineDocument) => {
    setTimeline((prev) => {
      setUndoStack((stack) => [...stack.slice(-9), prev]);
      return updater(prev);
    });
  };

  const handleUndo = () => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setTimeline(previous);
      return stack.slice(0, -1);
    });
  };

  const handleSaveTimeline = async (saveSnapshot = false) => {
    setSaving(true);
    setSavedFlag(false);
    setErrorBanner(null);
    try {
      const token = await getToken();
      await apiFetch(
        `/api/projects/${project.id}/timeline`,
        {
          method: 'PUT',
          body: JSON.stringify({
            timelineData: timeline,
            audioSettings,
            saveSnapshot,
          }),
        },
        token
      );
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 2500);
      await onProjectUpdated();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در ذخیره تایم‌لاین');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncFromScenes = async () => {
    setSyncing(true);
    setErrorBanner(null);
    try {
      const token = await getToken();
      const res = await apiFetch<{ timelineData: TimelineDocument }>(
        `/api/projects/${project.id}/timeline/sync-scenes`,
        { method: 'POST' },
        token
      );
      setUndoStack((s) => [...s.slice(-9), timeline]);
      setTimeline(res.timelineData);
      setPlayheadMs(0);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در همگام‌سازی صحنه‌ها');
    } finally {
      setSyncing(false);
    }
  };

  const updateSelectedClip = (patch: Partial<TimelineClipItem>) => {
    if (!selectedClipId) return;
    commitTimelineEdit((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === selectedClipId ? { ...c, ...patch } : c)),
    }));
  };

  const handleSplitAtPlayhead = () => {
    if (!selectedClip) return;
    const start = selectedClip.startTimeMs;
    const end = start + selectedClip.durationMs;
    if (playheadMs <= start + 400 || playheadMs >= end - 400) {
      setErrorBanner(
        locale === 'fa'
          ? 'برای برش، پلی‌هد را در میانه کلیپ انتخاب‌شده قرار دهید.'
          : 'Place playhead inside the selected clip (at least 0.4s from edges) to split.'
      );
      return;
    }

    const firstDur = Math.round(playheadMs - start);
    const secondDur = Math.round(end - playheadMs);
    const splitCopy: TimelineClipItem = {
      ...selectedClip,
      id: `${selectedClip.id}-split-${Date.now()}`,
      label: `${selectedClip.label} (2)`,
      startTimeMs: Math.round(playheadMs),
      durationMs: secondDur,
    };

    commitTimelineEdit((prev) => ({
      ...prev,
      clips: prev.clips.flatMap((c) =>
        c.id === selectedClip.id ? [{ ...c, durationMs: firstDur }, splitCopy] : [c]
      ),
    }));
    setSelectedClipId(splitCopy.id);
  };

  const handleDeleteSelectedClip = () => {
    if (!selectedClipId) return;
    commitTimelineEdit((prev) => ({
      ...prev,
      clips: prev.clips.filter((c) => c.id !== selectedClipId),
    }));
    setSelectedClipId(null);
  };

  const handleAddCustomClip = (trackType: 'overlay' | 'audio') => {
    const newId = `${trackType}-${Date.now()}`;
    const newClip: TimelineClipItem =
      trackType === 'overlay'
        ? {
            id: newId,
            trackId: 'track-overlay',
            trackType: 'overlay',
            label: locale === 'fa' ? 'لایه گرافیک / لوگو' : 'Overlay Layer',
            startTimeMs: Math.round(playheadMs),
            durationMs: 3000,
            text: project.businessName || project.title,
            fontSize: 38,
            textColor: '#FFFFFF',
            animationPreset: 'kinetic_pop',
            transitionType: 'cross_dissolve',
            xPercent: 50,
            yPercent: 18,
            scale: 1,
            opacity: 1,
          }
        : {
            id: newId,
            trackId: 'track-audio',
            trackType: 'audio',
            label: locale === 'fa' ? 'افکت / موسیقی' : 'Audio Clip',
            startTimeMs: Math.round(playheadMs),
            durationMs: 4000,
            volume: 0.7,
          };

    commitTimelineEdit((prev) => ({
      ...prev,
      clips: [...prev.clips, newClip],
    }));
    setSelectedClipId(newId);
  };

  const toggleTrackProp = (trackId: string, prop: 'muted' | 'locked') => {
    commitTimelineEdit((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, [prop]: !t[prop] } : t)),
    }));
  };

  const handleRulerScrub = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = rulerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const ms = Math.min(totalDurationMs, Math.round((x / timeline.zoomPxPerSec) * 1000));
    setPlayheadMs(ms);
  };

  const audioAssets = mediaAssets.filter((a) =>
    ['mp3', 'wav'].includes(a.extension.toLowerCase())
  );

  const canvasAspectStyle = {
    aspectRatio: `${project.customWidth} / ${project.customHeight}`,
  };

  const timelineWidthPx = Math.max(
    720,
    Math.ceil((totalDurationMs / 1000) * timeline.zoomPxPerSec) + 80
  );
  const rulerTicksSec = Array.from(
    { length: Math.ceil(totalDurationMs / 1000) + 1 },
    (_, i) => i
  );

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827]">
        {locale === 'fa'
          ? 'در حال بارگذاری موتور پیش‌نمایش و تایم‌لاین...'
          : 'Loading real-time canvas & multi-track timeline...'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Studio Transport & Save Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5 dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPlayheadMs(0)}
            className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            title={locale === 'fa' ? 'بازگشت به ابتدا' : 'Rewind'}
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPlayheadMs((ms) => Math.max(0, ms - 200))}
            className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>
              {isPlaying
                ? locale === 'fa'
                  ? 'توقف'
                  : 'Pause'
                : locale === 'fa'
                ? 'پخش پیش‌نمایش'
                : 'Play Preview'}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPlayheadMs((ms) => Math.min(totalDurationMs, ms + 200))}
            className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <SkipForward className="h-4 w-4" />
          </button>

          <span
            dir="ltr"
            className="ms-2 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums"
          >
            {formatTimecode(playheadMs)} / {formatTimecode(totalDurationMs)}
          </span>

          <label className="ms-3 inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={loopPlayback}
              onChange={(e) => setLoopPlayback(e.target.checked)}
              className="h-3.5 w-3.5 rounded"
            />
            <span>{locale === 'fa' ? 'تکرار' : 'Loop'}</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={undoStack.length === 0}
            onClick={handleUndo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span>{locale === 'fa' ? 'بازگشت' : 'Undo'}</span>
          </button>
          <button
            type="button"
            disabled={syncing}
            onClick={handleSyncFromScenes}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{locale === 'fa' ? 'همگام‌سازی از صحنه‌ها' : 'Sync Scenes'}</span>
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSaveTimeline(false)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            <Save className="h-3.5 w-3.5" />
            <span>
              {saving
                ? locale === 'fa'
                  ? 'در حال ذخیره...'
                  : 'Saving...'
                : savedFlag
                ? locale === 'fa'
                  ? 'ذخیره شد'
                  : 'Saved'
                : locale === 'fa'
                ? 'ذخیره تایم‌لاین'
                : 'Save Timeline'}
            </span>
          </button>
        </div>
      </div>

      {/* Live Canvas Stage + Clip/Audio Inspector */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Live Canvas Viewport */}
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-[#090D16] p-5 dark:border-slate-800 lg:col-span-7">
          <div className="mb-3 flex w-full items-center justify-between text-[11px] text-slate-400 tabular-nums">
            <span>
              <Film className="me-1 inline h-3.5 w-3.5 text-blue-400" />
              {locale === 'fa' ? 'پیش‌نمایش زنده موشن‌گرافیک' : 'Live Motion Canvas'}
            </span>
            <span className="font-mono">
              {project.customWidth}×{project.customHeight} · {project.aspectRatio} · {timeline.fps}fps
            </span>
          </div>

          <div className="flex w-full items-center justify-center py-2">
            <canvas
              ref={canvasRef}
              width={project.customWidth}
              height={project.customHeight}
              style={canvasAspectStyle}
              className="max-h-[420px] max-w-full rounded-lg border border-slate-700/80 shadow-2xl"
            />
          </div>
        </div>

        {/* Clip & Audio Mixer Inspector */}
        <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827] lg:col-span-5">
          {selectedClip ? (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Layers className="h-4 w-4 text-blue-600" />
                  <span>{locale === 'fa' ? 'بازرس کلیپ انتخاب‌شده' : 'Clip Inspector'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSplitAtPlayhead}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    title={locale === 'fa' ? 'برش در مکان پلی‌هد' : 'Split at Playhead'}
                  >
                    <Scissors className="h-3 w-3" />
                    <span>{locale === 'fa' ? 'برش' : 'Split'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedClip}
                    className="inline-flex items-center rounded border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400"
                    aria-label="Remove clip"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="col-span-2">
                  <label className="mb-1 block text-[11px] text-slate-500">
                    {locale === 'fa' ? 'عنوان کلیپ' : 'Clip Label'}
                  </label>
                  <input
                    type="text"
                    value={selectedClip.label}
                    onChange={(e) => updateSelectedClip({ label: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>

                {(selectedClip.trackType === 'text' || selectedClip.trackType === 'overlay') && (
                  <div className="col-span-2">
                    <label className="mb-1 block text-[11px] text-slate-500">
                      {locale === 'fa' ? 'متن روی تصویر' : 'On-Screen Text'}
                    </label>
                    <input
                      type="text"
                      value={selectedClip.text || ''}
                      onChange={(e) => updateSelectedClip({ text: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-[11px] text-slate-500">
                    {locale === 'fa' ? 'شروع (ثانیه)' : 'Start (s)'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={(selectedClip.startTimeMs / 1000).toFixed(1)}
                    onChange={(e) =>
                      updateSelectedClip({
                        startTimeMs: Math.max(0, Math.round((Number(e.target.value) || 0) * 1000)),
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] text-slate-500">
                    {locale === 'fa' ? 'مدت (ثانیه)' : 'Duration (s)'}
                  </label>
                  <input
                    type="number"
                    min={0.5}
                    step={0.1}
                    value={(selectedClip.durationMs / 1000).toFixed(1)}
                    onChange={(e) =>
                      updateSelectedClip({
                        durationMs: Math.max(500, Math.round((Number(e.target.value) || 1) * 1000)),
                      })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>

                {selectedClip.trackType !== 'audio' && (
                  <>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">
                        {locale === 'fa' ? 'انیمیشن' : 'Animation'}
                      </label>
                      <select
                        value={selectedClip.animationPreset || 'fade_slide_up'}
                        onChange={(e) => updateSelectedClip({ animationPreset: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="fade_slide_up">Fade Slide Up</option>
                        <option value="kinetic_pop">Kinetic Pop</option>
                        <option value="typewriter">Typewriter</option>
                        <option value="scale_reveal">Scale Reveal</option>
                        <option value="slide_left">Slide Left</option>
                        <option value="zoom_pulse">Zoom Pulse</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">
                        {locale === 'fa' ? 'اندازه متن / مقیاس' : 'Font / Scale'}
                      </label>
                      {selectedClip.trackType === 'text' ? (
                        <input
                          type="number"
                          min={20}
                          max={140}
                          value={selectedClip.fontSize ?? 52}
                          onChange={(e) =>
                            updateSelectedClip({ fontSize: Number(e.target.value) || 52 })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                        />
                      ) : (
                        <input
                          type="number"
                          min={0.2}
                          max={2.5}
                          step={0.05}
                          value={selectedClip.scale ?? 1}
                          onChange={(e) =>
                            updateSelectedClip({ scale: Number(e.target.value) || 1 })
                          }
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                        />
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">
                        {locale === 'fa' ? 'موقعیت افقی X%' : 'Pos X%'}
                      </label>
                      <input
                        type="range"
                        min={10}
                        max={90}
                        value={selectedClip.xPercent ?? 50}
                        onChange={(e) =>
                          updateSelectedClip({ xPercent: Number(e.target.value) })
                        }
                        className="w-full"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">
                        {locale === 'fa' ? 'موقعیت عمودی Y%' : 'Pos Y%'}
                      </label>
                      <input
                        type="range"
                        min={10}
                        max={90}
                        value={selectedClip.yPercent ?? 50}
                        onChange={(e) =>
                          updateSelectedClip({ yPercent: Number(e.target.value) })
                        }
                        className="w-full"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">
                        {locale === 'fa' ? 'رنگ اصلی / متن' : 'Primary / Text Color'}
                      </label>
                      <input
                        type="color"
                        value={
                          selectedClip.trackType === 'text'
                            ? selectedClip.textColor || '#F8FAFC'
                            : selectedClip.bgColor || '#0F172A'
                        }
                        onChange={(e) =>
                          selectedClip.trackType === 'text'
                            ? updateSelectedClip({ textColor: e.target.value })
                            : updateSelectedClip({ bgColor: e.target.value })
                        }
                        className="h-8 w-full cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500">
                        {locale === 'fa' ? 'رسانه کلیپ' : 'Clip Media Asset'}
                      </label>
                      <select
                        value={selectedClip.mediaAssetId ?? ''}
                        onChange={(e) =>
                          updateSelectedClip({
                            mediaAssetId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="">
                          {locale === 'fa' ? 'بدون تصویر' : 'None'}
                        </option>
                        {mediaAssets
                          .filter((a) =>
                            ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(
                              a.extension.toLowerCase()
                            )
                          )
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.displayName}
                            </option>
                          ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              {locale === 'fa'
                ? 'برای ویرایش جزئیات، روی یکی از کلیپ‌های روی تایم‌لاین کلیک کنید.'
                : 'Select any clip on the timeline below to inspect & edit its properties.'}
            </p>
          )}

          {/* Audio Mixer */}
          <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <Music className="h-4 w-4 text-blue-600" />
              <span>{locale === 'fa' ? 'میکسر موسیقی و صدای گوینده' : 'Audio & Music Mixer'}</span>
            </div>

            <div className="grid grid-cols-1 gap-3 text-xs">
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{locale === 'fa' ? 'موسیقی پس‌زمینه' : 'Background Music'}</span>
                  <span className="font-mono tabular-nums">
                    {Math.round(audioSettings.musicVolume * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={audioSettings.musicAssetId ?? ''}
                    onChange={(e) =>
                      setAudioSettings((s) => ({
                        ...s,
                        musicAssetId: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">
                      {locale === 'fa' ? 'بدون موسیقی' : 'No Music'}
                    </option>
                    {audioAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={audioSettings.musicVolume}
                    onChange={(e) =>
                      setAudioSettings((s) => ({
                        ...s,
                        musicVolume: Number(e.target.value),
                      }))
                    }
                    className="w-24"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{locale === 'fa' ? 'فایل صدای گوینده (نریشن)' : 'Voiceover Track'}</span>
                  <span className="font-mono tabular-nums">
                    {Math.round(audioSettings.voiceoverVolume * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={audioSettings.voiceoverAssetId ?? ''}
                    onChange={(e) =>
                      setAudioSettings((s) => ({
                        ...s,
                        voiceoverAssetId: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="">
                      {locale === 'fa' ? 'بدون نریشن' : 'No Voiceover'}
                    </option>
                    {audioAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={audioSettings.voiceoverVolume}
                    onChange={(e) =>
                      setAudioSettings((s) => ({
                        ...s,
                        voiceoverVolume: Number(e.target.value),
                      }))
                    }
                    className="w-24"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Track Timeline Dock */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleAddCustomClip('overlay')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{locale === 'fa' ? 'افزودن لایه متن/لوگو' : 'Add Overlay'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleAddCustomClip('audio')}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{locale === 'fa' ? 'افزودن کلیپ صدا' : 'Add Audio Clip'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <ZoomIn className="h-3.5 w-3.5" />
            <span>{locale === 'fa' ? 'بزرگ‌نمایی تایم‌لاین' : 'Timeline Zoom'}</span>
            <input
              type="range"
              min={30}
              max={140}
              value={timeline.zoomPxPerSec}
              onChange={(e) =>
                setTimeline((prev) => ({
                  ...prev,
                  zoomPxPerSec: Number(e.target.value),
                }))
              }
              className="w-28"
            />
          </div>
        </div>

        {/* Track Headers + LTR Scrollable Multi-Track Canvas */}
        <div className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          {/* Fixed Track Labels */}
          <div className="w-44 shrink-0 border-e border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex h-8 items-center border-b border-slate-200 px-3 text-[11px] font-medium text-slate-500 dark:border-slate-800">
              {locale === 'fa' ? 'تراک‌ها' : 'Tracks'}
            </div>
            {timeline.tracks.map((track) => (
              <div
                key={track.id}
                className="flex h-14 items-center justify-between gap-2 border-b border-slate-200/80 px-3 text-xs last:border-b-0 dark:border-slate-800"
              >
                <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                  {locale === 'fa' ? track.nameFa : track.nameEn}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleTrackProp(track.id, 'muted')}
                    className={`rounded p-1 ${
                      track.muted
                        ? 'text-red-500'
                        : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                    aria-label="Toggle Mute"
                  >
                    {track.muted ? (
                      <VolumeX className="h-3.5 w-3.5" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleTrackProp(track.id, 'locked')}
                    className={`rounded p-1 ${
                      track.locked
                        ? 'text-amber-500'
                        : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                    aria-label="Toggle Lock"
                  >
                    {track.locked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* LTR Time Axis & Clips */}
          <div dir="ltr" className="relative flex-1 overflow-x-auto bg-slate-100/60 dark:bg-[#0B0F17]">
            <div style={{ width: `${timelineWidthPx}px` }} className="relative">
              {/* Time Ruler */}
              <div
                ref={rulerRef}
                onClick={handleRulerScrub}
                className="relative h-8 cursor-pointer border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
              >
                {rulerTicksSec.map((sec) => (
                  <div
                    key={sec}
                    style={{ left: `${sec * timeline.zoomPxPerSec}px` }}
                    className="absolute top-0 flex h-full flex-col justify-between border-s border-slate-300 ps-1 font-mono text-[10px] text-slate-500 dark:border-slate-700 tabular-nums"
                  >
                    <span>{sec}s</span>
                  </div>
                ))}
              </div>

              {/* Track Lanes */}
              {timeline.tracks.map((track) => {
                const trackClips = timeline.clips.filter((c) => c.trackId === track.id);
                const clipColorClass =
                  track.type === 'video'
                    ? 'border-blue-500/60 bg-blue-600/20 text-blue-900 dark:text-blue-100'
                    : track.type === 'text'
                    ? 'border-emerald-500/60 bg-emerald-600/20 text-emerald-900 dark:text-emerald-100'
                    : track.type === 'overlay'
                    ? 'border-amber-500/60 bg-amber-600/20 text-amber-900 dark:text-amber-100'
                    : 'border-indigo-500/60 bg-indigo-600/20 text-indigo-900 dark:text-indigo-100';

                return (
                  <div
                    key={track.id}
                    className={`relative h-14 border-b border-slate-200/80 last:border-b-0 dark:border-slate-800 ${
                      track.muted ? 'opacity-45' : ''
                    }`}
                  >
                    {trackClips.map((clip) => {
                      const leftPx = (clip.startTimeMs / 1000) * timeline.zoomPxPerSec;
                      const widthPx = Math.max(
                        32,
                        (clip.durationMs / 1000) * timeline.zoomPxPerSec
                      );
                      const isSelected = clip.id === selectedClipId;
                      return (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => {
                            setSelectedClipId(clip.id);
                            setPlayheadMs(clip.startTimeMs);
                          }}
                          style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                          className={`absolute top-1.5 bottom-1.5 flex flex-col justify-center overflow-hidden rounded-md border px-2 text-left transition-shadow ${clipColorClass} ${
                            isSelected ? 'ring-2 ring-blue-500 shadow-md' : ''
                          }`}
                        >
                          <span className="truncate text-[11px] font-semibold">
                            {clip.label}
                          </span>
                          <span className="font-mono text-[10px] opacity-75 tabular-nums">
                            {(clip.durationMs / 1000).toFixed(1)}s
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {/* Playhead Needle */}
              <div
                style={{ left: `${(playheadMs / 1000) * timeline.zoomPxPerSec}px` }}
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-red-500"
              >
                <div className="-ms-1.5 h-3 w-3 rounded-b-sm bg-red-500" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
