import { Type } from '@google/genai';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  aiProviders,
  mediaAssets,
  projectScenes,
  projects,
  projectVersions,
  referenceScenes,
  referenceVideos,
  type MediaAssetRow,
  type ProjectRow,
  type ProjectSceneRow,
  type ReferenceSceneRow,
  type ReferenceVideoRow,
} from '../db/schema.ts';
import { logActivity } from '../db/users.ts';
import { getGeminiClient, isGeminiConfigured } from './gemini.ts';
import { studioWsHub } from './ws.ts';

export const STANDARD_ANIMATION_PRESETS = [
  'fade_slide_up',
  'kinetic_pop',
  'typewriter',
  'scale_reveal',
  'slide_left',
  'zoom_pulse',
] as const;

export const STANDARD_TRANSITIONS = [
  'cross_dissolve',
  'whip_pan',
  'zoom_cut',
  'slide_wipe',
  'hard_cut',
  'fade_out',
] as const;

export type AnimationPreset = (typeof STANDARD_ANIMATION_PRESETS)[number];
export type TransitionType = (typeof STANDARD_TRANSITIONS)[number];

export interface StyleColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  swatches: string[];
}

export interface StyleBlueprint {
  sourceReferenceId: number | null;
  sourceType: string;
  colorPalette: StyleColorPalette;
  typography: {
    headingStyle: string;
    bodyStyle: string;
    alignment: 'center' | 'start' | 'end';
  };
  rhythm: {
    pace: string;
    bpmEstimate: string;
    avgSceneMs: number;
  };
  motionLanguage: {
    visualStyle: string;
    textAnimations: string[];
    cameraMotions: string[];
    transitions: string[];
    effects: string[];
  };
  structurePattern: string;
}

export interface ScenarioBlueprint {
  hookLine: string;
  valueProposition: string;
  ctaLine: string;
  voiceoverNarration: string;
  musicDirection: string;
  toneOfVoice: string;
  brandKeyMessages: string[];
  generationMode: 'gemini_adapted' | 'local_adapted';
  note?: string | null;
}

export interface SceneDraftSpec {
  title: string;
  durationSharePercent: number;
  textContent: string;
  visualPrompt: string;
  animationPreset: string;
  transitionType: string;
  cameraMotion: string;
  visualEffects: string[];
  attachedAssetId: number | null;
}

export function mapAnimationPreset(raw: string): AnimationPreset {
  const lower = (raw || '').toLowerCase();
  if (lower.includes('pop') || lower.includes('kinetic') || lower.includes('bounce')) {
    return 'kinetic_pop';
  }
  if (lower.includes('type') || lower.includes('write') || lower.includes('تایپ')) {
    return 'typewriter';
  }
  if (lower.includes('scale') || lower.includes('reveal') || lower.includes('بزرگ')) {
    return 'scale_reveal';
  }
  if (lower.includes('left') || lower.includes('right') || lower.includes('slide') || lower.includes('لغزش')) {
    return 'slide_left';
  }
  if (lower.includes('zoom') || lower.includes('pulse') || lower.includes('زوم')) {
    return 'zoom_pulse';
  }
  return 'fade_slide_up';
}

export function mapTransitionType(raw: string): TransitionType {
  const lower = (raw || '').toLowerCase();
  if (lower.includes('whip') || lower.includes('pan')) return 'whip_pan';
  if (lower.includes('zoom')) return 'zoom_cut';
  if (lower.includes('wipe') || lower.includes('slide')) return 'slide_wipe';
  if (lower.includes('hard') || lower.includes('cut') || lower.includes('برش')) return 'hard_cut';
  if (lower.includes('out') || lower.includes('پایان')) return 'fade_out';
  return 'cross_dissolve';
}

function normalizeHex(hex: string | undefined, fallback: string): string {
  if (!hex) return fallback;
  const cleaned = hex.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(cleaned) ? cleaned : fallback;
}

export function buildReferenceStyleProfile(
  project: Pick<ProjectRow, 'designStyle' | 'durationSeconds' | 'language'>,
  referenceVideo?: ReferenceVideoRow | null,
  refScenes: ReferenceSceneRow[] = []
): StyleBlueprint {
  const summary = (referenceVideo?.overallSummary ?? {}) as Record<string, unknown>;
  const summaryPalette = Array.isArray(summary.palette)
    ? summary.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c))
    : [];
  const sceneColors = refScenes.flatMap((s) =>
    Array.isArray(s.dominantColors) ? s.dominantColors : []
  );
  const rawSwatches = [...new Set([...summaryPalette, ...sceneColors].map((c) => c.toUpperCase()))];

  const defaultStylePalettes: Record<string, StyleColorPalette> = {
    modern_minimal: {
      primary: '#0F172A',
      secondary: '#1E293B',
      accent: '#2563EB',
      background: '#0B0F17',
      text: '#F8FAFC',
      swatches: ['#0F172A', '#1E293B', '#2563EB', '#F8FAFC'],
    },
    bold_energetic: {
      primary: '#18181B',
      secondary: '#EA580C',
      accent: '#FACC15',
      background: '#09090B',
      text: '#FFFFFF',
      swatches: ['#18181B', '#EA580C', '#FACC15', '#FFFFFF'],
    },
    luxury_editorial: {
      primary: '#1C1917',
      secondary: '#44403C',
      accent: '#D4AF37',
      background: '#0C0A09',
      text: '#FAFAF9',
      swatches: ['#1C1917', '#44403C', '#D4AF37', '#FAFAF9'],
    },
    corporate_clean: {
      primary: '#0F172A',
      secondary: '#334155',
      accent: '#0284C7',
      background: '#F8FAFC',
      text: '#0F172A',
      swatches: ['#0F172A', '#334155', '#0284C7', '#F8FAFC'],
    },
  };

  const fallbackPalette = defaultStylePalettes[project.designStyle] ?? defaultStylePalettes.modern_minimal;
  const swatches = rawSwatches.length >= 2 ? rawSwatches.slice(0, 6) : fallbackPalette.swatches;

  const avgSceneMs =
    refScenes.length > 0
      ? Math.round(
          refScenes.reduce((sum, s) => sum + s.durationMs, 0) / refScenes.length
        )
      : Math.round((project.durationSeconds * 1000) / 4);

  const textAnimations = [
    ...new Set(refScenes.map((s) => mapAnimationPreset(s.textAnimation))),
  ];
  const transitions = [
    ...new Set(refScenes.map((s) => mapTransitionType(s.transitionType))),
  ];
  const cameraMotions = [
    ...new Set(refScenes.map((s) => s.cameraMotion).filter(Boolean)),
  ];
  const effects = [
    ...new Set(refScenes.flatMap((s) => s.visualEffects || []).filter(Boolean)),
  ].slice(0, 6);

  return {
    sourceReferenceId: referenceVideo?.id ?? null,
    sourceType: referenceVideo?.sourceType ?? 'project_specs',
    colorPalette: {
      primary: normalizeHex(swatches[0], fallbackPalette.primary),
      secondary: normalizeHex(swatches[1], fallbackPalette.secondary),
      accent: normalizeHex(swatches[2] ?? swatches[1], fallbackPalette.accent),
      background: normalizeHex(swatches[0], fallbackPalette.background),
      text: fallbackPalette.text,
      swatches,
    },
    typography: {
      headingStyle:
        typeof summary.typographyStyle === 'string' && summary.typographyStyle
          ? summary.typographyStyle
          : project.language === 'fa'
          ? 'وزیرمتن بولد با کنتراست بالا'
          : 'Bold geometric display sans-serif',
      bodyStyle:
        project.language === 'fa' ? 'وزیرمتن منظم خوانا' : 'Clean modern sans-serif',
      alignment: 'center',
    },
    rhythm: {
      pace:
        typeof summary.rhythm === 'string' && summary.rhythm
          ? summary.rhythm
          : project.language === 'fa'
          ? 'ریتم تبلیغاتی پویا و متعادل'
          : 'Dynamic commercial pacing',
      bpmEstimate:
        typeof summary.bpmEstimate === 'string' && summary.bpmEstimate
          ? summary.bpmEstimate
          : '112-124 BPM',
      avgSceneMs,
    },
    motionLanguage: {
      visualStyle:
        typeof summary.visualStyle === 'string' && summary.visualStyle
          ? summary.visualStyle
          : project.designStyle,
      textAnimations: textAnimations.length > 0 ? textAnimations : ['kinetic_pop', 'fade_slide_up'],
      cameraMotions: cameraMotions.length > 0 ? cameraMotions : ['Smooth Zoom In', 'Parallax Push'],
      transitions: transitions.length > 0 ? transitions : ['cross_dissolve', 'whip_pan'],
      effects: effects.length > 0 ? effects : ['Soft Glow', 'Gradient Overlay'],
    },
    structurePattern:
      typeof summary.structureOverview === 'string' && summary.structureOverview
        ? summary.structureOverview
        : project.language === 'fa'
        ? 'قلاب آغازین -> معرفی مشکل و محصول -> مزیت رقابتی -> دعوت به اقدام (CTA)'
        : 'Hook -> Value Proposition -> Visual Proof -> Call To Action',
  };
}

export function normalizeSceneTimingAndLocking(
  totalDurationMs: number,
  existingScenes: Array<{
    id?: number;
    title: string;
    durationMs: number;
    locked: boolean;
    textContent: string;
    visualPrompt: string;
    animationPreset: string;
    transitionType: string;
    effectsConfig: Record<string, unknown>;
    layersConfig: Array<Record<string, unknown>>;
    variants: Array<Record<string, unknown>>;
    activeVariantIndex: number;
  }>,
  newDrafts: SceneDraftSpec[],
  palette: StyleColorPalette,
  selectedAssets: MediaAssetRow[],
  preserveLocked: boolean
): Array<{
  orderIndex: number;
  title: string;
  startTimeMs: number;
  durationMs: number;
  locked: boolean;
  textContent: string;
  visualPrompt: string;
  animationPreset: string;
  transitionType: string;
  effectsConfig: Record<string, unknown>;
  layersConfig: Array<Record<string, unknown>>;
  variants: Array<Record<string, unknown>>;
  activeVariantIndex: number;
}> {
  const lockedRows = preserveLocked ? existingScenes.filter((s) => s.locked) : [];
  const lockedDurationMs = lockedRows.reduce((sum, s) => sum + Math.max(800, s.durationMs), 0);
  const remainingDurationMs = Math.max(2000, totalDurationMs - lockedDurationMs);

  const totalShare = newDrafts.reduce(
    (sum, s) => sum + Math.max(5, Number(s.durationSharePercent) || 25),
    0
  );

  let generatedCursorOffset = 0;
  const generatedRows = newDrafts.map((draft, idx) => {
    const isLast = idx === newDrafts.length - 1;
    const share = Math.max(5, Number(draft.durationSharePercent) || 25) / totalShare;
    const durationMs = isLast
      ? Math.max(800, remainingDurationMs - generatedCursorOffset)
      : Math.max(800, Math.round(remainingDurationMs * share));
    generatedCursorOffset += durationMs;

    const matchedAsset =
      draft.attachedAssetId != null
        ? selectedAssets.find((a) => a.id === draft.attachedAssetId)
        : selectedAssets.length > 0
        ? selectedAssets[idx % selectedAssets.length]
        : undefined;

    const layersConfig: Array<Record<string, unknown>> = matchedAsset
      ? [
          {
            type: matchedAsset.category === 'video' ? 'video' : 'image',
            mediaAssetId: matchedAsset.id,
            displayName: matchedAsset.displayName,
            category: matchedAsset.category,
            opacity: 1,
            fit: 'contain',
          },
        ]
      : [];

    const anim = mapAnimationPreset(draft.animationPreset);
    const trans = mapTransitionType(draft.transitionType);

    const primaryVariant = {
      label: 'نسخه اصلی',
      title: draft.title,
      textContent: draft.textContent,
      visualPrompt: draft.visualPrompt,
      animationPreset: anim,
      transitionType: trans,
    };

    return {
      orderIndex: idx,
      title: draft.title,
      startTimeMs: 0,
      durationMs,
      locked: false,
      textContent: draft.textContent,
      visualPrompt: draft.visualPrompt,
      animationPreset: anim,
      transitionType: trans,
      effectsConfig: {
        primaryHex: palette.primary,
        accentHex: palette.accent,
        backgroundHex: palette.background,
        textHex: palette.text,
        cameraMotion: draft.cameraMotion || 'Smooth Zoom In',
        effects: draft.visualEffects?.length ? draft.visualEffects : ['Gradient Overlay'],
      },
      layersConfig,
      variants: [primaryVariant],
      activeVariantIndex: 0,
    };
  });

  const combined = [...lockedRows, ...generatedRows];
  let cursorMs = 0;
  return combined.map((sc, idx) => {
    const row = {
      orderIndex: idx,
      title: sc.title,
      startTimeMs: cursorMs,
      durationMs: Math.max(800, sc.durationMs),
      locked: sc.locked,
      textContent: sc.textContent,
      visualPrompt: sc.visualPrompt,
      animationPreset: sc.animationPreset,
      transitionType: sc.transitionType,
      effectsConfig: sc.effectsConfig,
      layersConfig: sc.layersConfig,
      variants: sc.variants,
      activeVariantIndex: sc.activeVariantIndex,
    };
    cursorMs += row.durationMs;
    return row;
  });
}

function buildLocalFallbackBlueprint(
  project: ProjectRow,
  style: StyleBlueprint,
  refScenes: ReferenceSceneRow[],
  selectedAssets: MediaAssetRow[],
  options: { toneOfVoice: string; ctaText: string; customInstructions: string }
): { scenario: ScenarioBlueprint; scenes: SceneDraftSpec[] } {
  const isFa = project.language !== 'en';
  const brand = project.businessName || project.title;
  const product = project.productType || project.topic || project.title;
  const cta =
    options.ctaText || (isFa ? `همین حالا با ${brand} شروع کنید` : `Get started with ${brand}`);

  const scenario: ScenarioBlueprint = {
    hookLine: isFa
      ? `به دنبال تجربه‌ای متفاوت در ${product} هستید؟`
      : `Ready to upgrade your ${product} experience?`,
    valueProposition: isFa
      ? `${brand} با طراحی مدرن و کیفیت ممتاز، راهکار اختصاصی برای ${project.targetAudience || 'مخاطبان حرفه‌ای'} ارائه می‌دهد.`
      : `${brand} delivers premium quality tailored for ${project.targetAudience || 'modern audiences'}.`,
    ctaLine: cta,
    voiceoverNarration: isFa
      ? `دنیای ${product} را با ${brand} متحول کنید. کیفیت بی‌نظیر، طراحی چشم‌نواز و نتیجه‌ای که از لحظه اول حس می‌کنید. ${cta}.`
      : `Transform your ${product} journey with ${brand}. Effortless quality and standout results. ${cta}.`,
    musicDirection: `${style.rhythm.pace} (${style.rhythm.bpmEstimate})`,
    toneOfVoice: options.toneOfVoice || (isFa ? 'حرفه‌ای و پرانرژی' : 'Confident & Energetic'),
    brandKeyMessages: [
      brand,
      project.topic || product,
      cta,
    ],
    generationMode: 'local_adapted',
  };

  const count = Math.max(4, Math.min(6, refScenes.length || 4));
  const scenes: SceneDraftSpec[] = Array.from({ length: count }, (_, idx) => {
    const refScene = refScenes[idx];
    const matchedAsset = selectedAssets[idx % Math.max(1, selectedAssets.length)];
    const isFirst = idx === 0;
    const isLast = idx === count - 1;

    const title = isFirst
      ? isFa
        ? 'صحنه ۱: قلاب آغازین و معرفی برند'
        : 'Scene 1: Brand Hook'
      : isLast
      ? isFa
        ? `صحنه ${idx + 1}: دعوت به اقدام نهایی`
        : `Scene ${idx + 1}: Final Call To Action`
      : isFa
      ? `صحنه ${idx + 1}: نمایش مزیت ${idx}`
      : `Scene ${idx + 1}: Feature Highlight ${idx}`;

    const textContent = isFirst
      ? scenario.hookLine
      : isLast
      ? cta
      : idx === 1
      ? `${brand} · ${product}`
      : project.topic || scenario.valueProposition;

    return {
      title,
      durationSharePercent: 100 / count,
      textContent,
      visualPrompt: options.customInstructions
        ? `${brand} — ${options.customInstructions.slice(0, 120)} (${style.motionLanguage.visualStyle})`
        : `${brand} ${product} motion graphics scene styled in ${style.motionLanguage.visualStyle}`,
      animationPreset:
        refScene?.textAnimation ||
        style.motionLanguage.textAnimations[idx % style.motionLanguage.textAnimations.length] ||
        'kinetic_pop',
      transitionType:
        isLast
          ? 'fade_out'
          : refScene?.transitionType ||
            style.motionLanguage.transitions[idx % style.motionLanguage.transitions.length] ||
            'cross_dissolve',
      cameraMotion: refScene?.cameraMotion || style.motionLanguage.cameraMotions[0] || 'Smooth Zoom In',
      visualEffects: refScene?.visualEffects?.length
        ? refScene.visualEffects
        : style.motionLanguage.effects,
      attachedAssetId: matchedAsset?.id ?? null,
    };
  });

  return { scenario, scenes };
}

export async function generateProjectBlueprint(params: {
  userId: number;
  projectId: number;
  referenceVideoId?: number | null;
  toneOfVoice?: string;
  ctaText?: string;
  customInstructions?: string;
  mediaAssetIds?: number[];
  preserveLocked?: boolean;
}): Promise<{
  project: ProjectRow;
  styleBlueprint: StyleBlueprint;
  scenario: ScenarioBlueprint;
  scenes: ProjectSceneRow[];
}> {
  const {
    userId,
    projectId,
    referenceVideoId,
    toneOfVoice = '',
    ctaText = '',
    customInstructions = '',
    mediaAssetIds = [],
    preserveLocked = true,
  } = params;

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!project) {
    throw new Error('پروژه یافت نشد.');
  }

  let refVideo: ReferenceVideoRow | null = null;
  let refScenes: ReferenceSceneRow[] = [];

  if (referenceVideoId) {
    const [foundRef] = await db
      .select()
      .from(referenceVideos)
      .where(
        and(
          eq(referenceVideos.id, referenceVideoId),
          eq(referenceVideos.projectId, projectId),
          eq(referenceVideos.userId, userId)
        )
      )
      .limit(1);
    if (foundRef) {
      refVideo = foundRef;
      refScenes = await db
        .select()
        .from(referenceScenes)
        .where(eq(referenceScenes.referenceVideoId, foundRef.id))
        .orderBy(asc(referenceScenes.sceneNumber));
    }
  } else {
    // Auto-select latest completed reference if available
    const completedRefs = await db
      .select()
      .from(referenceVideos)
      .where(
        and(
          eq(referenceVideos.projectId, projectId),
          eq(referenceVideos.userId, userId),
          eq(referenceVideos.analysisStatus, 'completed')
        )
      );
    const latest = completedRefs.sort((a, b) => b.id - a.id)[0];
    if (latest) {
      refVideo = latest;
      refScenes = await db
        .select()
        .from(referenceScenes)
        .where(eq(referenceScenes.referenceVideoId, latest.id))
        .orderBy(asc(referenceScenes.sceneNumber));
    }
  }

  const allUserAssets = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.userId, userId));
  const selectedAssets =
    mediaAssetIds.length > 0
      ? allUserAssets.filter((a) => mediaAssetIds.includes(a.id))
      : allUserAssets.filter((a) => a.projectId === projectId);

  const styleBlueprint = buildReferenceStyleProfile(project, refVideo, refScenes);
  const existingScenes = await db
    .select()
    .from(projectScenes)
    .where(eq(projectScenes.projectId, projectId))
    .orderBy(asc(projectScenes.orderIndex));

  // Auto-save version snapshot before regenerating
  const nextVersion = project.currentVersion + 1;
  await db.insert(projectVersions).values({
    projectId,
    userId,
    versionNumber: nextVersion,
    label:
      project.language === 'en'
        ? 'Auto snapshot before AI blueprint adaptation'
        : 'نسخه پشتیبان خودکار پیش از الگوبرداری هوشمند',
    snapshot: {
      project,
      scenes: existingScenes,
    },
  });

  let adapted: { scenario: ScenarioBlueprint; scenes: SceneDraftSpec[] } | null = null;
  let geminiNote: string | null = null;

  if (isGeminiConfigured()) {
    try {
      const ai = getGeminiClient();
      const isFa = project.language !== 'en';
      const refSceneText =
        refScenes.length > 0
          ? refScenes
              .map(
                (s) =>
                  `Ref Scene ${s.sceneNumber} (${s.durationMs}ms): anim=${s.textAnimation}, transition=${s.transitionType}, camera=${s.cameraMotion}, effects=${(s.visualEffects || []).join(',')}, role=${s.aiDescription}`
              )
              .join('\n')
          : 'No reference scenes — design fresh 4 to 6 commercial scenes matching project duration.';

      const assetText =
        selectedAssets.length > 0
          ? selectedAssets
              .map((a) => `Asset ID ${a.id}: "${a.displayName}" (${a.category}, ${a.extension})`)
              .join('\n')
          : 'No media assets attached.';

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `You are an expert commercial motion graphics creative director.
Adapt the extracted reference style blueprint into a 100% ORIGINAL commercial video script and scene-by-scene motion production plan for the user's business.
CRITICAL: NEVER copy literal brand names or promotional text from the reference video. Replace all content with the user's brand, product, audience, and message!

User Project:
- Title: ${project.title}
- Business Name: ${project.businessName || project.title}
- Topic / Campaign: ${project.topic || 'Product promotion'}
- Product / Service: ${project.productType || 'Product'}
- Target Audience: ${project.targetAudience || 'General consumers'}
- Aspect Ratio: ${project.aspectRatio} (${project.customWidth}x${project.customHeight})
- Target Total Duration: ${project.durationSeconds} seconds
- Design Style: ${project.designStyle}
- Tone of Voice: ${toneOfVoice || 'Engaging, trustworthy commercial tone'}
- Preferred CTA: ${ctaText || 'Auto-craft strong CTA'}
- Extra User Instructions: ${customInstructions || 'None'}

Extracted Reference Style Blueprint:
- Structure: ${styleBlueprint.structurePattern}
- Rhythm & BPM: ${styleBlueprint.rhythm.pace} (${styleBlueprint.rhythm.bpmEstimate})
- Visual Style: ${styleBlueprint.motionLanguage.visualStyle}
- Palette Swatches: ${styleBlueprint.colorPalette.swatches.join(', ')}
- Animations Available: ${STANDARD_ANIMATION_PRESETS.join(', ')}
- Transitions Available: ${STANDARD_TRANSITIONS.join(', ')}

Reference Scene Blueprint:
${refSceneText}

Available User Media Assets (bind matching asset IDs cleanly into scenes, or -1 if typography-only):
${assetText}

Language for ALL generated copy (titles, headlines, voiceover, visual prompts): ${
          isFa ? 'Natural, persuasive Persian (فارسی)' : 'Natural persuasive English'
        }.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenario: {
                type: Type.OBJECT,
                properties: {
                  hookLine: { type: Type.STRING },
                  valueProposition: { type: Type.STRING },
                  ctaLine: { type: Type.STRING },
                  voiceoverNarration: { type: Type.STRING },
                  musicDirection: { type: Type.STRING },
                  toneOfVoice: { type: Type.STRING },
                  brandKeyMessages: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                },
                required: [
                  'hookLine',
                  'valueProposition',
                  'ctaLine',
                  'voiceoverNarration',
                  'musicDirection',
                  'toneOfVoice',
                  'brandKeyMessages',
                ],
              },
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    durationSharePercent: { type: Type.NUMBER },
                    textContent: { type: Type.STRING },
                    visualPrompt: { type: Type.STRING },
                    animationPreset: { type: Type.STRING },
                    transitionType: { type: Type.STRING },
                    cameraMotion: { type: Type.STRING },
                    visualEffects: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    attachedAssetId: { type: Type.INTEGER },
                  },
                  required: [
                    'title',
                    'durationSharePercent',
                    'textContent',
                    'visualPrompt',
                    'animationPreset',
                    'transitionType',
                    'cameraMotion',
                    'visualEffects',
                    'attachedAssetId',
                  ],
                },
              },
            },
            required: ['scenario', 'scenes'],
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
            eq(aiProviders.capability, 'text')
          )
        );

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        scenario?: Omit<ScenarioBlueprint, 'generationMode'>;
        scenes?: SceneDraftSpec[];
      };

      if (parsed.scenario && Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
        adapted = {
          scenario: {
            ...parsed.scenario,
            generationMode: 'gemini_adapted',
            note: null,
          },
          scenes: parsed.scenes.map((sc) => ({
            ...sc,
            attachedAssetId:
              sc.attachedAssetId != null && sc.attachedAssetId > 0
                ? sc.attachedAssetId
                : null,
          })),
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Gemini blueprint adaptation error:', msg);
      geminiNote =
        msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
          ? 'سهمیه Gemini موقتاً تکمیل شد؛ سناریو و صحنه‌ها با موتور محلی منطبق بر الگو تولید شدند.'
          : 'تولید با موتور الگوبرداری محلی انجام شد؛ تمامی صحنه‌ها و سناریو آماده ویرایش هستند.';
    }
  } else {
    geminiNote = 'کلید Gemini تنظیم نشده است؛ الگوبرداری ساختاری با موتور محلی انجام شد.';
  }

  if (!adapted) {
    const local = buildLocalFallbackBlueprint(project, styleBlueprint, refScenes, selectedAssets, {
      toneOfVoice,
      ctaText,
      customInstructions,
    });
    adapted = {
      scenario: {
        ...local.scenario,
        note: geminiNote,
      },
      scenes: local.scenes,
    };
  }

  const normalizedRows = normalizeSceneTimingAndLocking(
    project.durationSeconds * 1000,
    existingScenes.map((s) => ({
      ...s,
      effectsConfig: (s.effectsConfig ?? {}) as Record<string, unknown>,
      layersConfig: (s.layersConfig ?? []) as Array<Record<string, unknown>>,
      variants: (s.variants ?? []) as Array<Record<string, unknown>>,
    })),
    adapted.scenes,
    styleBlueprint.colorPalette,
    selectedAssets,
    preserveLocked
  );

  await db.delete(projectScenes).where(eq(projectScenes.projectId, projectId));
  const insertedScenes = await db
    .insert(projectScenes)
    .values(
      normalizedRows.map((row) => ({
        projectId,
        ...row,
      }))
    )
    .returning();

  const [updatedProject] = await db
    .update(projects)
    .set({
      referenceStyleProfile: styleBlueprint as unknown as Record<string, unknown>,
      scenarioData: adapted.scenario as unknown as Record<string, unknown>,
      status: 'ready',
      currentVersion: nextVersion,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();

  await logActivity(
    userId,
    'blueprint.generated',
    `سناریو و ${insertedScenes.length} صحنه اختصاصی برای پروژه «${project.title}» تولید شد`,
    projectId
  );

  studioWsHub.emitToUser(userId, 'blueprint:generated', {
    projectId,
    sceneCount: insertedScenes.length,
  });

  return {
    project: updatedProject,
    styleBlueprint,
    scenario: adapted.scenario,
    scenes: insertedScenes,
  };
}

export async function regenerateSingleScene(params: {
  userId: number;
  projectId: number;
  sceneId: number;
  instruction?: string;
}): Promise<ProjectSceneRow> {
  const { userId, projectId, sceneId, instruction = '' } = params;

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  if (!project) {
    throw new Error('پروژه یافت نشد.');
  }

  const [scene] = await db
    .select()
    .from(projectScenes)
    .where(and(eq(projectScenes.id, sceneId), eq(projectScenes.projectId, projectId)))
    .limit(1);

  if (!scene) {
    throw new Error('صحنه یافت نشد.');
  }

  if (scene.locked) {
    throw new Error('این صحنه قفل شده است. برای بازتولید، ابتدا قفل آن را باز کنید.');
  }

  const isFa = project.language !== 'en';
  let newVariant: Record<string, unknown> | null = null;

  if (isGeminiConfigured()) {
    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Generate an alternative creative variation for a single motion graphics scene in ${
          isFa ? 'Persian (فارسی)' : 'English'
        }.
Project: ${project.title} (${project.businessName || project.topic})
Current Scene Title: ${scene.title}
Current Text: ${scene.textContent}
Current Visual Prompt: ${scene.visualPrompt}
User Modification Request: ${instruction || 'Make the headline punchier and suggest a fresh motion preset'}
Allowed animationPreset: ${STANDARD_ANIMATION_PRESETS.join(', ')}
Allowed transitionType: ${STANDARD_TRANSITIONS.join(', ')}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              textContent: { type: Type.STRING },
              visualPrompt: { type: Type.STRING },
              animationPreset: { type: Type.STRING },
              transitionType: { type: Type.STRING },
            },
            required: ['title', 'textContent', 'visualPrompt', 'animationPreset', 'transitionType'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        title?: string;
        textContent?: string;
        visualPrompt?: string;
        animationPreset?: string;
        transitionType?: string;
      };
      if (parsed.textContent) {
        const nextPreset = mapAnimationPreset(parsed.animationPreset || scene.animationPreset);
        const nextTrans = mapTransitionType(parsed.transitionType || scene.transitionType);
        newVariant = {
          label: isFa ? `نسخه ${(scene.variants?.length || 0) + 1}` : `Variant ${(scene.variants?.length || 0) + 1}`,
          title: parsed.title || scene.title,
          textContent: parsed.textContent,
          visualPrompt: parsed.visualPrompt || scene.visualPrompt,
          animationPreset: nextPreset,
          transitionType: nextTrans,
        };
      }
    } catch {
      // Fall back to deterministic alternative variant
    }
  }

  if (!newVariant) {
    const idx = ((scene.variants?.length || 1) + 1) % STANDARD_ANIMATION_PRESETS.length;
    newVariant = {
      label: isFa ? `نسخه ${(scene.variants?.length || 0) + 1}` : `Variant ${(scene.variants?.length || 0) + 1}`,
      title: scene.title,
      textContent: instruction ? `${scene.textContent} — ${instruction}` : `${scene.textContent}!`,
      visualPrompt: instruction || scene.visualPrompt,
      animationPreset: STANDARD_ANIMATION_PRESETS[idx],
      transitionType: STANDARD_TRANSITIONS[idx % STANDARD_TRANSITIONS.length],
    };
  }

  const nextVariants = [...(Array.isArray(scene.variants) ? scene.variants : []), newVariant];
  const nextActiveIndex = nextVariants.length - 1;

  const [updated] = await db
    .update(projectScenes)
    .set({
      title: String(newVariant.title || scene.title),
      textContent: String(newVariant.textContent || scene.textContent),
      visualPrompt: String(newVariant.visualPrompt || scene.visualPrompt),
      animationPreset: String(newVariant.animationPreset || scene.animationPreset),
      transitionType: String(newVariant.transitionType || scene.transitionType),
      variants: nextVariants,
      activeVariantIndex: nextActiveIndex,
      updatedAt: new Date(),
    })
    .where(eq(projectScenes.id, sceneId))
    .returning();

  await logActivity(
    userId,
    'scene.regenerated',
    `نسخه جدید برای صحنه «${updated.title}» تولید شد`,
    projectId
  );

  return updated;
}
