import { X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { translations } from '../i18n/translations.ts';
import { apiFetch } from '../lib/api.ts';
import { STARTER_TEMPLATES } from '../shared/templates.ts';
import { useStudioStore, type StudioProject } from '../store/useStudioStore.ts';

interface ProjectWizardModalProps {
  onCreated: (project: StudioProject) => Promise<void>;
}

const DESIGN_STYLES = [
  { id: 'modern_minimal', fa: 'مدرن مینیمال', en: 'Modern Minimal' },
  { id: 'bold_kinetic', fa: 'تایپوگرافی پرانرژی (Kinetic)', en: 'Bold Kinetic Typography' },
  { id: 'luxury_cinematic', fa: 'سینمایی لوکس', en: 'Luxury Cinematic' },
  { id: 'clean_corporate', fa: 'شرکتی رسمی', en: 'Clean Corporate' },
  { id: 'warm_editorial', fa: 'گرم و صمیمی (کافه/سبک زندگی)', en: 'Warm Editorial' },
  { id: 'neon_tech', fa: 'تکنولوژی و دیجیتال', en: 'Digital Tech' },
];

const DURATION_PRESETS = [5, 10, 15, 20, 30, 45, 60];

export function ProjectWizardModal({ onCreated }: ProjectWizardModalProps) {
  const { getToken } = useAuth();
  const locale = useStudioStore((s) => s.locale);
  const wizardOpen = useStudioStore((s) => s.wizardOpen);
  const wizardTemplateId = useStudioStore((s) => s.wizardTemplateId);
  const closeWizard = useStudioStore((s) => s.closeWizard);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);
  const t = translations[locale];

  const [templateId, setTemplateId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [productType, setProductType] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [language, setLanguage] = useState<'fa' | 'en'>(locale);
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [customWidth, setCustomWidth] = useState(1080);
  const [customHeight, setCustomHeight] = useState(1920);
  const [durationSeconds, setDurationSeconds] = useState(15);
  const [designStyle, setDesignStyle] = useState('modern_minimal');
  const [outputQuality, setOutputQuality] = useState('1080p');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!wizardOpen) return;
    setLanguage(locale);
    if (wizardTemplateId) {
      const tpl = STARTER_TEMPLATES.find((item) => item.id === wizardTemplateId);
      if (tpl) {
        setTemplateId(tpl.id);
        setAspectRatio(tpl.aspectRatio);
        setDurationSeconds(tpl.durationSeconds);
        setDesignStyle(tpl.designStyle);
        return;
      }
    }
    setTemplateId('');
  }, [wizardOpen, wizardTemplateId, locale]);

  if (!wizardOpen) return null;

  const handleTemplateSelect = (nextId: string) => {
    setTemplateId(nextId);
    const tpl = STARTER_TEMPLATES.find((item) => item.id === nextId);
    if (tpl) {
      setAspectRatio(tpl.aspectRatio);
      setDurationSeconds(tpl.durationSeconds);
      setDesignStyle(tpl.designStyle);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2) {
      setErrorBanner(
        locale === 'fa'
          ? 'عنوان پروژه باید حداقل ۲ کاراکتر باشد.'
          : 'Project title must be at least 2 characters.'
      );
      return;
    }

    setSubmitting(true);
    setErrorBanner(null);
    try {
      const token = await getToken();
      const res = await apiFetch<{ project: StudioProject }>(
        '/api/projects',
        {
          method: 'POST',
          body: JSON.stringify({
            title: title.trim(),
            topic: topic.trim(),
            businessName: businessName.trim(),
            productType: productType.trim(),
            targetAudience: targetAudience.trim(),
            language,
            aspectRatio,
            customWidth: aspectRatio === 'custom' ? customWidth : undefined,
            customHeight: aspectRatio === 'custom' ? customHeight : undefined,
            durationSeconds,
            designStyle,
            outputQuality,
            templateId: templateId || undefined,
          }),
        },
        token
      );
      setTitle('');
      setTopic('');
      setBusinessName('');
      setProductType('');
      setTargetAudience('');
      closeWizard();
      await onCreated(res.project);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در ایجاد پروژه');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {t.wizardTitle}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t.wizardSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={closeWizard}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* Starter Template Selection */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
              {t.starterTemplate}
            </label>
            <select
              value={templateId}
              onChange={(e) => handleTemplateSelect(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">{t.blankProject}</option>
              {STARTER_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {locale === 'fa' ? tpl.titleFa : tpl.titleEn} ({tpl.aspectRatio} · {tpl.durationSeconds}s)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.projectTitle} *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={locale === 'fa' ? 'مثلاً: تبلیغ ریلز کالکشن پاییزی' : 'e.g. Autumn Collection Launch'}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.businessName}
              </label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder={locale === 'fa' ? 'نام برند یا فروشگاه' : 'Brand or company name'}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.projectTopic}
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={locale === 'fa' ? 'پیام اصلی یا موضوع کمپین تبلیغاتی' : 'Primary message or campaign goal'}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.productType}
              </label>
              <input
                type="text"
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                placeholder={locale === 'fa' ? 'مثلاً: پوشاک، نرم‌افزار، کافه' : 'e.g. SaaS, Retail, Food'}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.targetAudience}
              </label>
              <input
                type="text"
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder={locale === 'fa' ? 'مثلاً: مدیران کسب‌وکارها، جوانان ۱۸ تا ۳۵ سال' : 'e.g. Founders, Gen-Z shoppers'}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.videoLanguage}
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value === 'en' ? 'en' : 'fa')}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="fa">فارسی (RTL)</option>
                <option value="en">English (LTR)</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.aspectRatio}
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="9:16">9:16 · Reels & Shorts (1080×1920)</option>
                <option value="16:9">16:9 · YouTube (1920×1080)</option>
                <option value="1:1">1:1 · Square Post (1080×1080)</option>
                <option value="4:5">4:5 · Vertical Post (1080×1350)</option>
                <option value="custom">
                  {locale === 'fa' ? 'اندازه سفارشی (Custom)' : 'Custom Dimensions'}
                </option>
              </select>
            </div>

            {aspectRatio === 'custom' && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {t.customWidth}
                  </label>
                  <input
                    type="number"
                    min={240}
                    max={3840}
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {t.customHeight}
                  </label>
                  <input
                    type="number"
                    min={240}
                    max={3840}
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </>
            )}

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.durationSeconds}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {DURATION_PRESETS.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => setDurationSeconds(sec)}
                    className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-medium transition-colors tabular-nums ${
                      durationSeconds === sec
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {sec}s
                  </button>
                ))}
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(Number(e.target.value))}
                  className="w-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.designStyle}
              </label>
              <select
                value={designStyle}
                onChange={(e) => setDesignStyle(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {DESIGN_STYLES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {locale === 'fa' ? st.fa : st.en}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {t.outputQuality}
              </label>
              <select
                value={outputQuality}
                onChange={(e) => setOutputQuality(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="720p">720p HD</option>
                <option value="1080p">1080p Full HD</option>
                <option value="4k">4K Ultra HD</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <button
              type="button"
              onClick={closeWizard}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? t.creating : t.saveProject}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
