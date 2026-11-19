import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Film,
  ImagePlus,
  Link2,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiFetch, fetchAuthenticatedBlobUrl } from '../lib/api.ts';
import { useStudioStore } from '../store/useStudioStore.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

export interface ReferenceSceneItem {
  id: number;
  referenceVideoId: number;
  sceneNumber: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  frameStorageKey: string;
  detectedText: string;
  textAnimation: string;
  visualEffects: string[];
  cameraMotion: string;
  dominantColors: string[];
  transitionType: string;
  typographyNotes: string;
  aiDescription: string;
}

export interface ReferenceVideoItem {
  id: number;
  projectId: number;
  sourceType: string;
  sourceUrl: string | null;
  platform: string;
  accessStatus: string;
  accessMessage: string;
  mediaAssetId: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: string | null;
  hasAudio: boolean;
  analysisStatus: string;
  analysisError: string | null;
  overallSummary: {
    rhythm?: string;
    bpmEstimate?: string;
    audioVisualSync?: string;
    visualStyle?: string;
    typographyStyle?: string;
    structureOverview?: string;
    analysisMode?: string;
    palette?: string[];
    detectedTitle?: string;
    note?: string | null;
  } | null;
  createdAt: string;
  scenes: ReferenceSceneItem[];
}

function formatTimeMs(ms: number): string {
  const totalSec = ms / 1000;
  const mins = Math.floor(totalSec / 60);
  const secs = (totalSec % 60).toFixed(1).padStart(4, '0');
  return `${String(mins).padStart(2, '0')}:${secs}`;
}

export function ReferenceAnalyzerView({ projectId }: { projectId: number }) {
  const { getToken } = useAuth();
  const locale = useStudioStore((s) => s.locale);
  const mediaAssets = useStudioStore((s) => s.mediaAssets);
  const analysisPulse = useStudioStore((s) => s.analysisPulse);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);

  const [references, setReferences] = useState<ReferenceVideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputMode, setInputMode] = useState<'brief' | 'video' | 'link'>('brief');
  const [uploading, setUploading] = useState(false);
  const [checkingLink, setCheckingLink] = useState(false);
  const [submittingBrief, setSubmittingBrief] = useState(false);
  const [briefDescription, setBriefDescription] = useState('');
  const [briefFiles, setBriefFiles] = useState<File[]>([]);
  const [selectedLibraryImageIds, setSelectedLibraryImageIds] = useState<number[]>([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [selectedLibraryVideoId, setSelectedLibraryVideoId] = useState('');
  const [frameUrls, setFrameUrls] = useState<Record<number, string>>({});
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const libraryVideos = mediaAssets.filter((a) =>
    ['mp4', 'mov', 'webm'].includes(a.extension.toLowerCase())
  );
  const libraryImages = mediaAssets.filter((a) =>
    ['png', 'jpg', 'jpeg', 'webp'].includes(a.extension.toLowerCase())
  );

  const fetchReferences = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await apiFetch<{ references: ReferenceVideoItem[] }>(
        `/api/projects/${projectId}/references`,
        {},
        token
      );
      setReferences(data.references);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'خطا در دریافت تحلیل‌های ویدئوی نمونه'
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, getToken, setErrorBanner]);

  useEffect(() => {
    void fetchReferences();
  }, [fetchReferences, analysisPulse]);

  // Poll gently if any reference is actively processing
  useEffect(() => {
    const hasActive = references.some((r) =>
      ['pending', 'extracting_frames', 'analyzing_ai'].includes(r.analysisStatus)
    );
    if (!hasActive) return;
    const timer = setInterval(() => {
      void fetchReferences();
    }, 2500);
    return () => clearInterval(timer);
  }, [references, fetchReferences]);

  // Load authenticated JPEG keyframe thumbnails
  useEffect(() => {
    let active = true;
    const loadFrames = async () => {
      const token = await getToken();
      if (!token) return;
      for (const ref of references) {
        for (const sc of ref.scenes) {
          if (!sc.frameStorageKey || frameUrls[sc.id]) continue;
          try {
            const url = await fetchAuthenticatedBlobUrl(
              `/api/references/${ref.id}/scenes/${sc.id}/frame`,
              token
            );
            if (active) {
              setFrameUrls((prev) => ({ ...prev, [sc.id]: url }));
            } else {
              URL.revokeObjectURL(url);
            }
          } catch {
            // Non-fatal frame preview load failure
          }
        }
      }
    };
    void loadFrames();
    return () => {
      active = false;
    };
  }, [references, getToken]);

  const handleUploadReference = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setErrorBanner(null);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('file', file);
      await apiFetch(
        `/api/projects/${projectId}/references/upload`,
        { method: 'POST', body: formData },
        token
      );
      await fetchReferences();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در آپلود ویدئوی نمونه');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleAnalyzeFromLibrary = async () => {
    if (!selectedLibraryVideoId) return;
    setUploading(true);
    setErrorBanner(null);
    try {
      const token = await getToken();
      await apiFetch(
        `/api/projects/${projectId}/references/upload`,
        {
          method: 'POST',
          body: JSON.stringify({ mediaAssetId: Number(selectedLibraryVideoId) }),
        },
        token
      );
      setSelectedLibraryVideoId('');
      await fetchReferences();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در شروع تحلیل ویدئو');
    } finally {
      setUploading(false);
    }
  };

  const handleCheckLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!linkUrl.trim()) return;
    setCheckingLink(true);
    setErrorBanner(null);
    try {
      const token = await getToken();
      await apiFetch(
        `/api/projects/${projectId}/references/check-link`,
        {
          method: 'POST',
          body: JSON.stringify({ url: linkUrl.trim() }),
        },
        token
      );
      setLinkUrl('');
      await fetchReferences();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در بررسی لینک ویدئو');
    } finally {
      setCheckingLink(false);
    }
  };

  const handleBriefFilesChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    setBriefFiles((prev) => [...prev, ...picked].slice(0, 6));
    e.target.value = '';
  };

  const toggleLibraryImage = (assetId: number) => {
    setSelectedLibraryImageIds((prev) =>
      prev.includes(assetId)
        ? prev.filter((id) => id !== assetId)
        : prev.length + briefFiles.length < 6
        ? [...prev, assetId]
        : prev
    );
  };

  const handleSubmitBrief = async (e: FormEvent) => {
    e.preventDefault();
    if (!briefDescription.trim() && briefFiles.length === 0 && selectedLibraryImageIds.length === 0) {
      setErrorBanner(
        locale === 'fa'
          ? 'لطفاً توضیحات متنی بنویسید یا حداقل یک تصویر مرجع انتخاب کنید.'
          : 'Please enter a description or select at least one reference image.'
      );
      return;
    }
    setSubmittingBrief(true);
    setErrorBanner(null);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('description', briefDescription.trim());
      if (selectedLibraryImageIds.length > 0) {
        formData.append('mediaAssetIds', JSON.stringify(selectedLibraryImageIds));
      }
      for (const file of briefFiles) {
        formData.append('files', file);
      }
      await apiFetch(
        `/api/projects/${projectId}/references/brief`,
        { method: 'POST', body: formData },
        token
      );
      setBriefDescription('');
      setBriefFiles([]);
      setSelectedLibraryImageIds([]);
      await fetchReferences();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در ثبت توضیحات و تصاویر مرجع');
    } finally {
      setSubmittingBrief(false);
    }
  };

  const handleReanalyze = async (refId: number) => {
    try {
      const token = await getToken();
      await apiFetch(
        `/api/projects/${projectId}/references/${refId}/reanalyze`,
        { method: 'POST' },
        token
      );
      await fetchReferences();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در تحلیل مجدد');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    setDeleting(true);
    try {
      const token = await getToken();
      await apiFetch(
        `/api/references/${deleteTargetId}?confirm=true`,
        { method: 'DELETE' },
        token
      );
      setDeleteTargetId(null);
      await fetchReferences();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در حذف گزارش تحلیل');
    } finally {
      setDeleting(false);
    }
  };

  const statusLabel = (status: string) => {
    if (locale === 'fa') {
      if (status === 'pending') return 'در صف پردازش';
      if (status === 'extracting_frames') return 'در حال برش صحنه‌ها و استخراج فریم (FFmpeg)';
      if (status === 'analyzing_ai') return 'در حال تحلیل هوشمند فریم‌ها، متن و حرکت';
      if (status === 'completed') return 'تحلیل کامل شد';
      return 'نیازمند بارگذاری مستقیم یا بررسی';
    }
    return status;
  };

  const platformLabel = (platform: string) => {
    if (locale !== 'fa') return platform;
    if (platform === 'text_brief') return 'توضیحات متنی';
    if (platform === 'image_brief') return 'تصویر و توضیحات';
    if (platform === 'local') return 'آپلود مستقیم';
    if (platform === 'direct_video') return 'لینک مستقیم';
    return platform;
  };

  return (
    <div className="space-y-6">
      {/* Flexible 3-Mode Input Selector */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {locale === 'fa'
                ? 'ورود ایده و مرجع طراحی (با ویدئو، عکس یا فقط توضیحات)'
                : 'Reference & Creative Input (Text Brief, Images, or Video)'}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {locale === 'fa'
                ? 'اگر ویدئوی نمونه ندارید، می‌توانید فقط توضیحات خود و/یا یک یا چند عکس محصول و نمونه را وارد کنید.'
                : 'No reference video needed — provide a creative brief and/or images, or upload a video.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => setInputMode('brief')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                inputMode === 'brief'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>
                {locale === 'fa' ? 'توضیحات یا عکس (بدون ویدئو)' : 'Text / Images (No Video)'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setInputMode('video')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                inputMode === 'video'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>{locale === 'fa' ? 'آپلود ویدئوی نمونه' : 'Upload Video'}</span>
            </button>
            <button
              type="button"
              onClick={() => setInputMode('link')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                inputMode === 'link'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>{locale === 'fa' ? 'بررسی لینک ویدئو' : 'Video Link'}</span>
            </button>
          </div>
        </div>

        {/* Mode 1: Text Brief &/or Reference Images (No Video Required) */}
        {inputMode === 'brief' && (
          <form onSubmit={handleSubmitBrief} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                {locale === 'fa'
                  ? 'توضیحات، پیام تبلیغاتی و سبک مورد نظر (می‌توانید بدون عکس یا همراه با عکس وارد کنید)'
                  : 'Creative Description, Messaging & Desired Motion Style'}
              </label>
              <textarea
                rows={4}
                value={briefDescription}
                onChange={(e) => setBriefDescription(e.target.value)}
                placeholder={
                  locale === 'fa'
                    ? 'مثلاً: یک ویدئوی معرفی ریلز ۱۵ ثانیه‌ای برای کپسول قهوه با ریتم پرانرژی، رنگ‌های گرم قهوه‌ای و طلایی، نمایش متن بزرگ «تخفیف ویژه بهاره» و دعوت به خرید در پایان...'
                    : 'Describe your ad concept, key headlines, pacing, colors, and target vibe...'
                }
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  {locale === 'fa'
                    ? 'تصاویر مرجع یا عکس محصول (اختیاری، تا ۶ تصویر PNG / JPG / WebP)'
                    : 'Reference or Product Images (Optional, up to 6 PNG / JPG / WebP)'}
                </label>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-4 text-xs font-medium text-slate-700 transition-colors hover:border-blue-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-blue-500">
                  <ImagePlus className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span>
                    {locale === 'fa'
                      ? 'افزودن عکس از سیستم (اختیاری)'
                      : 'Attach Images from Device (Optional)'}
                  </span>
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                    disabled={submittingBrief || briefFiles.length >= 6}
                    onChange={handleBriefFilesChange}
                    className="hidden"
                  />
                </label>

                {briefFiles.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {briefFiles.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        <span className="max-w-[160px] truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setBriefFiles((prev) => prev.filter((_, fIdx) => fIdx !== idx))
                          }
                          className="text-slate-400 hover:text-red-500"
                          aria-label="Remove image"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  {locale === 'fa'
                    ? 'یا انتخاب از تصاویر کتابخانه رسانه'
                    : 'Or Select Images from Media Library'}
                </label>
                {libraryImages.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400">
                    {locale === 'fa'
                      ? 'هنوز تصویری در کتابخانه رسانه نیست؛ از بخش سمت راست/مقابل آپلود کنید.'
                      : 'No images in Media Library yet; attach images on the left.'}
                  </div>
                ) : (
                  <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                    {libraryImages.map((img) => {
                      const active = selectedLibraryImageIds.includes(img.id);
                      return (
                        <button
                          key={img.id}
                          type="button"
                          onClick={() => toggleLibraryImage(img.id)}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                            active
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {img.displayName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={submittingBrief}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
              >
                {submittingBrief ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                <span>
                  {submittingBrief
                    ? locale === 'fa'
                      ? 'در حال طراحی استوری‌بورد...'
                      : 'Generating Storyboard...'
                    : locale === 'fa'
                    ? 'طراحی استوری‌بورد و استخراج سبک'
                    : 'Generate Storyboard & Style'}
                </span>
              </button>
            </div>
          </form>
        )}

        {/* Mode 2: Upload Video or Pick from Library */}
        {inputMode === 'video' && (
          <div className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 p-6 text-center transition-colors hover:border-blue-500 dark:border-slate-700 dark:hover:border-blue-500">
              <UploadCloud className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              <span className="mt-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                {uploading
                  ? locale === 'fa'
                    ? 'در حال ارسال و شروع تحلیل...'
                    : 'Uploading & starting analysis...'
                  : locale === 'fa'
                  ? 'انتخاب فایل ویدئو (MP4 / MOV / WebM)'
                  : 'Select Video File (MP4 / MOV / WebM)'}
              </span>
              <input
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                disabled={uploading}
                onChange={handleUploadReference}
                className="hidden"
              />
            </label>

            {libraryVideos.length > 0 && (
              <div className="flex items-center gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                <select
                  value={selectedLibraryVideoId}
                  onChange={(e) => setSelectedLibraryVideoId(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="">
                    {locale === 'fa'
                      ? 'یا انتخاب از ویدئوهای کتابخانه رسانه...'
                      : 'Or pick from Media Library...'}
                  </option>
                  {libraryVideos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!selectedLibraryVideoId || uploading}
                  onClick={handleAnalyzeFromLibrary}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {locale === 'fa' ? 'تحلیل' : 'Analyze'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Mode 3: Video Link Check */}
        {inputMode === 'link' && (
          <form onSubmit={handleCheckLink} className="space-y-4">
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {locale === 'fa'
                ? 'لینک ویدئو (YouTube / Instagram / لینک مستقیم MP4) از نظر دسترسی و مجوز پردازش بررسی می‌شود. در صورت محدودیت پلتفرم، بارگذاری مستقیم یا استفاده از توضیحات/عکس پیشنهاد می‌شود.'
                : 'Links are verified for processing permissions. Restricted platforms prompt direct upload or creative brief.'}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px] flex-1">
                <Link2 className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="url"
                  required
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  dir="ltr"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pe-3 ps-9 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <button
                type="submit"
                disabled={checkingLink}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
              >
                {checkingLink
                  ? locale === 'fa'
                    ? 'در حال بررسی...'
                    : 'Checking...'
                  : locale === 'fa'
                  ? 'بررسی و تحلیل لینک'
                  : 'Verify & Analyze Link'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Analysis Reports & Storyboards */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827]">
          {locale === 'fa' ? 'در حال بارگذاری گزارش‌های تحلیل...' : 'Loading analysis reports...'}
        </div>
      ) : references.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
          {locale === 'fa'
            ? 'هنوز ویدئوی نمونه‌ای برای این پروژه تحلیل نشده است.'
            : 'No reference videos analyzed for this project yet.'}
        </div>
      ) : (
        <div className="space-y-8">
          {references.map((ref) => (
            <section
              key={ref.id}
              className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827]"
            >
              {/* Report Header */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2">
                    {['pending', 'extracting_frames', 'analyzing_ai'].includes(
                      ref.analysisStatus
                    ) ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    ) : ref.analysisStatus === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    )}
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {locale === 'fa'
                        ? `گزارش تحلیل نمونه #${ref.id}`
                        : `Reference Analysis #${ref.id}`}{' '}
                      · {statusLabel(ref.analysisStatus)}
                    </h3>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    <span>{platformLabel(ref.platform)}</span>
                    {ref.width && ref.height && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">
                          {ref.width}×{ref.height}
                        </span>
                      </>
                    )}
                    {ref.fps && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{ref.fps} fps</span>
                      </>
                    )}
                    {ref.durationMs && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">
                          {(ref.durationMs / 1000).toFixed(1)}s
                        </span>
                      </>
                    )}
                    {ref.scenes.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {ref.scenes.length}{' '}
                          {locale === 'fa' ? 'صحنه طراحی‌شده' : 'scenes'}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {(ref.mediaAssetId || ref.sourceType === 'brief_images') && (
                    <button
                      type="button"
                      onClick={() => handleReanalyze(ref.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>{locale === 'fa' ? 'تحلیل مجدد' : 'Re-analyze'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDeleteTargetId(ref.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{locale === 'fa' ? 'حذف' : 'Delete'}</span>
                  </button>
                </div>
              </div>

              {/* Access restriction or non-fatal note */}
              {(ref.accessStatus !== 'accessible' || ref.analysisError) && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  {ref.overallSummary?.detectedTitle && (
                    <p className="mb-1 font-semibold">
                      {ref.overallSummary.detectedTitle}
                    </p>
                  )}
                  <p>{ref.analysisError || ref.accessMessage}</p>
                </div>
              )}

              {/* Overall Style & Rhythm Summary */}
              {ref.analysisStatus === 'completed' && ref.overallSummary && (
                <div className="mt-5 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50 md:grid-cols-3">
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {locale === 'fa' ? 'ریتم و ضرب‌آهنگ' : 'Rhythm & Tempo'}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-900 dark:text-slate-100">
                      {ref.overallSummary.rhythm} · {ref.overallSummary.bpmEstimate}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {locale === 'fa' ? 'سبک بصری و تایپوگرافی' : 'Visual & Typography Style'}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-900 dark:text-slate-100">
                      {ref.overallSummary.visualStyle} · {ref.overallSummary.typographyStyle}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-500">
                      {locale === 'fa' ? 'هماهنگی تصویر و موسیقی' : 'Audio-Visual Sync'}
                    </p>
                    <p className="mt-1 text-xs font-medium text-slate-900 dark:text-slate-100">
                      {ref.overallSummary.audioVisualSync}
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[11px] font-medium text-slate-500">
                      {locale === 'fa' ? 'ساختار کلی ویدئو' : 'Overall Structure'}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                      {ref.overallSummary.structureOverview}
                    </p>
                  </div>
                  {Array.isArray(ref.overallSummary.palette) &&
                    ref.overallSummary.palette.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-slate-500">
                          {locale === 'fa' ? 'پالت رنگ استخراج‌شده' : 'Extracted Palette'}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {ref.overallSummary.palette.map((hex) => (
                            <div key={hex} className="flex items-center gap-1">
                              <span
                                className="inline-block h-4 w-4 rounded border border-slate-300 dark:border-slate-700"
                                style={{ backgroundColor: hex }}
                              />
                              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                                {hex}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}

              {/* Extracted Storyboard Scene Cards */}
              {ref.scenes.length > 0 && (
                <div className="mt-6">
                  <h4 className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {locale === 'fa'
                      ? 'استوری‌بورد و گزارش صحنه به صحنه'
                      : 'Extracted Scene-by-Scene Storyboard'}
                  </h4>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {ref.scenes.map((sc) => (
                      <article
                        key={sc.id}
                        className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/40"
                      >
                        <div className="relative flex h-44 items-center justify-center bg-slate-900">
                          {sc.frameStorageKey && frameUrls[sc.id] ? (
                            <img
                              src={frameUrls[sc.id]}
                              alt={`Scene ${sc.sceneNumber}`}
                              className="h-full w-full object-contain"
                            />
                          ) : !sc.frameStorageKey ? (
                            <div
                              className="flex h-full w-full flex-col items-center justify-center p-4 text-center"
                              style={{
                                background: `linear-gradient(135deg, ${
                                  sc.dominantColors[0] || '#0F172A'
                                } 0%, ${sc.dominantColors[1] || '#1E3A8A'} 100%)`,
                              }}
                            >
                              <p className="line-clamp-2 text-sm font-bold text-white drop-shadow-xs">
                                {sc.detectedText}
                              </p>
                              <span className="mt-1.5 font-mono text-[11px] text-white/80">
                                {sc.textAnimation}
                              </span>
                            </div>
                          ) : (
                            <Film className="h-6 w-6 text-slate-500" />
                          )}
                        </div>

                        <div className="space-y-2.5 p-4 text-xs">
                          <div className="flex items-center justify-between gap-2 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {locale === 'fa' ? `صحنه ${sc.sceneNumber}` : `Scene ${sc.sceneNumber}`}
                            </span>
                            <span>
                              {formatTimeMs(sc.startTimeMs)} – {formatTimeMs(sc.endTimeMs)} (
                              {(sc.durationMs / 1000).toFixed(1)}s)
                            </span>
                          </div>

                          <div className="space-y-1 text-slate-600 dark:text-slate-400">
                            <p>
                              <strong className="text-slate-800 dark:text-slate-200">
                                {locale === 'fa' ? 'متن: ' : 'Text: '}
                              </strong>
                              {sc.detectedText} ({sc.textAnimation})
                            </p>
                            <p>
                              <strong className="text-slate-800 dark:text-slate-200">
                                {locale === 'fa' ? 'حرکت دوربین: ' : 'Motion: '}
                              </strong>
                              {sc.cameraMotion}
                            </p>
                            <p>
                              <strong className="text-slate-800 dark:text-slate-200">
                                {locale === 'fa' ? 'ترنزیشن: ' : 'Transition: '}
                              </strong>
                              {sc.transitionType}
                            </p>
                            <p>
                              <strong className="text-slate-800 dark:text-slate-200">
                                {locale === 'fa' ? 'افکت‌ها: ' : 'Effects: '}
                              </strong>
                              {sc.visualEffects.join(' · ')}
                            </p>
                            <p>
                              <strong className="text-slate-800 dark:text-slate-200">
                                {locale === 'fa' ? 'تایپوگرافی: ' : 'Typography: '}
                              </strong>
                              {sc.typographyNotes}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            {sc.dominantColors.map((hex) => (
                              <span
                                key={hex}
                                title={hex}
                                className="inline-block h-4 w-4 rounded border border-slate-300 dark:border-slate-700"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>

                          <p className="border-t border-slate-200 pt-2.5 leading-relaxed text-slate-700 dark:border-slate-800 dark:text-slate-300">
                            {sc.aiDescription}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        title={locale === 'fa' ? 'حذف گزارش تحلیل ویدئو' : 'Delete Video Analysis'}
        description={
          locale === 'fa'
            ? 'آیا از حذف این گزارش تحلیل و فریم‌های استخراج‌شده آن اطمینان دارید؟ (فایل اصلی ویدئو در کتابخانه رسانه حفظ می‌شود)'
            : 'Delete this analysis report and extracted keyframes? (Original media file remains safe in Media Library)'
        }
        confirmLabel={locale === 'fa' ? 'بله، حذف شود' : 'Confirm Delete'}
        cancelLabel={locale === 'fa' ? 'انصراف' : 'Cancel'}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTargetId(null)}
        busy={deleting}
      />
    </div>
  );
}
