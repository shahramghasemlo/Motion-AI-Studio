import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  Film,
  Loader2,
  Play,
  RotateCw,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiFetch, fetchAuthenticatedBlobUrl } from '../lib/api.ts';
import { useStudioStore, type StudioProject } from '../store/useStudioStore.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

type RenderFormat = 'mp4' | 'webm' | 'gif' | 'png';
type RenderQuality = '720p' | '1080p' | '4k';

interface RenderJobItem {
  id: number;
  projectId: number;
  format: RenderFormat;
  quality: RenderQuality;
  fps: number;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  progressPercent: number;
  outputSizeBytes: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function computeTargetDimensions(
  baseW: number,
  baseH: number,
  quality: RenderQuality
): { width: number; height: number } {
  const safeW = Math.max(120, baseW || 1080);
  const safeH = Math.max(120, baseH || 1920);
  const shortTarget = quality === '4k' ? 2160 : quality === '720p' ? 720 : 1080;
  const roundEven = (v: number) => {
    const r = Math.max(64, Math.round(v));
    return r % 2 === 0 ? r : r + 1;
  };
  if (safeW <= safeH) {
    return {
      width: roundEven(shortTarget),
      height: roundEven(shortTarget * (safeH / safeW)),
    };
  }
  return {
    width: roundEven(shortTarget * (safeW / safeH)),
    height: roundEven(shortTarget),
  };
}

export function RenderExportView({
  project,
  sceneCount,
  onJumpToTab,
  onProjectUpdated,
}: {
  project: StudioProject;
  sceneCount: number;
  onJumpToTab: (tab: 'blueprint' | 'editor') => void;
  onProjectUpdated: () => Promise<void>;
}) {
  const { getToken } = useAuth();
  const locale = useStudioStore((s) => s.locale);
  const renderPulse = useStudioStore((s) => s.renderPulse);
  const user = useStudioStore((s) => s.user);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);
  const updateStorageUsage = useStudioStore((s) => s.updateStorageUsage);

  const [format, setFormat] = useState<RenderFormat>('mp4');
  const [quality, setQuality] = useState<RenderQuality>(
    (['720p', '1080p', '4k'].includes(project.outputQuality)
      ? project.outputQuality
      : '1080p') as RenderQuality
  );
  const [fps, setFps] = useState<number>(30);

  const [jobs, setJobs] = useState<RenderJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RenderJobItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [previewJob, setPreviewJob] = useState<RenderJobItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  const targetResolution = useMemo(
    () => computeTargetDimensions(project.customWidth, project.customHeight, quality),
    [project.customWidth, project.customHeight, quality]
  );

  const hasActiveJob = useMemo(
    () => jobs.some((j) => j.status === 'queued' || j.status === 'processing'),
    [jobs]
  );

  const loadJobs = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await apiFetch<{
        jobs: RenderJobItem[];
        storage?: { usedBytes: number; quotaBytes: number };
      }>(`/api/projects/${project.id}/renders`, {}, token);
      setJobs(data.jobs);
      if (data.storage) {
        updateStorageUsage(data.storage.usedBytes, data.storage.quotaBytes);
      }
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'خطا در دریافت لیست رندرها'
      );
    } finally {
      setLoading(false);
    }
  }, [project.id, getToken, setErrorBanner, updateStorageUsage]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs, renderPulse]);

  // Fallback polling while a job is actively rendering on the server
  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = setInterval(() => {
      void loadJobs();
    }, 1800);
    return () => clearInterval(timer);
  }, [hasActiveJob, loadJobs]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const handleStartRender = async () => {
    setSubmitting(true);
    setErrorBanner(null);
    try {
      const token = await getToken();
      await apiFetch<{ job: RenderJobItem }>(
        `/api/projects/${project.id}/renders`,
        {
          method: 'POST',
          body: JSON.stringify({ format, quality, fps }),
        },
        token
      );
      await Promise.all([loadJobs(), onProjectUpdated()]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در شروع رندر');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelJob = async (jobId: number) => {
    try {
      const token = await getToken();
      await apiFetch(`/api/renders/${jobId}/cancel`, { method: 'POST' }, token);
      await Promise.all([loadJobs(), onProjectUpdated()]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در لغو رندر');
    }
  };

  const handleRetryJob = async (jobId: number) => {
    try {
      const token = await getToken();
      await apiFetch(`/api/renders/${jobId}/retry`, { method: 'POST' }, token);
      await Promise.all([loadJobs(), onProjectUpdated()]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در اجرای مجدد');
    }
  };

  const handleDownloadJob = async (job: RenderJobItem) => {
    setDownloadingId(job.id);
    setErrorBanner(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('نشست کاربری معتبر نیست.');
      const blobUrl = await fetchAuthenticatedBlobUrl(
        `/api/renders/${job.id}/download`,
        token
      );
      const ext = job.format === 'png' ? 'zip' : job.format;
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `motion-studio-project-${project.id}-render-${job.id}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در دانلود فایل خروجی');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleOpenPreview = async (job: RenderJobItem) => {
    if (job.format === 'png') return;
    setPreviewJob(job);
    setLoadingPreview(true);
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl(null);
    }
    try {
      const token = await getToken();
      if (!token) throw new Error('نشست کاربری معتبر نیست.');
      const url = await fetchAuthenticatedBlobUrl(`/api/renders/${job.id}/download`, token);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در بارگذاری پیش‌نمایش');
      setPreviewJob(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleClosePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setPreviewJob(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = await getToken();
      const res = await apiFetch<{
        deletedId: number;
        storage?: { usedBytes: number; quotaBytes: number };
      }>(`/api/renders/${deleteTarget.id}?confirm=true`, { method: 'DELETE' }, token);

      if (res.storage) {
        updateStorageUsage(res.storage.usedBytes, res.storage.quotaBytes);
      }
      if (previewJob?.id === deleteTarget.id) {
        handleClosePreview();
      }
      setDeleteTarget(null);
      await Promise.all([loadJobs(), onProjectUpdated()]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در حذف خروجی');
    } finally {
      setDeleting(false);
    }
  };

  const usedBytes = user?.storageUsedBytes ?? 0;
  const quotaBytes = user?.storageQuotaBytes ?? 524288000;
  const storagePct = Math.min(100, Math.round((usedBytes / Math.max(1, quotaBytes)) * 100));

  const formatOptions: Array<{
    id: RenderFormat;
    label: string;
    descFa: string;
    descEn: string;
  }> = [
    {
      id: 'mp4',
      label: 'MP4 (H.264)',
      descFa: 'استاندارد شبکه‌های اجتماعی + صدا',
      descEn: 'Social & commercial standard + audio',
    },
    {
      id: 'webm',
      label: 'WebM (VP9)',
      descFa: 'حجم بهینه برای وب + صدا',
      descEn: 'Web-optimized VP9 + Opus audio',
    },
    {
      id: 'gif',
      label: 'GIF',
      descFa: 'انیمیشن بدون صدا با پالت بهینه',
      descEn: 'Looping animated GIF palette',
    },
    {
      id: 'png',
      label: 'PNG Frames (ZIP)',
      descFa: 'توالی فریم‌های PNG باکیفیت',
      descEn: 'High-res PNG frame sequence ZIP',
    },
  ];

  const statusLabel = (status: RenderJobItem['status']) => {
    if (locale === 'fa') {
      if (status === 'queued') return 'در صف انتظار';
      if (status === 'processing') return 'در حال رندر';
      if (status === 'completed') return 'آماده دانلود';
      if (status === 'failed') return 'ناموفق';
      return 'لغوشده';
    }
    if (status === 'queued') return 'Queued';
    if (status === 'processing') return 'Rendering';
    if (status === 'completed') return 'Completed';
    if (status === 'failed') return 'Failed';
    return 'Cancelled';
  };

  return (
    <div className="space-y-6">
      {/* Header & Pre-render Check */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827]">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {locale === 'fa'
              ? 'رندر نهایی سرور و خروجی ویدئو'
              : 'Server-Side FFmpeg Render & Export'}
          </h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {locale === 'fa'
              ? 'تبدیل تایم‌لاین تدوین‌شده، تایپوگرافی متحرک و لایه‌های صوتی به فایل استاندارد قابل انتشار با موتور FFmpeg.'
              : 'Encode your edited timeline, kinetic typography, media layers, and mixed audio via FFmpeg.'}
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          <span className="font-mono">
            {targetResolution.width}×{targetResolution.height} px
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{project.durationSeconds}s</span>
          <span aria-hidden="true">·</span>
          <span>
            {sceneCount} {locale === 'fa' ? 'صحنه' : 'scenes'}
          </span>
        </div>
      </div>

      {sceneCount === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {locale === 'fa'
                ? 'هنوز صحنه‌ای در سناریو یا تایم‌لاین ثبت نشده است. برای خروجی بهتر ابتدا صحنه‌ها را تولید یا تدوین کنید.'
                : 'No scenes generated yet. Build scenes or edit the timeline before rendering for best results.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onJumpToTab('blueprint')}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200"
            >
              {locale === 'fa' ? 'ساخت سناریو' : 'Go to Blueprint'}
            </button>
            <button
              type="button"
              onClick={() => onJumpToTab('editor')}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200"
            >
              {locale === 'fa' ? 'تایم‌لاین' : 'Timeline'}
            </button>
          </div>
        </div>
      )}

      {/* Split Layout: Render Config + Export Queue */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Render Config Column */}
        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827] lg:col-span-5">
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-400">
              {locale === 'fa' ? 'فرمت خروجی' : 'Output Format'}
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {formatOptions.map((opt) => {
                const active = format === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFormat(opt.id)}
                    className={`rounded-lg border p-3 text-start transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-50/70 text-slate-900 dark:border-blue-500 dark:bg-blue-950/30 dark:text-slate-100'
                        : 'border-slate-200 bg-slate-50/60 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    <p className="font-mono text-xs font-semibold">{opt.label}</p>
                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {locale === 'fa' ? opt.descFa : opt.descEn}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {locale === 'fa' ? 'رزولوشن و کیفیت' : 'Quality'}
              </label>
              <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
                {(['720p', '1080p', '4k'] as RenderQuality[]).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuality(q)}
                    className={`flex-1 rounded-md py-1.5 font-mono text-xs font-medium transition-colors uppercase ${
                      quality === q
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                {locale === 'fa' ? 'نرخ فریم (FPS)' : 'Frame Rate'}
              </label>
              <div className="flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
                {[24, 30, 60].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setFps(rate)}
                    className={`flex-1 rounded-md py-1.5 font-mono text-xs font-medium transition-colors tabular-nums ${
                      fps === rate
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {rate}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>{locale === 'fa' ? 'سهمیه فضای ذخیره‌سازی' : 'Storage Quota'}</span>
              <span className="font-mono tabular-nums">
                {formatBytes(usedBytes)} / {formatBytes(quotaBytes)} ({storagePct}%)
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full transition-all ${
                  storagePct >= 90 ? 'bg-red-600' : 'bg-blue-600'
                }`}
                style={{ width: `${storagePct}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={handleStartRender}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            <span>
              {submitting
                ? locale === 'fa'
                  ? 'در حال ارسال به صف رندر...'
                  : 'Queueing Render...'
                : locale === 'fa'
                ? 'شروع رندر نهایی سرور'
                : 'Start Server Render'}
            </span>
          </button>
        </section>

        {/* Render Jobs Queue & Outputs Column */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827] lg:col-span-7">
          <div className="mb-4 flex items-center justify-between gap-4 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Film className="h-4 w-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {locale === 'fa' ? 'صف رندر و فایل‌های خروجی' : 'Render Queue & Exports'}
              </h3>
            </div>
            <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {jobs.length} {locale === 'fa' ? 'مورد' : 'jobs'}
            </span>
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
              {locale === 'fa' ? 'در حال دریافت وضعیت رندرها...' : 'Loading render jobs...'}
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {locale === 'fa'
                  ? 'هنوز رندری برای این پروژه ثبت نشده است. تنظیمات دلخواه را انتخاب و رندر را شروع کنید.'
                  : 'No renders yet for this project. Choose your format and start a server render.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {jobs.map((job) => {
                const isActive = job.status === 'queued' || job.status === 'processing';
                const isDone = job.status === 'completed';
                const isFailed = job.status === 'failed' || job.status === 'cancelled';

                return (
                  <div key={job.id} className="space-y-3 py-4 first:pt-1 last:pb-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                            #{job.id}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono uppercase text-slate-800 dark:text-slate-200">
                            {job.format}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-600 dark:text-slate-300">
                            {job.quality}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                            {job.fps} fps
                          </span>
                          {job.outputSizeBytes && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                                {formatBytes(job.outputSizeBytes)}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="mt-1 flex items-center gap-1.5 text-xs">
                          {isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
                          {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
                          {isFailed && <XCircle className="h-3.5 w-3.5 text-red-600" />}
                          <span
                            className={
                              isDone
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : isFailed
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-blue-700 dark:text-blue-400'
                            }
                          >
                            {statusLabel(job.status)}
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {new Date(job.createdAt).toLocaleString(
                              locale === 'fa' ? 'fa-IR' : 'en-US'
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {isActive && (
                          <button
                            type="button"
                            onClick={() => handleCancelJob(job.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40 whitespace-nowrap"
                          >
                            <X className="h-3.5 w-3.5" />
                            <span>{locale === 'fa' ? 'لغو' : 'Cancel'}</span>
                          </button>
                        )}

                        {isDone && job.format !== 'png' && (
                          <button
                            type="button"
                            onClick={() => handleOpenPreview(job)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>{locale === 'fa' ? 'نمایش' : 'Preview'}</span>
                          </button>
                        )}

                        {isDone && (
                          <button
                            type="button"
                            disabled={downloadingId === job.id}
                            onClick={() => handleDownloadJob(job)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>
                              {downloadingId === job.id
                                ? locale === 'fa'
                                  ? 'در حال دریافت...'
                                  : 'Downloading...'
                                : locale === 'fa'
                                ? 'دانلود خروجی'
                                : 'Download'}
                            </span>
                          </button>
                        )}

                        {isFailed && (
                          <button
                            type="button"
                            onClick={() => handleRetryJob(job.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                            <span>{locale === 'fa' ? 'تلاش مجدد' : 'Retry'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setDeleteTarget(job)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-red-600 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                          aria-label={locale === 'fa' ? 'حذف خروجی' : 'Delete export'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {isActive && (
                      <div className="space-y-1">
                        <div className="flex justify-between font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          <span>
                            {locale === 'fa' ? 'پیشرفت رندر FFmpeg' : 'FFmpeg Encoding Progress'}
                          </span>
                          <span>{job.progressPercent}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full bg-blue-600 transition-all duration-300"
                            style={{ width: `${Math.max(3, job.progressPercent)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {job.errorMessage && isFailed && (
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
                        {job.errorMessage}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Inline Video / GIF Authenticated Preview Modal */}
      {previewJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                Render #{previewJob.id} · {previewJob.format.toUpperCase()} · {previewJob.quality}
              </span>
              <button
                type="button"
                onClick={handleClosePreview}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {loadingPreview || !previewUrl ? (
              <div className="flex h-64 items-center justify-center text-xs text-slate-500">
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                <span>{locale === 'fa' ? 'در حال بارگذاری پیش‌نمایش...' : 'Loading preview...'}</span>
              </div>
            ) : previewJob.format === 'gif' ? (
              <img
                src={previewUrl}
                alt={`Render ${previewJob.id}`}
                className="mx-auto max-h-[65vh] rounded-lg border border-slate-200 dark:border-slate-800"
              />
            ) : (
              <video
                src={previewUrl}
                controls
                autoPlay
                className="mx-auto max-h-[65vh] w-full rounded-lg border border-slate-200 bg-black dark:border-slate-800"
              />
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={locale === 'fa' ? 'تأیید حذف خروجی رندر' : 'Confirm Delete Render Output'}
        description={
          locale === 'fa'
            ? 'فایل رندرشده از فضای ذخیره‌سازی حذف شده و حجم آن به سهمیه شما بازگردانده می‌شود.'
            : 'This rendered export file will be permanently deleted and its storage reclaimed.'
        }
        confirmLabel={locale === 'fa' ? 'بله، حذف شود' : 'Delete Export'}
        cancelLabel={locale === 'fa' ? 'انصراف' : 'Cancel'}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        busy={deleting}
      />
    </div>
  );
}
