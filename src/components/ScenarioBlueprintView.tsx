import {
  Check,
  Layers,
  Loader2,
  Lock,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { useStudioStore, type StudioMediaAsset } from '../store/useStudioStore.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface StyleColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  swatches: string[];
}

interface StyleBlueprint {
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

interface ScenarioBlueprint {
  hookLine: string;
  valueProposition: string;
  ctaLine: string;
  voiceoverNarration: string;
  musicDirection: string;
  toneOfVoice: string;
  brandKeyMessages: string[];
  generationMode: string;
  note?: string | null;
}

interface SceneVariant {
  label?: string;
  title?: string;
  textContent?: string;
  visualPrompt?: string;
  animationPreset?: string;
  transitionType?: string;
}

interface ProjectSceneItem {
  id: number;
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
  variants: SceneVariant[];
  activeVariantIndex: number;
}

interface ReferenceChoice {
  id: number;
  platform: string;
  sourceType: string;
  analysisStatus: string;
}

const ANIMATION_OPTIONS = [
  { value: 'fade_slide_up', labelFa: 'ورود نرم از پایین', labelEn: 'Fade Slide Up' },
  { value: 'kinetic_pop', labelFa: 'پاپ کینتیک پرانرژی', labelEn: 'Kinetic Pop' },
  { value: 'typewriter', labelFa: 'تایپ ماشینی', labelEn: 'Typewriter' },
  { value: 'scale_reveal', labelFa: 'نمایش با بزرگ‌نمایی', labelEn: 'Scale Reveal' },
  { value: 'slide_left', labelFa: 'لغزش افقی', labelEn: 'Slide Horizontal' },
  { value: 'zoom_pulse', labelFa: 'پالس و زوم کانونی', labelEn: 'Zoom Pulse' },
];

const TRANSITION_OPTIONS = [
  { value: 'cross_dissolve', labelFa: 'محو متقاطع', labelEn: 'Cross Dissolve' },
  { value: 'whip_pan', labelFa: 'چرخش سریع (Whip Pan)', labelEn: 'Whip Pan' },
  { value: 'zoom_cut', labelFa: 'برش با زوم', labelEn: 'Zoom Cut' },
  { value: 'slide_wipe', labelFa: 'پاک‌شدن لغزشی', labelEn: 'Slide Wipe' },
  { value: 'hard_cut', labelFa: 'برش مستقیم', labelEn: 'Hard Cut' },
  { value: 'fade_out', labelFa: 'محو پایانی', labelEn: 'Fade Out' },
];

function formatTimeMs(ms: number): string {
  const sec = ms / 1000;
  const mins = Math.floor(sec / 60);
  const rem = (sec % 60).toFixed(1).padStart(4, '0');
  return `${String(mins).padStart(2, '0')}:${rem}`;
}

export function ScenarioBlueprintView({
  projectId,
  onProjectUpdated,
}: {
  projectId: number;
  onProjectUpdated: () => Promise<void>;
}) {
  const { getToken } = useAuth();
  const locale = useStudioStore((s) => s.locale);
  const blueprintPulse = useStudioStore((s) => s.blueprintPulse);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingStyle, setSavingStyle] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [busySceneId, setBusySceneId] = useState<number | null>(null);
  const [deleteSceneId, setDeleteSceneId] = useState<number | null>(null);
  const [deletingScene, setDeletingScene] = useState(false);

  const [styleBlueprint, setStyleBlueprint] = useState<StyleBlueprint | null>(null);
  const [scenario, setScenario] = useState<ScenarioBlueprint | null>(null);
  const [scenes, setScenes] = useState<ProjectSceneItem[]>([]);
  const [references, setReferences] = useState<ReferenceChoice[]>([]);
  const [userAssets, setUserAssets] = useState<StudioMediaAsset[]>([]);

  // Generator controls
  const [selectedRefId, setSelectedRefId] = useState<string>('');
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [toneOfVoice, setToneOfVoice] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [preserveLocked, setPreserveLocked] = useState(true);

  const loadBlueprint = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await apiFetch<{
        referenceStyleProfile: StyleBlueprint | null;
        scenarioData: ScenarioBlueprint | null;
        scenes: ProjectSceneItem[];
        references: ReferenceChoice[];
        mediaAssets: StudioMediaAsset[];
      }>(`/api/projects/${projectId}/blueprint`, {}, token);

      setStyleBlueprint(data.referenceStyleProfile);
      setScenario(data.scenarioData);
      setScenes(data.scenes);
      setReferences(data.references.filter((r) => r.analysisStatus === 'completed'));
      setUserAssets(data.mediaAssets);

      const completed = data.references.filter((r) => r.analysisStatus === 'completed');
      if (completed.length > 0 && !selectedRefId) {
        setSelectedRefId(String(completed[0].id));
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'خطا در بارگذاری سناریو و الگوی سبک'
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, getToken, setErrorBanner]);

  useEffect(() => {
    void loadBlueprint();
  }, [loadBlueprint, blueprintPulse]);

  const toggleAsset = (assetId: number) => {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  const handleGenerateBlueprint = async (e: FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setErrorBanner(null);
    try {
      const token = await getToken();
      const res = await apiFetch<{
        styleBlueprint: StyleBlueprint;
        scenario: ScenarioBlueprint;
        scenes: ProjectSceneItem[];
      }>(
        `/api/projects/${projectId}/blueprint/generate`,
        {
          method: 'POST',
          body: JSON.stringify({
            referenceVideoId: selectedRefId ? Number(selectedRefId) : null,
            toneOfVoice,
            ctaText,
            customInstructions,
            mediaAssetIds: selectedAssetIds,
            preserveLocked,
          }),
        },
        token
      );
      setStyleBlueprint(res.styleBlueprint);
      setScenario(res.scenario);
      setScenes(res.scenes);
      await onProjectUpdated();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'خطا در الگوبرداری و تولید سناریوی اختصاصی'
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveStyleAndScenario = async () => {
    setSavingStyle(true);
    setSavedNotice(false);
    setErrorBanner(null);
    try {
      const token = await getToken();
      await apiFetch(
        `/api/projects/${projectId}/blueprint/style`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            referenceStyleProfile: styleBlueprint,
            scenarioData: scenario,
          }),
        },
        token
      );
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
      await onProjectUpdated();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در ذخیره پالت و سناریو');
    } finally {
      setSavingStyle(false);
    }
  };

  const handleUpdateScene = async (
    sceneId: number,
    patch: Record<string, unknown>
  ) => {
    setBusySceneId(sceneId);
    setErrorBanner(null);
    try {
      const token = await getToken();
      const res = await apiFetch<{ scenes: ProjectSceneItem[] }>(
        `/api/projects/${projectId}/scenes/${sceneId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
        token
      );
      setScenes(res.scenes);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در ویرایش صحنه');
    } finally {
      setBusySceneId(null);
    }
  };

  const handleRegenerateScene = async (sceneId: number) => {
    setBusySceneId(sceneId);
    setErrorBanner(null);
    try {
      const token = await getToken();
      const res = await apiFetch<{ scenes: ProjectSceneItem[] }>(
        `/api/projects/${projectId}/scenes/${sceneId}/regenerate`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
        token
      );
      setScenes(res.scenes);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در تولید نسخه جدید صحنه');
    } finally {
      setBusySceneId(null);
    }
  };

  const handleAddScene = async () => {
    setErrorBanner(null);
    try {
      const token = await getToken();
      const res = await apiFetch<{ scenes: ProjectSceneItem[] }>(
        `/api/projects/${projectId}/scenes`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: locale === 'fa' ? `صحنه ${scenes.length + 1}` : `Scene ${scenes.length + 1}`,
            textContent: locale === 'fa' ? 'متن جدید صحنه' : 'New Scene Headline',
            durationMs: 3000,
          }),
        },
        token
      );
      setScenes(res.scenes);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در افزودن صحنه');
    }
  };

  const handleConfirmDeleteScene = async () => {
    if (!deleteSceneId) return;
    setDeletingScene(true);
    try {
      const token = await getToken();
      const res = await apiFetch<{ scenes: ProjectSceneItem[] }>(
        `/api/projects/${projectId}/scenes/${deleteSceneId}`,
        { method: 'DELETE' },
        token
      );
      setScenes(res.scenes);
      setDeleteSceneId(null);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در حذف صحنه');
    } finally {
      setDeletingScene(false);
    }
  };

  const updateLocalSceneField = (
    sceneId: number,
    field: keyof ProjectSceneItem,
    value: unknown
  ) => {
    setScenes((prev) =>
      prev.map((sc) => (sc.id === sceneId ? { ...sc, [field]: value } : sc))
    );
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827]">
        {locale === 'fa'
          ? 'در حال بارگذاری موتور الگوبرداری و سناریو...'
          : 'Loading style adaptation & scenario workspace...'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Phase 4 Adaptation Generator Panel */}
      <form
        onSubmit={handleGenerateBlueprint}
        className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827]"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {locale === 'fa'
                ? 'موتور الگوبرداری هوشمند و تولید سناریوی اختصاصی'
                : 'Smart Style Adaptation & Brand Scenario Generator'}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {locale === 'fa'
                ? 'سبک، ریتم، رنگ‌ها و انیمیشن‌های تحلیل‌شده را به محتوای کاملاً اختصاصی کسب‌وکار و دارایی‌های خودتان تبدیل کنید.'
                : 'Adapt analyzed reference pacing, colors, and motion into original brand scenes and script.'}
            </p>
          </div>

          <button
            type="submit"
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span>
              {generating
                ? locale === 'fa'
                  ? 'در حال تولید سناریو و صحنه‌ها...'
                  : 'Adapting Blueprint...'
                : locale === 'fa'
                ? 'تولید هوشمند سناریو و صحنه‌های اختصاصی'
                : 'Generate Adapted Scenario & Scenes'}
            </span>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {locale === 'fa' ? 'منبع الگوبرداری سبک' : 'Reference Source'}
            </label>
            <select
              value={selectedRefId}
              onChange={(e) => setSelectedRefId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
            >
              <option value="">
                {locale === 'fa'
                  ? 'طراحی مستقیم بر اساس مشخصات پروژه'
                  : 'Direct from Project Specifications'}
              </option>
              {references.map((r) => (
                <option key={r.id} value={r.id}>
                  {locale === 'fa' ? `تحلیل نمونه #${r.id}` : `Reference #${r.id}`} · {r.platform}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {locale === 'fa' ? 'لحن و لحن تبلیغاتی (اختیاری)' : 'Tone of Voice (Optional)'}
            </label>
            <input
              type="text"
              value={toneOfVoice}
              onChange={(e) => setToneOfVoice(e.target.value)}
              placeholder={
                locale === 'fa' ? 'مثلاً: پرانرژی، لوکس، صمیمی' : 'e.g. Energetic, Minimal, Trustworthy'
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {locale === 'fa' ? 'متن دعوت به اقدام (CTA)' : 'Call To Action (CTA)'}
            </label>
            <input
              type="text"
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              placeholder={
                locale === 'fa' ? 'مثلاً: همین حالا سفارش دهید' : 'e.g. Shop Now — 20% Off'
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div className="flex items-end pb-1">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={preserveLocked}
                onChange={(e) => setPreserveLocked(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>
                {locale === 'fa'
                  ? 'حفظ صحنه‌های قفل‌شده هنگام بازتولید'
                  : 'Preserve locked scenes on regenerate'}
              </span>
            </label>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {locale === 'fa'
                ? 'توضیحات تکمیلی برند و نکات سناریو (اختیاری)'
                : 'Additional Brand Instructions (Optional)'}
            </label>
            <input
              type="text"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder={
                locale === 'fa'
                  ? 'مثلاً: روی ارسال رایگان و گارانتی ۱ ساله تأکید شود...'
                  : 'Highlight free shipping, warranty, or key USP...'
              }
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
              {locale === 'fa'
                ? 'دارایی‌های اختصاصی برای جایگذاری در صحنه‌ها (لوگو / عکس / ویدئو)'
                : 'Brand Assets to Bind into Scenes (Logo / Photos / Clips)'}
            </label>
            {userAssets.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                {locale === 'fa'
                  ? 'هنوز فایلی در کتابخانه رسانه نیست.'
                  : 'No media assets uploaded yet.'}
              </p>
            ) : (
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-900/50">
                {userAssets.map((asset) => {
                  const active = selectedAssetIds.includes(asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => toggleAsset(asset.id)}
                      className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {asset.displayName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Style Blueprint & Commercial Scenario Editor */}
      {(styleBlueprint || scenario) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Style Palette & Motion Profile */}
          {styleBlueprint && (
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Palette className="h-4 w-4 text-blue-600" />
                  <span>{locale === 'fa' ? 'پروفایل سبک و رنگ برند' : 'Style & Color Blueprint'}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                {(
                  [
                    ['primary', locale === 'fa' ? 'رنگ اصلی' : 'Primary'],
                    ['secondary', locale === 'fa' ? 'رنگ ثانویه' : 'Secondary'],
                    ['accent', locale === 'fa' ? 'رنگ تاکیدی' : 'Accent'],
                    ['background', locale === 'fa' ? 'پس‌زمینه' : 'Background'],
                    ['text', locale === 'fa' ? 'رنگ متن' : 'Text'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-900">
                    <span className="text-slate-600 dark:text-slate-300">{label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-slate-500">
                        {styleBlueprint.colorPalette[key]}
                      </span>
                      <input
                        type="color"
                        value={styleBlueprint.colorPalette[key]}
                        onChange={(e) =>
                          setStyleBlueprint({
                            ...styleBlueprint,
                            colorPalette: {
                              ...styleBlueprint.colorPalette,
                              [key]: e.target.value.toUpperCase(),
                            },
                          })
                        }
                        className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                    </div>
                  </label>
                ))}
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                <p className="text-slate-600 dark:text-slate-400">
                  <strong className="text-slate-800 dark:text-slate-200">
                    {locale === 'fa' ? 'تایپوگرافی: ' : 'Typography: '}
                  </strong>
                  {styleBlueprint.typography.headingStyle}
                </p>
                <p className="text-slate-600 dark:text-slate-400 tabular-nums">
                  <strong className="text-slate-800 dark:text-slate-200">
                    {locale === 'fa' ? 'ریتم: ' : 'Rhythm: '}
                  </strong>
                  {styleBlueprint.rhythm.pace} · {styleBlueprint.rhythm.bpmEstimate}
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  <strong className="text-slate-800 dark:text-slate-200">
                    {locale === 'fa' ? 'ساختار: ' : 'Structure: '}
                  </strong>
                  {styleBlueprint.structurePattern}
                </p>
              </div>
            </section>
          )}

          {/* Scenario Editor */}
          {scenario && (
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827] lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {locale === 'fa' ? 'سناریوی تبلیغاتی و متن گوینده' : 'Commercial Script & Voiceover'}
                  </h4>
                  {scenario.note && (
                    <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                      {scenario.note}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={savingStyle}
                  onClick={handleSaveStyleAndScenario}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
                >
                  {savedNotice ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                  <span>
                    {savingStyle
                      ? locale === 'fa'
                        ? 'در حال ذخیره...'
                        : 'Saving...'
                      : savedNotice
                      ? locale === 'fa'
                        ? 'ذخیره شد'
                        : 'Saved'
                      : locale === 'fa'
                      ? 'ذخیره پالت و سناریو'
                      : 'Save Palette & Script'}
                  </span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {locale === 'fa' ? 'قلاب آغازین (Hook)' : 'Opening Hook'}
                  </label>
                  <input
                    type="text"
                    value={scenario.hookLine}
                    onChange={(e) => setScenario({ ...scenario, hookLine: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {locale === 'fa' ? 'دعوت به اقدام (CTA)' : 'Call To Action (CTA)'}
                  </label>
                  <input
                    type="text"
                    value={scenario.ctaLine}
                    onChange={(e) => setScenario({ ...scenario, ctaLine: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {locale === 'fa' ? 'پیام اصلی و ارزش پیشنهادی' : 'Core Value Proposition'}
                  </label>
                  <input
                    type="text"
                    value={scenario.valueProposition}
                    onChange={(e) =>
                      setScenario({ ...scenario, valueProposition: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {locale === 'fa' ? 'متن نریشن / گوینده (Voiceover)' : 'Voiceover Narration'}
                  </label>
                  <textarea
                    rows={3}
                    value={scenario.voiceoverNarration}
                    onChange={(e) =>
                      setScenario({ ...scenario, voiceoverNarration: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Scene-by-Scene Production Cards */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {locale === 'fa'
                ? 'صحنه‌های اختصاصی پروژه (قابل ویرایش مستقل، قفل و تولید نسخه جایگزین)'
                : 'Project Production Scenes (Editable, Lockable & Variant-Ready)'}
            </h3>
          </div>

          <button
            type="button"
            onClick={handleAddScene}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{locale === 'fa' ? 'افزودن صحنه جدید' : 'Add Scene'}</span>
          </button>
        </div>

        {scenes.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {locale === 'fa'
              ? 'هنوز صحنه‌ای تولید نشده است. از دکمه «تولید هوشمند سناریو و صحنه‌های اختصاصی» در بالا استفاده کنید یا یک صحنه دستی اضافه نمایید.'
              : 'No scenes generated yet. Use the blueprint generator above or add a manual scene.'}
          </div>
        ) : (
          <div className="space-y-4">
            {scenes.map((sc) => {
              const attachedLayer = sc.layersConfig?.find(
                (l) => typeof l.mediaAssetId === 'number'
              );
              const currentAssetId = attachedLayer ? String(attachedLayer.mediaAssetId) : '';
              const isBusy = busySceneId === sc.id;

              return (
                <article
                  key={sc.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                        #{sc.orderIndex + 1}
                      </span>
                      <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {formatTimeMs(sc.startTimeMs)} – {formatTimeMs(sc.startTimeMs + sc.durationMs)} (
                        {(sc.durationMs / 1000).toFixed(1)}s)
                      </span>

                      {Array.isArray(sc.variants) && sc.variants.length > 1 && (
                        <div className="flex items-center gap-1">
                          {sc.variants.map((v, vIdx) => (
                            <button
                              key={vIdx}
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                handleUpdateScene(sc.id, { activeVariantIndex: vIdx })
                              }
                              className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                                sc.activeVariantIndex === vIdx
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {v.label || `V${vIdx + 1}`}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleUpdateScene(sc.id, { locked: !sc.locked })}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium ${
                          sc.locked
                            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        {sc.locked ? (
                          <Lock className="h-3 w-3" />
                        ) : (
                          <Unlock className="h-3 w-3" />
                        )}
                        <span>
                          {sc.locked
                            ? locale === 'fa'
                              ? 'قفل‌شده'
                              : 'Locked'
                            : locale === 'fa'
                            ? 'قفل'
                            : 'Lock'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy || sc.locked}
                        onClick={() => handleRegenerateScene(sc.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <RefreshCw className={`h-3 w-3 ${isBusy ? 'animate-spin' : ''}`} />
                        <span>
                          {locale === 'fa' ? 'نسخه جایگزین' : 'New Variant'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          handleUpdateScene(sc.id, {
                            title: sc.title,
                            textContent: sc.textContent,
                            visualPrompt: sc.visualPrompt,
                            durationMs: sc.durationMs,
                            animationPreset: sc.animationPreset,
                            transitionType: sc.transitionType,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Save className="h-3 w-3" />
                        <span>{locale === 'fa' ? 'ذخیره صحنه' : 'Save'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeleteSceneId(sc.id)}
                        className="inline-flex items-center rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                        aria-label="Delete scene"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">
                        {locale === 'fa' ? 'عنوان صحنه' : 'Scene Title'}
                      </label>
                      <input
                        type="text"
                        value={sc.title}
                        onChange={(e) => updateLocalSceneField(sc.id, 'title', e.target.value)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">
                        {locale === 'fa' ? 'متن نمایشی روی تصویر' : 'On-Screen Text'}
                      </label>
                      <input
                        type="text"
                        value={sc.textContent}
                        onChange={(e) =>
                          updateLocalSceneField(sc.id, 'textContent', e.target.value)
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">
                        {locale === 'fa' ? 'انیمیشن متن' : 'Animation Preset'}
                      </label>
                      <select
                        value={sc.animationPreset}
                        onChange={(e) =>
                          updateLocalSceneField(sc.id, 'animationPreset', e.target.value)
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                      >
                        {ANIMATION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {locale === 'fa' ? opt.labelFa : opt.labelEn}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">
                          {locale === 'fa' ? 'ترنزیشن' : 'Transition'}
                        </label>
                        <select
                          value={sc.transitionType}
                          onChange={(e) =>
                            updateLocalSceneField(sc.id, 'transitionType', e.target.value)
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                        >
                          {TRANSITION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {locale === 'fa' ? opt.labelFa : opt.labelEn}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-500">
                          {locale === 'fa' ? 'مدت (ثانیه)' : 'Duration (s)'}
                        </label>
                        <input
                          type="number"
                          min={0.8}
                          max={60}
                          step={0.5}
                          value={(sc.durationMs / 1000).toFixed(1)}
                          onChange={(e) =>
                            updateLocalSceneField(
                              sc.id,
                              'durationMs',
                              Math.round((Number(e.target.value) || 1) * 1000)
                            )
                          }
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs tabular-nums dark:border-slate-700 dark:bg-slate-900"
                        />
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">
                        {locale === 'fa' ? 'توضیح بصری و ترکیب‌بندی صحنه' : 'Visual Direction'}
                      </label>
                      <input
                        type="text"
                        value={sc.visualPrompt}
                        onChange={(e) =>
                          updateLocalSceneField(sc.id, 'visualPrompt', e.target.value)
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">
                        {locale === 'fa' ? 'رسانه متصل به صحنه' : 'Attached Scene Media'}
                      </label>
                      <select
                        value={currentAssetId}
                        onChange={(e) => {
                          const pickedId = Number(e.target.value);
                          const picked = userAssets.find((a) => a.id === pickedId);
                          const nextLayers = picked
                            ? [
                                {
                                  type: picked.category === 'video' ? 'video' : 'image',
                                  mediaAssetId: picked.id,
                                  displayName: picked.displayName,
                                  category: picked.category,
                                  opacity: 1,
                                  fit: 'contain',
                                },
                              ]
                            : [];
                          void handleUpdateScene(sc.id, { layersConfig: nextLayers });
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                      >
                        <option value="">
                          {locale === 'fa' ? 'فقط گرافیک و تایپوگرافی' : 'Typography & Motion Only'}
                        </option>
                        {userAssets.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.displayName} ({a.category})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deleteSceneId)}
        title={locale === 'fa' ? 'حذف صحنه' : 'Delete Scene'}
        description={
          locale === 'fa'
            ? 'آیا از حذف این صحنه از سناریوی پروژه اطمینان دارید؟'
            : 'Remove this scene from the project blueprint?'
        }
        confirmLabel={locale === 'fa' ? 'بله، حذف شود' : 'Delete Scene'}
        cancelLabel={locale === 'fa' ? 'انصراف' : 'Cancel'}
        onConfirm={handleConfirmDeleteScene}
        onCancel={() => setDeleteSceneId(null)}
        busy={deletingScene}
      />
    </div>
  );
}
