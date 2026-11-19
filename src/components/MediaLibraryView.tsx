import {
  Eye,
  FileAudio,
  FileCheck,
  FileImage,
  FileVideo,
  Pencil,
  Search,
  Trash2,
  Type,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { translations } from '../i18n/translations.ts';
import { apiFetch, fetchAuthenticatedBlobUrl } from '../lib/api.ts';
import { useStudioStore, type StudioMediaAsset } from '../store/useStudioStore.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface MediaLibraryViewProps {
  onRefreshAll: () => Promise<void>;
}

const MEDIA_CATEGORIES = [
  { id: 'all', fa: 'همه فایل‌ها', en: 'All' },
  { id: 'image', fa: 'عکس', en: 'Image' },
  { id: 'video', fa: 'ویدئو', en: 'Video' },
  { id: 'logo', fa: 'لوگو', en: 'Logo' },
  { id: 'audio', fa: 'فایل صوتی', en: 'Audio' },
  { id: 'music', fa: 'موسیقی', en: 'Music' },
  { id: 'font', fa: 'فونت', en: 'Font' },
  { id: 'background', fa: 'پس‌زمینه', en: 'Background' },
  { id: 'graphic', fa: 'گرافیک', en: 'Graphic' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function extractMediaMetadata(
  file: File
): Promise<{ width?: number; height?: number; durationMs?: number }> {
  if (file.type.startsWith('image/') && !file.type.includes('svg')) {
    return await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      img.src = url;
    });
  }

  if (file.type.startsWith('video/')) {
    return await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const vid = document.createElement('video');
      vid.preload = 'metadata';
      vid.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({
          width: vid.videoWidth || undefined,
          height: vid.videoHeight || undefined,
          durationMs: Number.isFinite(vid.duration)
            ? Math.round(vid.duration * 1000)
            : undefined,
        });
      };
      vid.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      vid.src = url;
    });
  }

  if (file.type.startsWith('audio/')) {
    return await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const aud = document.createElement('audio');
      aud.preload = 'metadata';
      aud.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve({
          durationMs: Number.isFinite(aud.duration)
            ? Math.round(aud.duration * 1000)
            : undefined,
        });
      };
      aud.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      aud.src = url;
    });
  }

  return {};
}

export function MediaLibraryView({ onRefreshAll }: MediaLibraryViewProps) {
  const { getToken } = useAuth();
  const locale = useStudioStore((s) => s.locale);
  const mediaAssets = useStudioStore((s) => s.mediaAssets);
  const projects = useStudioStore((s) => s.projects);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);
  const t = translations[locale];

  const [categoryFilter, setCategoryFilter] = useState('all');
  const [uploadCategory, setUploadCategory] = useState('auto');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'largest' | 'name'>('newest');
  const [uploadingCount, setUploadingCount] = useState(0);
  const [dragActive, setDragActive] = useState(false);

  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const attemptedThumbsRef = useRef<Set<number>>(new Set());
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<StudioMediaAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<{
    asset: StudioMediaAsset;
    objectUrl: string;
  } | null>(null);

  // Fetch inline authenticated thumbnails for visible image assets
  useEffect(() => {
    let active = true;
    const loadThumbs = async () => {
      const token = await getToken();
      if (!token) return;
      const imageAssets = mediaAssets.filter(
        (a) =>
          a.mimeType.startsWith('image/') &&
          !thumbnails[a.id] &&
          !attemptedThumbsRef.current.has(a.id)
      );
      for (const asset of imageAssets.slice(0, 24)) {
        attemptedThumbsRef.current.add(asset.id);
        try {
          const url = await fetchAuthenticatedBlobUrl(`/api/media/${asset.id}/file`, token);
          if (active) {
            setThumbnails((prev) => ({ ...prev, [asset.id]: url }));
          } else {
            URL.revokeObjectURL(url);
          }
        } catch {
          // Non-fatal thumbnail error
        }
      }
    };
    void loadThumbs();
    return () => {
      active = false;
    };
  }, [mediaAssets, getToken]);

  const uploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setUploadingCount(files.length);
    setErrorBanner(null);

    try {
      const token = await getToken();
      for (const file of files) {
        const meta = await extractMediaMetadata(file);
        const formData = new FormData();
        formData.append('file', file);
        if (uploadCategory !== 'auto') {
          formData.append('category', uploadCategory);
        }
        if (meta.width) formData.append('width', String(meta.width));
        if (meta.height) formData.append('height', String(meta.height));
        if (meta.durationMs) formData.append('durationMs', String(meta.durationMs));
        await apiFetch('/api/media/upload', { method: 'POST', body: formData }, token);
      }
      await onRefreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در بارگذاری فایل');
    } finally {
      setUploadingCount(0);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      void uploadFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files) {
      void uploadFiles(e.dataTransfer.files);
    }
  };

  const handlePreview = async (asset: StudioMediaAsset) => {
    try {
      const token = await getToken();
      if (!token) return;
      const objectUrl = await fetchAuthenticatedBlobUrl(
        `/api/media/${asset.id}/file`,
        token
      );
      setPreviewAsset({ asset, objectUrl });
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در پیش‌نمایش فایل');
    }
  };

  const closePreview = () => {
    if (previewAsset) {
      URL.revokeObjectURL(previewAsset.objectUrl);
      setPreviewAsset(null);
    }
  };

  const handleUpdateAsset = async (
    assetId: number,
    patch: { displayName?: string; category?: string; projectId?: number | null }
  ) => {
    try {
      const token = await getToken();
      await apiFetch(
        `/api/media/${assetId}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
        token
      );
      setRenamingId(null);
      await onRefreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در بروزرسانی مشخصات فایل');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const token = await getToken();
      await apiFetch(
        `/api/media/${deleteTarget.id}?confirm=true`,
        { method: 'DELETE' },
        token
      );
      if (selectedAssetId === deleteTarget.id) {
        setSelectedAssetId(null);
      }
      setDeleteTarget(null);
      await onRefreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در حذف فایل');
    } finally {
      setDeleting(false);
    }
  };

  const filteredAssets = mediaAssets
    .filter((a) => {
      const matchesCat = categoryFilter === 'all' || a.category === categoryFilter;
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        a.displayName.toLowerCase().includes(q) ||
        a.originalName.toLowerCase().includes(q);
      return matchesCat && matchesSearch;
    })
    .sort((a, b) => {
      if (sortBy === 'largest') return b.sizeBytes - a.sizeBytes;
      if (sortBy === 'name') return a.displayName.localeCompare(b.displayName);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const selectedAsset =
    mediaAssets.find((a) => a.id === selectedAssetId) ?? filteredAssets[0] ?? null;

  const renderAssetIcon = (asset: StudioMediaAsset) => {
    if (asset.mimeType.startsWith('video/')) return <FileVideo className="h-6 w-6 text-blue-500" />;
    if (asset.mimeType.startsWith('audio/')) return <FileAudio className="h-6 w-6 text-amber-500" />;
    if (asset.category === 'font') return <Type className="h-6 w-6 text-emerald-500" />;
    return <FileImage className="h-6 w-6 text-slate-400" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t.mediaLibraryTitle}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t.mediaLibraryDesc}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 dark:text-slate-400">
            {t.categoryLabel}:
          </label>
          <select
            value={uploadCategory}
            onChange={(e) => setUploadCategory(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-[#111827]"
          >
            <option value="auto">{locale === 'fa' ? 'تشخیص خودکار' : 'Auto Detect'}</option>
            {MEDIA_CATEGORIES.filter((c) => c.id !== 'all').map((cat) => (
              <option key={cat.id} value={cat.id}>
                {locale === 'fa' ? cat.fa : cat.en}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Multi-file Drag & Drop Zone */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
            : 'border-slate-300 bg-white hover:border-slate-400 dark:border-slate-700 dark:bg-[#111827] dark:hover:border-slate-600'
        }`}
      >
        <UploadCloud className="h-7 w-7 text-blue-600 dark:text-blue-400" />
        <p className="mt-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {uploadingCount > 0 ? `${t.uploading} (${uploadingCount})` : t.uploadTitle}
        </p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.uploadHint}</p>
        <input
          type="file"
          multiple
          disabled={uploadingCount > 0}
          onChange={handleFileChange}
          className="hidden"
        />
      </label>

      {/* Filter Tabs + Search + Sort */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/80">
          {MEDIA_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategoryFilter(cat.id)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                categoryFilter === cat.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {locale === 'fa' ? cat.fa : cat.en}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchMedia}
              className="rounded-lg border border-slate-200 bg-white py-1.5 pe-3 ps-8 text-xs outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-[#111827]"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as 'newest' | 'largest' | 'name')
            }
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-[#111827]"
          >
            <option value="newest">{t.sortNewest}</option>
            <option value="largest">{t.sortLargest}</option>
            <option value="name">{t.sortName}</option>
          </select>
        </div>
      </div>

      {/* Grid + Inspector Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {filteredAssets.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-[#111827] dark:text-slate-400">
              {t.noMedia}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredAssets.map((asset) => {
                const isSelected = selectedAsset?.id === asset.id;
                const thumbUrl = thumbnails[asset.id];
                return (
                  <div
                    key={asset.id}
                    onClick={() => setSelectedAssetId(asset.id)}
                    className={`cursor-pointer overflow-hidden rounded-xl border bg-white transition-colors dark:bg-[#111827] ${
                      isSelected
                        ? 'border-blue-600'
                        : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex h-32 items-center justify-center bg-slate-100 dark:bg-slate-900">
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt={asset.displayName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        renderAssetIcon(asset)
                      )}
                    </div>
                    <div className="p-3.5">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {asset.displayName}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        <span className="font-mono uppercase">{asset.extension}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{formatBytes(asset.sizeBytes)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {MEDIA_CATEGORIES.find((c) => c.id === asset.category)?.[
                            locale === 'fa' ? 'fa' : 'en'
                          ] || asset.category}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* File Details & Actions Inspector */}
        <aside className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827] h-fit">
          <h3 className="border-b border-slate-100 pb-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
            {t.fileInspector}
          </h3>
          {!selectedAsset ? (
            <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {t.selectFilePrompt}
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {renamingId === selectedAsset.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateAsset(selectedAsset.id, { displayName: renameValue })
                    }
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <p className="break-all text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedAsset.displayName}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(selectedAsset.id);
                      setRenameValue(selectedAsset.displayName);
                    }}
                    className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                    title={t.rename}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <div className="flex justify-between gap-2">
                  <span>MIME</span>
                  <span className="font-mono text-slate-900 dark:text-slate-200">
                    {selectedAsset.mimeType}
                  </span>
                </div>
                <div className="flex justify-between gap-2 tabular-nums">
                  <span>{locale === 'fa' ? 'حجم فایل' : 'Size'}</span>
                  <span className="font-mono text-slate-900 dark:text-slate-200">
                    {formatBytes(selectedAsset.sizeBytes)}
                  </span>
                </div>
                {selectedAsset.width && selectedAsset.height && (
                  <div className="flex justify-between gap-2 tabular-nums">
                    <span>{t.dimensions}</span>
                    <span className="font-mono text-slate-900 dark:text-slate-200">
                      {selectedAsset.width}×{selectedAsset.height}
                    </span>
                  </div>
                )}
                {selectedAsset.durationMs && (
                  <div className="flex justify-between gap-2 tabular-nums">
                    <span>{t.duration}</span>
                    <span className="font-mono text-slate-900 dark:text-slate-200">
                      {(selectedAsset.durationMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span>{t.checksum}</span>
                  <span className="font-mono text-slate-900 dark:text-slate-200">
                    {selectedAsset.sha256Hash.slice(0, 12)}...
                  </span>
                </div>
                <div className="flex items-center gap-1.5 pt-1 text-emerald-600 dark:text-emerald-400">
                  <FileCheck className="h-3.5 w-3.5" />
                  <span>{t.protectedOriginal}</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t.categoryLabel}
                </label>
                <select
                  value={selectedAsset.category}
                  onChange={(e) =>
                    handleUpdateAsset(selectedAsset.id, { category: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  {MEDIA_CATEGORIES.filter((c) => c.id !== 'all').map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {locale === 'fa' ? cat.fa : cat.en}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t.linkedProject}
                </label>
                <select
                  value={selectedAsset.projectId ?? ''}
                  onChange={(e) =>
                    handleUpdateAsset(selectedAsset.id, {
                      projectId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="">{t.noLinkedProject}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handlePreview(selectedAsset)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>{t.preview}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(selectedAsset)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t.delete}</span>
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Secure Authenticated Preview Modal */}
      {previewAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {previewAsset.asset.displayName}
              </h3>
              <button
                type="button"
                onClick={closePreview}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg bg-slate-100 p-4 dark:bg-slate-900">
              {previewAsset.asset.mimeType.startsWith('image/') ? (
                <img
                  src={previewAsset.objectUrl}
                  alt={previewAsset.asset.displayName}
                  className="max-h-[60vh] rounded object-contain"
                />
              ) : previewAsset.asset.mimeType.startsWith('video/') ? (
                <video
                  src={previewAsset.objectUrl}
                  controls
                  className="max-h-[60vh] w-full rounded"
                />
              ) : previewAsset.asset.mimeType.startsWith('audio/') ? (
                <audio src={previewAsset.objectUrl} controls className="w-full" />
              ) : (
                <p className="font-mono text-xs text-slate-600 dark:text-slate-300">
                  {previewAsset.asset.mimeType} · {formatBytes(previewAsset.asset.sizeBytes)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t.confirmDeleteTitle}
        description={t.confirmDeleteMediaDesc}
        confirmLabel={t.confirmDeleteAction}
        cancelLabel={t.cancel}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        busy={deleting}
      />
    </div>
  );
}
