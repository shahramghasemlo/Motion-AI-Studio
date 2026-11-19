import {
  Activity,
  ArrowUpLeft,
  ArrowUpRight,
  Download,
  Film,
  FolderKanban,
  HardDrive,
  Play,
  Plus,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { translations } from '../i18n/translations.ts';
import { fetchAuthenticatedBlobUrl } from '../lib/api.ts';
import { useStudioStore, type StudioRenderOutput } from '../store/useStudioStore.ts';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function DashboardView() {
  const { getToken } = useAuth();
  const locale = useStudioStore((s) => s.locale);
  const user = useStudioStore((s) => s.user);
  const summary = useStudioStore((s) => s.summary);
  const projects = useStudioStore((s) => s.projects);
  const renderOutputs = useStudioStore((s) => s.renderOutputs);
  const templates = useStudioStore((s) => s.templates);
  const activityLogs = useStudioStore((s) => s.activityLogs);
  const openWizard = useStudioStore((s) => s.openWizard);
  const openProjectInWorkspace = useStudioStore((s) => s.openProjectInWorkspace);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const handleDownloadOutput = async (out: StudioRenderOutput) => {
    setDownloadingId(out.id);
    try {
      const token = await getToken();
      if (!token) throw new Error('نشست کاربری معتبر نیست.');
      const url = await fetchAuthenticatedBlobUrl(`/api/renders/${out.id}/download`, token);
      const ext = out.format === 'png' ? 'zip' : out.format;
      const a = document.createElement('a');
      a.href = url;
      a.download = `motion-studio-render-${out.id}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در دانلود فایل خروجی');
    } finally {
      setDownloadingId(null);
    }
  };

  const t = translations[locale];
  const latestProject = summary?.latestProject ?? projects[0] ?? null;
  const usedBytes = user?.storageUsedBytes ?? 0;
  const quotaBytes = user?.storageQuotaBytes ?? 524288000;
  const usagePercent = Math.min(100, Math.round((usedBytes / Math.max(1, quotaBytes)) * 100));

  return (
    <div className="space-y-8">
      {/* Studio Hero Action Header */}
      <section className="flex flex-wrap items-center justify-between gap-6 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827]">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 text-balance">
            {t.brand}
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            {t.tagline}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {latestProject && (
            <button
              type="button"
              onClick={() => openProjectInWorkspace(latestProject.id)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Play className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>{t.continueLatestProject}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => openWizard(null)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>{t.primaryCtaNewVideo}</span>
          </button>
        </div>
      </section>

      {/* 4-Column Studio KPI Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">{t.metricProjectsCount}</span>
            <FolderKanban className="h-4 w-4" />
          </div>
          <p className="mt-3 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {summary?.projectCount ?? projects.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {latestProject ? latestProject.title : t.noProjects}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">{t.metricStorageUsed}</span>
            <HardDrive className="h-4 w-4" />
          </div>
          <p className="mt-3 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {formatBytes(usedBytes)}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full bg-blue-600" style={{ width: `${usagePercent}%` }} />
          </div>
          <p className="mt-1.5 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {usagePercent}% · {formatBytes(quotaBytes)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">{t.metricProcessingStatus}</span>
            <Activity className="h-4 w-4" />
          </div>
          <p className="mt-3 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {summary?.activeProcessingCount ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {(summary?.activeProcessingCount ?? 0) > 0
              ? `${summary?.activeProcessingCount} ${t.activeJobsSuffix}`
              : t.idleProcessing}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">{t.metricOutputsCount}</span>
            <Film className="h-4 w-4" />
          </div>
          <p className="mt-3 font-mono text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {summary?.completedOutputsCount ?? 0}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {summary?.mediaCount ?? 0} {locale === 'fa' ? 'فایل در کتابخانه' : 'media files'}
          </p>
        </div>
      </section>

      {/* Recent & Saved Projects + Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827] lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.recentProjectsTitle}
            </h2>
            <button
              type="button"
              onClick={() => setActiveTab('projects')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              <span>{t.viewAllProjects}</span>
              {locale === 'fa' ? (
                <ArrowUpLeft className="h-3.5 w-3.5" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center dark:border-slate-800">
              <p className="text-sm text-slate-500 dark:text-slate-400">{t.noProjects}</p>
              <button
                type="button"
                onClick={() => openWizard(null)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t.primaryCtaNewVideo}</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {projects.slice(0, 6).map((project) => (
                <div
                  key={project.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => openProjectInWorkspace(project.id)}
                      className="truncate text-start text-sm font-semibold text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
                    >
                      {project.title}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{project.businessName || project.topic || '—'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{project.aspectRatio}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{project.durationSeconds}s</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{project.outputQuality}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">v{project.currentVersion}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openProjectInWorkspace(project.id)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    {t.openProject}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Activity */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
          <h2 className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t.recentActivity}
          </h2>
          {activityLogs.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t.noActivity}</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {activityLogs.slice(0, 7).map((log) => (
                <div key={log.id} className="py-2.5">
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    {log.summary}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums">
                    {new Date(log.createdAt).toLocaleString(
                      locale === 'fa' ? 'fa-IR' : 'en-US'
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Starter Templates Strip */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
        <h2 className="mb-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t.templatesPreviewTitle}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50"
            >
              <div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {locale === 'fa' ? tpl.categoryFa : tpl.categoryEn} · {tpl.aspectRatio} ·{' '}
                  {tpl.durationSeconds}s
                </div>
                <h3 className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {locale === 'fa' ? tpl.titleFa : tpl.titleEn}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  {locale === 'fa' ? tpl.descriptionFa : tpl.descriptionEn}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openWizard(tpl.id)}
                className="mt-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                {t.useTemplate}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Rendered Outputs Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
        <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t.outputsTitle}
        </h2>
        {renderOutputs.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t.noOutputsYet}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2 text-start font-medium">ID</th>
                  <th className="py-2 text-start font-medium">Format</th>
                  <th className="py-2 text-start font-medium">Quality</th>
                  <th className="py-2 text-start font-medium">FPS</th>
                  <th className="py-2 text-start font-medium">Size</th>
                  <th className="py-2 text-start font-medium">Status</th>
                  <th className="py-2 text-end font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {renderOutputs.map((out) => (
                  <tr key={out.id}>
                    <td className="py-2 font-mono text-xs tabular-nums">#{out.id}</td>
                    <td className="py-2 font-mono text-xs uppercase">{out.format}</td>
                    <td className="py-2 font-mono text-xs">{out.quality}</td>
                    <td className="py-2 font-mono text-xs tabular-nums">{out.fps}</td>
                    <td className="py-2 font-mono text-xs tabular-nums">
                      {out.outputSizeBytes ? formatBytes(out.outputSizeBytes) : '—'}
                    </td>
                    <td className="py-2 text-xs tabular-nums">
                      {out.status}
                      {(out.status === 'processing' || out.status === 'queued') &&
                        ` (${out.progressPercent}%)`}
                    </td>
                    <td className="py-2 text-end">
                      {out.status === 'completed' ? (
                        <button
                          type="button"
                          disabled={downloadingId === out.id}
                          onClick={() => handleDownloadOutput(out)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-slate-50 dark:border-slate-700 dark:text-blue-400 dark:hover:bg-slate-800"
                        >
                          <Download className="h-3 w-3" />
                          <span>{locale === 'fa' ? 'دانلود' : 'Download'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openProjectInWorkspace(out.projectId)}
                          className="text-xs font-medium text-slate-600 hover:underline dark:text-slate-400"
                        >
                          {t.openProject}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
