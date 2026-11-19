import { CheckCircle2, Cpu, Database, HardDrive, RefreshCw, ShieldCheck, Trash2, Wifi } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import { translations } from '../i18n/translations.ts';
import { apiFetch } from '../lib/api.ts';
import { useStudioStore, type StudioAiProvider } from '../store/useStudioStore.ts';

interface SettingsViewProps {
  onRunHealthCheck: () => Promise<void>;
  checkingHealth: boolean;
  onRefreshAll: () => Promise<void>;
  onToggleLocale: () => Promise<void>;
  onToggleTheme: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SettingsView({
  onRunHealthCheck,
  checkingHealth,
  onRefreshAll,
  onToggleLocale,
  onToggleTheme,
}: SettingsViewProps) {
  const { getToken } = useAuth();
  const locale = useStudioStore((s) => s.locale);
  const theme = useStudioStore((s) => s.theme);
  const user = useStudioStore((s) => s.user);
  const health = useStudioStore((s) => s.health);
  const wsConnected = useStudioStore((s) => s.wsConnected);
  const providers = useStudioStore((s) => s.providers);
  const storageByCategory = useStudioStore((s) => s.storageByCategory);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);
  const t = translations[locale];

  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [cleaningTemp, setCleaningTemp] = useState(false);

  const toggleProvider = async (provider: StudioAiProvider) => {
    setUpdatingId(provider.id);
    try {
      const token = await getToken();
      await apiFetch(
        `/api/providers/${provider.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isEnabled: !provider.isEnabled }),
        },
        token
      );
      await onRefreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در تغییر وضعیت سرویس');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCleanupTemp = async () => {
    setCleaningTemp(true);
    try {
      const token = await getToken();
      await apiFetch('/api/dashboard/cleanup-temp', { method: 'POST' }, token);
      await onRefreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'خطا در پاکسازی فایل‌های موقت');
    } finally {
      setCleaningTemp(false);
    }
  };

  const usedBytes = user?.storageUsedBytes ?? 0;
  const quotaBytes = user?.storageQuotaBytes ?? 524288000;
  const usagePercent = Math.min(100, Math.round((usedBytes / Math.max(1, quotaBytes)) * 100));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {t.navSettings}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {t.providerManagerDesc}
          </p>
        </div>

        <button
          type="button"
          onClick={onRunHealthCheck}
          disabled={checkingHealth}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
          <span>{checkingHealth ? t.checkingHealth : t.runHealthCheck}</span>
        </button>
      </div>

      {/* Preferences */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {t.preferencesTitle}
        </h3>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onToggleLocale}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {locale === 'fa' ? 'تغییر زبان به English (LTR)' : 'Switch to فارسی (RTL)'}
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? t.themeLight : t.themeDark}
          </button>
        </div>
      </section>

      {/* Infrastructure Health Matrix */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t.dbStatus}</span>
            <Database className="h-4 w-4" />
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>
              {health?.databaseStatus === 'ready'
                ? t.ready
                : health?.databaseStatus === 'error'
                ? t.unavailable
                : t.untested}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t.ffmpegStatus}</span>
            <Cpu className="h-4 w-4" />
          </div>
          <div className="mt-2 text-sm font-semibold">
            {health?.ffmpegAvailable ? t.ready : t.unavailable}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{t.geminiStatus}</span>
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="mt-2 text-sm font-semibold">
            {health?.geminiConfigured ? t.configured : t.notConfigured}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111827]">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>WebSocket</span>
            <Wifi className="h-4 w-4" />
          </div>
          <div className="mt-2 text-sm font-semibold">
            {wsConnected ? t.wsConnected : t.wsDisconnected}
          </div>
        </div>
      </section>

      {/* Storage Breakdown & Temp Cleanup */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111827]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t.storageQuota}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCleanupTemp}
            disabled={cleaningTemp}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{t.cleanupTemp}</span>
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between font-mono text-xs text-slate-500 tabular-nums">
          <span>
            {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
          </span>
          <span>{usagePercent}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full bg-blue-600" style={{ width: `${usagePercent}%` }} />
        </div>

        {Object.keys(storageByCategory).length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs dark:border-slate-800 sm:grid-cols-4">
            {Object.entries(storageByCategory).map(([cat, info]) => (
              <div key={cat} className="tabular-nums">
                <p className="font-medium text-slate-700 dark:text-slate-300">{cat}</p>
                <p className="font-mono text-slate-500">
                  {info.count} · {formatBytes(info.bytes)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* AI Provider Manager Table */}
      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#111827]">
        <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t.providerManagerTitle}
          </h3>
        </div>
        <table className="w-full text-start text-sm">
          <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 text-start font-medium">
                {locale === 'fa' ? 'سرویس و مدل' : 'Provider & Model'}
              </th>
              <th className="px-4 py-3 text-start font-medium">
                {locale === 'fa' ? 'قابلیت' : 'Capability'}
              </th>
              <th className="px-4 py-3 text-start font-medium">
                {locale === 'fa' ? 'سهمیه' : 'Quota'}
              </th>
              <th className="px-4 py-3 text-end font-medium">
                {locale === 'fa' ? 'وضعیت' : 'State'}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {providers.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {p.displayName}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-slate-500">
                    {p.modelName} · {p.isFreeTier ? t.freeTier : t.paidOptional}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300">
                  {p.capability}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                  {p.quotaUsed} / {p.quotaLimit}
                </td>
                <td className="px-4 py-3 text-end">
                  <button
                    type="button"
                    onClick={() => toggleProvider(p)}
                    disabled={updatingId === p.id}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                      p.isEnabled
                        ? 'bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/20 dark:text-emerald-400'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {p.isEnabled ? t.enabled : t.disabled}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
