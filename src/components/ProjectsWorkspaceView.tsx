import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  History,
  Layers,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { translations } from '../i18n/translations.ts';
import { apiFetch } from '../lib/api.ts';
import { useStudioStore, type StudioProject } from '../store/useStudioStore.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { ReferenceAnalyzerView } from './ReferenceAnalyzerView.tsx';
import { RenderExportView } from './RenderExportView.tsx';
import { ScenarioBlueprintView } from './ScenarioBlueprintView.tsx';
import { TimelineEditorView } from './TimelineEditorView.tsx';

interface ProjectVersionItem {
  id: number;
  versionNumber: number;
  label: string;
  createdAt: string;
}

interface ProjectSceneItem {
  id: number;
  orderIndex: number;
  title: string;
  durationMs: number;
  textContent: string;
  animationPreset: string;
  transitionType: string;
  locked: boolean;
}

interface ProjectsWorkspaceViewProps {
  onRefreshAll: () => Promise<void>;
}

export function ProjectsWorkspaceView({ onRefreshAll }: ProjectsWorkspaceViewProps) {
  const { getToken } = useAuth();
  const locale = useStudioStore((s) => s.locale);
  const projects = useStudioStore((s) => s.projects);
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useStudioStore((s) => s.setSelectedProjectId);
  const openWizard = useStudioStore((s) => s.openWizard);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);
  const t = translations[locale];

  const [search, setSearch] = useState('');
  const [aspectFilter, setAspectFilter] = useState('all');
  const [deleteTarget, setDeleteTarget] = useState<StudioProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Project Detail State
  const [detailProject, setDetailProject] = useState<StudioProject | null>(null);
  const [versions, setVersions] = useState<ProjectVersionItem[]>([]);
  const [scenes, setScenes] = useState<ProjectSceneItem[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [projectSubTab, setProjectSubTab] = useState<'specs' | 'reference' | 'blueprint' | 'editor' | 'export'>('specs');

  // Editable detail fields
  const [editTitle, setEditTitle] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [editBusiness, setEditBusiness] = useState('');
  const [editProductType, setEditProductType] = useState('');
  const [editAudience, setEditAudience] = useState('');
  const [editAspect, setEditAspect] = useState('9:16');
  const [editDuration, setEditDuration] = useState(15);
  const [editQuality, setEditQuality] = useState('1080p');

  const loadProjectDetail = async (projectId: number) => {
    setLoadingDetail(true);
    try {
      const token = await getToken();
      const data = await apiFetch<{
        project: StudioProject;
        versions: ProjectVersionItem[];
        scenes: ProjectSceneItem[];
      }>(`/api/projects/${projectId}`, {}, token);
      setDetailProject(data.project);
      setVersions(data.versions);
      setScenes(data.scenes);
      setEditTitle(data.project.title);
      setEditTopic(data.project.topic);
      setEditBusiness(data.project.businessName);
      setEditProductType(data.project.productType);
      setEditAudience(data.project.targetAudience);
      setEditAspect(data.project.aspectRatio);
      setEditDuration(data.project.durationSeconds);
      setEditQuality(data.project.outputQuality);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در بارگذاری پروژه');
      setSelectedProjectId(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    setProjectSubTab('specs');
    if (selectedProjectId) {
      void loadProjectDetail(selectedProjectId);
    } else {
      setDetailProject(null);
    }
  }, [selectedProjectId]);

  const handleSaveProjectEdits = async (e: FormEvent) => {
    e.preventDefault();
    if (!detailProject) return;
    setSavingDetail(true);
    try {
      const token = await getToken();
      await apiFetch(
        `/api/projects/${detailProject.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            title: editTitle,
            topic: editTopic,
            businessName: editBusiness,
            productType: editProductType,
            targetAudience: editAudience,
            aspectRatio: editAspect,
            durationSeconds: editDuration,
            outputQuality: editQuality,
          }),
        },
        token
      );
      await Promise.all([loadProjectDetail(detailProject.id), onRefreshAll()]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در ذخیره تغییرات');
    } finally {
      setSavingDetail(false);
    }
  };

  const handleSaveVersion = async (projectId: number) => {
    try {
      const token = await getToken();
      await apiFetch(
        `/api/projects/${projectId}/versions`,
        {
          method: 'POST',
          body: JSON.stringify({
            label: locale === 'fa' ? 'ذخیره دستی نسخه' : 'Manual Snapshot',
          }),
        },
        token
      );
      await Promise.all([
        selectedProjectId === projectId ? loadProjectDetail(projectId) : Promise.resolve(),
        onRefreshAll(),
      ]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در ثبت نسخه');
    }
  };

  const handleRestoreVersion = async (projectId: number, versionId: number) => {
    try {
      const token = await getToken();
      await apiFetch(
        `/api/projects/${projectId}/versions/${versionId}/restore`,
        { method: 'POST' },
        token
      );
      await Promise.all([loadProjectDetail(projectId), onRefreshAll()]);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در بازیابی نسخه');
    }
  };

  const handleDuplicate = async (projectId: number) => {
    try {
      const token = await getToken();
      await apiFetch(`/api/projects/${projectId}/duplicate`, { method: 'POST' }, token);
      await onRefreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در تکثیر پروژه');
    }
  };

  const handleExport = async (project: StudioProject) => {
    try {
      const token = await getToken();
      const bundle = await apiFetch<Record<string, unknown>>(
        `/api/projects/${project.id}/export`,
        {},
        token
      );
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `motion-studio-project-${project.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در خروجی JSON');
    }
  };

  const handleImportJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const token = await getToken();
      await apiFetch(
        '/api/projects/import',
        { method: 'POST', body: JSON.stringify(parsed) },
        token
      );
      await onRefreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'فایل JSON پروژه معتبر نیست.');
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = await getToken();
      await apiFetch(
        `/api/projects/${deleteTarget.id}?confirm=true`,
        { method: 'DELETE' },
        token
      );
      if (selectedProjectId === deleteTarget.id) {
        setSelectedProjectId(null);
      }
      setDeleteTarget(null);
      await onRefreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در حذف پروژه');
    } finally {
      setDeleting(false);
    }
  };

  const filteredProjects = projects.filter((p) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.businessName.toLowerCase().includes(q) ||
      p.topic.toLowerCase().includes(q);
    const matchesAspect = aspectFilter === 'all' || p.aspectRatio === aspectFilter;
    return matchesSearch && matchesAspect;
  });

  if (selectedProjectId) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setSelectedProjectId(null)}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            {locale === 'fa' ? (
              <ArrowRight className="h-4 w-4" />
            ) : (
              <ArrowLeft className="h-4 w-4" />
            )}
            <span>{t.viewAllProjects}</span>
          </button>

          {detailProject && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleSaveVersion(detailProject.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{t.saveVersion}</span>
              </button>
              <button
                type="button"
                onClick={() => handleExport(detailProject)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{t.exportJson}</span>
              </button>
            </div>
          )}
        </div>

        {loadingDetail || !detailProject ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827]">
            {locale === 'fa' ? 'در حال بارگذاری جزئیات پروژه...' : 'Loading project details...'}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit dark:bg-slate-800/80">
              <button
                type="button"
                onClick={() => setProjectSubTab('specs')}
                className={`rounded-md px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  projectSubTab === 'specs'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {locale === 'fa' ? 'مشخصات و نسخه‌ها' : 'Specs & Versions'}
              </button>
              <button
                type="button"
                onClick={() => setProjectSubTab('reference')}
                className={`rounded-md px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  projectSubTab === 'reference'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {locale === 'fa'
                  ? 'تحلیل نمونه / ایده و عکس'
                  : 'Reference & Storyboard'}
              </button>
              <button
                type="button"
                onClick={() => setProjectSubTab('blueprint')}
                className={`rounded-md px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  projectSubTab === 'blueprint'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {locale === 'fa'
                  ? 'الگوبرداری، سناریو و صحنه‌ها'
                  : 'Style Adaptation & Scenes'}
              </button>
              <button
                type="button"
                onClick={() => setProjectSubTab('editor')}
                className={`rounded-md px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  projectSubTab === 'editor'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {locale === 'fa'
                  ? 'تدوین و تایم‌لاین زنده'
                  : 'Timeline & Live Preview'}
              </button>
              <button
                type="button"
                onClick={() => setProjectSubTab('export')}
                className={`rounded-md px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  projectSubTab === 'export'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {locale === 'fa'
                  ? 'خروجی و رندر نهایی'
                  : 'Render & Export'}
              </button>
            </div>

            {projectSubTab === 'reference' ? (
              <ReferenceAnalyzerView projectId={detailProject.id} />
            ) : projectSubTab === 'blueprint' ? (
              <ScenarioBlueprintView
                projectId={detailProject.id}
                onProjectUpdated={async () => {
                  await Promise.all([loadProjectDetail(detailProject.id), onRefreshAll()]);
                }}
              />
            ) : projectSubTab === 'editor' ? (
              <TimelineEditorView
                project={detailProject}
                onProjectUpdated={async () => {
                  await Promise.all([loadProjectDetail(detailProject.id), onRefreshAll()]);
                }}
              />
            ) : projectSubTab === 'export' ? (
              <RenderExportView
                project={detailProject}
                sceneCount={scenes.length}
                onJumpToTab={(tab) => setProjectSubTab(tab)}
                onProjectUpdated={async () => {
                  await Promise.all([loadProjectDetail(detailProject.id), onRefreshAll()]);
                }}
              />
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <form
                  onSubmit={handleSaveProjectEdits}
                  className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-[#111827] lg:col-span-2"
                >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {detailProject.title}
                </h2>
                <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {detailProject.customWidth}×{detailProject.customHeight} · v
                  {detailProject.currentVersion}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {t.projectTitle}
                  </label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {t.businessName}
                  </label>
                  <input
                    type="text"
                    value={editBusiness}
                    onChange={(e) => setEditBusiness(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {t.projectTopic}
                  </label>
                  <input
                    type="text"
                    value={editTopic}
                    onChange={(e) => setEditTopic(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {t.productType}
                  </label>
                  <input
                    type="text"
                    value={editProductType}
                    onChange={(e) => setEditProductType(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {t.targetAudience}
                  </label>
                  <input
                    type="text"
                    value={editAudience}
                    onChange={(e) => setEditAudience(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                    {t.aspectRatio}
                  </label>
                  <select
                    value={editAspect}
                    onChange={(e) => setEditAspect(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <option value="9:16">9:16 (Reels / Shorts)</option>
                    <option value="16:9">16:9 (YouTube)</option>
                    <option value="1:1">1:1 (Square)</option>
                    <option value="4:5">4:5 (Vertical)</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      {t.durationSeconds}
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={editDuration}
                      onChange={(e) => setEditDuration(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                      {t.outputQuality}
                    </label>
                    <select
                      value={editQuality}
                      onChange={(e) => setEditQuality(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                      <option value="4k">4K</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingDetail}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingDetail ? t.saving : t.saveChanges}
                </button>
              </div>
            </form>

            {/* Versions & Seeded Scenes */}
            <div className="space-y-6">
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <History className="h-4 w-4 text-slate-500" />
                  <span>{t.versionsHistory}</span>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {versions.map((ver) => (
                    <div
                      key={ver.id}
                      className="flex items-center justify-between gap-3 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800 dark:text-slate-200">
                          v{ver.versionNumber} · {ver.label}
                        </p>
                        <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {new Date(ver.createdAt).toLocaleString(
                            locale === 'fa' ? 'fa-IR' : 'en-US'
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRestoreVersion(detailProject.id, ver.id)}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>{t.restoreVersion}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <Layers className="h-4 w-4 text-slate-500" />
                  <span>{t.scenesOverview}</span>
                </div>
                {scenes.length === 0 ? (
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {t.noScenesYet}
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {scenes.map((sc) => (
                      <div key={sc.id} className="py-2.5 text-xs">
                        <div className="flex items-center justify-between font-medium text-slate-800 dark:text-slate-200">
                          <span>
                            {sc.orderIndex + 1}. {sc.title}
                          </span>
                          <span className="font-mono text-slate-400 tabular-nums">
                            {(sc.durationMs / 1000).toFixed(1)}s
                          </span>
                        </div>
                        <p className="mt-1 text-slate-500 dark:text-slate-400">
                          {sc.textContent}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t.navProjects}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {locale === 'fa'
              ? 'مدیریت پروژه‌های ذخیره‌شده، ویرایش مشخصات، نسخه‌بندی و خروجی/ورودی ساختار کامل.'
              : 'Manage saved projects, edit specifications, save snapshots, and export/import bundles.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap">
            <Upload className="h-3.5 w-3.5" />
            <span>{t.importJson}</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleImportJson}
              className="hidden"
            />
          </label>
          <button
            type="button"
            onClick={() => openWizard(null)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t.primaryCtaNewVideo}</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchProjects}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pe-3 ps-9 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-[#111827]"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
          {['all', '9:16', '16:9', '1:1', '4:5'].map((ratio) => (
            <button
              key={ratio}
              type="button"
              onClick={() => setAspectFilter(ratio)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                aspectFilter === ratio
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {ratio === 'all' ? t.allAspects : ratio}
            </button>
          ))}
        </div>
      </div>

      {/* Projects List */}
      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        {filteredProjects.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {t.noProjects}
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    className="truncate text-start text-base font-semibold text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
                  >
                    {project.title}
                  </button>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {project.businessName && (
                      <>
                        <span>{project.businessName}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span className="font-mono">{project.aspectRatio}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{project.durationSeconds}s</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{project.outputQuality}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">v{project.currentVersion}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap"
                  >
                    {t.openProject}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(project.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>{t.duplicate}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport(project)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>{t.exportJson}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(project)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40 whitespace-nowrap"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{t.delete}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t.confirmDeleteTitle}
        description={t.confirmDeleteProjectDesc}
        confirmLabel={t.confirmDeleteAction}
        cancelLabel={t.cancel}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        busy={deleting}
      />
    </div>
  );
}
