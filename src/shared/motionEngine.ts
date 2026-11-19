export type TrackType = 'video' | 'text' | 'overlay' | 'audio';

export interface TimelineTrackHeader {
  id: string;
  type: TrackType;
  nameFa: string;
  nameEn: string;
  muted: boolean;
  locked: boolean;
}

export interface TimelineClipItem {
  id: string;
  trackId: string;
  trackType: TrackType;
  sceneId?: number;
  label: string;
  startTimeMs: number;
  durationMs: number;
  mediaAssetId?: number | null;
  text?: string;
  fontSize?: number;
  textColor?: string;
  bgColor?: string;
  accentColor?: string;
  animationPreset?: string;
  transitionType?: string;
  xPercent?: number;
  yPercent?: number;
  scale?: number;
  opacity?: number;
  volume?: number;
}

export interface TimelineDocument {
  fps: number;
  zoomPxPerSec: number;
  tracks: TimelineTrackHeader[];
  clips: TimelineClipItem[];
}

export interface AudioSettingsDoc {
  musicAssetId: number | null;
  musicVolume: number;
  voiceoverAssetId: number | null;
  voiceoverVolume: number;
  fadeInMs: number;
  fadeOutMs: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettingsDoc = {
  musicAssetId: null,
  musicVolume: 0.55,
  voiceoverAssetId: null,
  voiceoverVolume: 0.9,
  fadeInMs: 400,
  fadeOutMs: 600,
};

export const DEFAULT_TIMELINE_TRACKS: TimelineTrackHeader[] = [
  { id: 'track-video', type: 'video', nameFa: 'تصویر و پس‌زمینه (V1)', nameEn: 'Video & Media (V1)', muted: false, locked: false },
  { id: 'track-text', type: 'text', nameFa: 'متن و تایپوگرافی (T1)', nameEn: 'Kinetic Text (T1)', muted: false, locked: false },
  { id: 'track-overlay', type: 'overlay', nameFa: 'لوگو و روکش (O1)', nameEn: 'Logo & Overlays (O1)', muted: false, locked: false },
  { id: 'track-audio', type: 'audio', nameFa: 'موسیقی و صدا (A1)', nameEn: 'Audio & Music (A1)', muted: false, locked: false },
];

export interface SceneInputForTimeline {
  id: number;
  orderIndex: number;
  title: string;
  startTimeMs: number;
  durationMs: number;
  textContent: string;
  animationPreset: string;
  transitionType: string;
  effectsConfig?: Record<string, unknown> | null;
  layersConfig?: Array<Record<string, unknown>> | null;
}

export interface ProjectInputForTimeline {
  title: string;
  designStyle: string;
  referenceStyleProfile?: Record<string, unknown> | null;
}

export function buildTimelineFromProjectScenes(
  project: ProjectInputForTimeline,
  scenes: SceneInputForTimeline[],
  existingTimeline?: TimelineDocument | null
): TimelineDocument {
  const styleProfile = (project.referenceStyleProfile ?? {}) as {
    colorPalette?: {
      primary?: string;
      secondary?: string;
      accent?: string;
      background?: string;
      text?: string;
    };
  };

  const palette = styleProfile.colorPalette ?? {};
  const defaultBg = palette.background || palette.primary || '#0B0F17';
  const defaultAccent = palette.accent || '#2563EB';
  const defaultText = palette.text || '#F8FAFC';

  const generatedClips: TimelineClipItem[] = [];

  for (const sc of scenes) {
    const effects = (sc.effectsConfig ?? {}) as Record<string, unknown>;
    const bgHex =
      typeof effects.backgroundHex === 'string'
        ? effects.backgroundHex
        : typeof effects.primaryHex === 'string'
        ? effects.primaryHex
        : defaultBg;
    const accentHex =
      typeof effects.accentHex === 'string' ? effects.accentHex : defaultAccent;
    const textHex = typeof effects.textHex === 'string' ? effects.textHex : defaultText;

    const layers = Array.isArray(sc.layersConfig) ? sc.layersConfig : [];
    const mediaLayer = layers.find((l) => typeof l.mediaAssetId === 'number');
    const mediaAssetId =
      mediaLayer && typeof mediaLayer.mediaAssetId === 'number'
        ? mediaLayer.mediaAssetId
        : null;

    // Video / Visual background clip
    generatedClips.push({
      id: `v-scene-${sc.id}`,
      trackId: 'track-video',
      trackType: 'video',
      sceneId: sc.id,
      label: sc.title,
      startTimeMs: sc.startTimeMs,
      durationMs: Math.max(500, sc.durationMs),
      mediaAssetId,
      bgColor: bgHex,
      accentColor: accentHex,
      transitionType: sc.transitionType || 'cross_dissolve',
      animationPreset: 'zoom_pulse',
      xPercent: 50,
      yPercent: 50,
      scale: 1,
      opacity: 1,
    });

    // Kinetic Text clip
    if (sc.textContent && sc.textContent.trim()) {
      generatedClips.push({
        id: `t-scene-${sc.id}`,
        trackId: 'track-text',
        trackType: 'text',
        sceneId: sc.id,
        label: sc.textContent.slice(0, 28),
        startTimeMs: sc.startTimeMs + Math.min(180, Math.floor(sc.durationMs * 0.08)),
        durationMs: Math.max(500, sc.durationMs - Math.min(240, Math.floor(sc.durationMs * 0.1))),
        text: sc.textContent,
        fontSize: 54,
        textColor: textHex,
        accentColor: accentHex,
        animationPreset: sc.animationPreset || 'fade_slide_up',
        transitionType: sc.transitionType || 'cross_dissolve',
        xPercent: 50,
        yPercent: mediaAssetId ? 76 : 50,
        scale: 1,
        opacity: 1,
      });
    }
  }

  // Preserve manual overlay & audio clips if rebuilding from scenes
  const preservedManualClips = (existingTimeline?.clips ?? []).filter(
    (c) => c.trackType === 'overlay' || c.trackType === 'audio'
  );

  return {
    fps: existingTimeline?.fps || 30,
    zoomPxPerSec: existingTimeline?.zoomPxPerSec || 60,
    tracks:
      existingTimeline?.tracks?.length === DEFAULT_TIMELINE_TRACKS.length
        ? existingTimeline.tracks
        : DEFAULT_TIMELINE_TRACKS,
    clips: [...generatedClips, ...preservedManualClips],
  };
}

export interface ClipMotionFrameState {
  visible: boolean;
  localProgress: number; // 0..1
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  revealedCharRatio: number;
}

function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function easeOutBack(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(clamped - 1, 3) + c1 * Math.pow(clamped - 1, 2);
}

export function computeClipMotionFrameState(
  clip: TimelineClipItem,
  currentTimeMs: number
): ClipMotionFrameState {
  const start = clip.startTimeMs;
  const end = clip.startTimeMs + Math.max(200, clip.durationMs);

  if (currentTimeMs < start || currentTimeMs > end) {
    return {
      visible: false,
      localProgress: 0,
      opacity: 0,
      translateX: 0,
      translateY: 0,
      scale: clip.scale ?? 1,
      revealedCharRatio: 0,
    };
  }

  const elapsed = currentTimeMs - start;
  const total = Math.max(200, clip.durationMs);
  const localProgress = Math.max(0, Math.min(1, elapsed / total));

  const introMs = Math.min(550, total * 0.35);
  const outroMs = Math.min(400, total * 0.25);

  const introT = introMs > 0 ? Math.min(1, elapsed / introMs) : 1;
  const outroRemaining = end - currentTimeMs;
  const outroT = outroMs > 0 ? Math.min(1, outroRemaining / outroMs) : 1;

  const baseOpacity = (clip.opacity ?? 1) * Math.min(easeOutCubic(introT), easeOutCubic(outroT));
  const baseScale = clip.scale ?? 1;
  const preset = clip.animationPreset || 'fade_slide_up';

  let translateX = 0;
  let translateY = 0;
  let scale = baseScale;
  let revealedCharRatio = 1;

  if (preset === 'fade_slide_up') {
    translateY = (1 - easeOutCubic(introT)) * 42;
  } else if (preset === 'kinetic_pop') {
    scale = baseScale * (0.72 + 0.28 * easeOutBack(introT));
  } else if (preset === 'typewriter') {
    const typingWindow = Math.min(1, elapsed / Math.max(400, total * 0.65));
    revealedCharRatio = Math.max(0.08, typingWindow);
  } else if (preset === 'scale_reveal') {
    scale = baseScale * (1.24 - 0.24 * easeOutCubic(introT));
  } else if (preset === 'slide_left') {
    translateX = (1 - easeOutCubic(introT)) * 90;
  } else if (preset === 'zoom_pulse') {
    scale = baseScale * (1 + 0.06 * localProgress);
  }

  // Subtle transition departure offset when fade_out or whip_pan finishes
  if (outroRemaining < outroMs) {
    const exitProgress = 1 - outroRemaining / outroMs;
    if (clip.transitionType === 'whip_pan') {
      translateX -= exitProgress * 120;
    } else if (clip.transitionType === 'zoom_cut') {
      scale *= 1 + exitProgress * 0.14;
    }
  }

  return {
    visible: true,
    localProgress,
    opacity: Math.max(0, Math.min(1, baseOpacity)),
    translateX,
    translateY,
    scale,
    revealedCharRatio,
  };
}
