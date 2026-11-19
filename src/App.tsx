import {
  FolderKanban,
  HardDrive,
  Languages,
  LayoutDashboard,
  LogIn,
  LogOut,
  Moon,
  Plus,
  Settings,
  Sun,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DashboardView } from './components/DashboardView.tsx';
import { MediaLibraryView } from './components/MediaLibraryView.tsx';
import { ProjectWizardModal } from './components/ProjectWizardModal.tsx';
import { ProjectsWorkspaceView } from './components/ProjectsWorkspaceView.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx';
import { translations } from './i18n/translations.ts';
import { apiFetch } from './lib/api.ts';
import type { StarterTemplate } from './shared/templates.ts';
import {
  useStudioStore,
  type DashboardSummary,
  type HealthCapabilities,
  type StudioActivityLog,
  type StudioAiProvider,
  type StudioMediaAsset,
  type StudioProject,
  type StudioRenderOutput,
  type StudioTab,
} from './store/useStudioStore.ts';

function StudioWorkspace() {
  const { firebaseUser, loading, signingIn, authError, signInWithGoogle, signOut, getToken } =
    useAuth();
  const locale = useStudioStore((s) => s.locale);
  const theme = useStudioStore((s) => s.theme);
  const activeTab = useStudioStore((s) => s.activeTab);
  const user = useStudioStore((s) => s.user);
  const wsConnected = useStudioStore((s) => s.wsConnected);
  const errorBanner = useStudioStore((s) => s.errorBanner);
  const setLocale = useStudioStore((s) => s.setLocale);
  const setTheme = useStudioStore((s) => s.setTheme);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const openWizard = useStudioStore((s) => s.openWizard);
  const openProjectInWorkspace = useStudioStore((s) => s.openProjectInWorkspace);
  const setDashboardData = useStudioStore((s) => s.setDashboardData);
  const setProviders = useStudioStore((s) => s.setProviders);
  const setHealth = useStudioStore((s) => s.setHealth);
  const setWsConnected = useStudioStore((s) => s.setWsConnected);
  const setErrorBanner = useStudioStore((s) => s.setErrorBanner);
  const bumpAnalysisPulse = useStudioStore((s) => s.bumpAnalysisPulse);
  const bumpBlueprintPulse = useStudioStore((s) => s.bumpBlueprintPulse);
  const bumpTimelinePulse = useStudioStore((s) => s.bumpTimelinePulse);
  const bumpRenderPulse = useStudioStore((s) => s.bumpRenderPulse);

  const [checkingHealth, setCheckingHealth] = useState(false);
  const t = translations[locale];

  const runHealthCheck = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const data = await apiFetch<{ capabilities: HealthCapabilities }>(
        '/api/health?checkDb=1'
      );
      setHealth(data.capabilities);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'خطا در بررسی وضعیت سرور'
      );
    } finally {
      setCheckingHealth(false);
    }
  }, [setHealth, setErrorBanner]);

  const refreshWorkspaceData = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const [dashRes, provRes] = await Promise.all([
        apiFetch<{
          summary: DashboardSummary;
          projects: StudioProject[];
          mediaAssets: StudioMediaAsset[];
          renderOutputs: StudioRenderOutput[];
          activityLogs: StudioActivityLog[];
          templates: StarterTemplate[];
          storage: {
            usedBytes: number;
            quotaBytes: number;
            byCategory: Record<string, { count: number; bytes: number }>;
          };
        }>('/api/dashboard', {}, token),
        apiFetch<{ providers: StudioAiProvider[] }>('/api/providers', {}, token),
      ]);
      setDashboardData(dashRes);
      setProviders(provRes.providers);
    } catch (err) {
      console.error('Failed to load studio dashboard:', err);
    }
  }, [getToken, setDashboardData, setProviders]);

  useEffect(() => {
    void runHealthCheck();
  }, [runHealthCheck]);

  useEffect(() => {
    if (!firebaseUser || !user) return;
    void refreshWorkspaceData();

    let closed = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = async () => {
      if (closed) return;
      setWsConnected(true);
      const token = await getToken();
      if (token && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'auth', token }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { type: string };
        if (
          msg.type === 'project:created' ||
          msg.type === 'project:updated' ||
          msg.type === 'project:deleted' ||
          msg.type === 'media:uploaded'
        ) {
          void refreshWorkspaceData();
        } else if (
          msg.type === 'analysis:progress' ||
          msg.type === 'analysis:completed' ||
          msg.type === 'analysis:failed'
        ) {
          bumpAnalysisPulse();
        } else if (msg.type === 'blueprint:generated') {
          bumpBlueprintPulse();
          void refreshWorkspaceData();
        } else if (msg.type === 'timeline:updated') {
          bumpTimelinePulse();
        } else if (msg.type === 'render:progress') {
          bumpRenderPulse();
        } else if (
          msg.type === 'render:queued' ||
          msg.type === 'render:completed' ||
          msg.type === 'render:failed' ||
          msg.type === 'render:cancelled'
        ) {
          bumpRenderPulse();
          void refreshWorkspaceData();
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      if (!closed) setWsConnected(false);
    };

    return () => {
      closed = true;
      ws.close();
    };
  }, [
    firebaseUser,
    user,
    getToken,
    refreshWorkspaceData,
    setWsConnected,
    bumpAnalysisPulse,
    bumpBlueprintPulse,
    bumpTimelinePulse,
    bumpRenderPulse,
  ]);

  const handleToggleLocale = async () => {
    const nextLocale = locale === 'fa' ? 'en' : 'fa';
    setLocale(nextLocale);
    if (firebaseUser) {
      try {
        const token = await getToken();
        await apiFetch(
          '/api/auth/preferences',
          {
            method: 'PATCH',
            body: JSON.stringify({ preferredLocale: nextLocale }),
          },
          token
        );
      } catch {
        // Non-fatal preference sync
      }
    }
  };

  const handleToggleTheme = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    if (firebaseUser) {
      try {
        const token = await getToken();
        await apiFetch(
          '/api/auth/preferences',
          {
            method: 'PATCH',
            body: JSON.stringify({ preferredTheme: nextTheme }),
          },
          token
        );
      } catch {
        // Non-fatal preference sync
      }
    }
  };

  const navItems: Array<{ id: StudioTab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'dashboard', label: t.navDashboard, icon: LayoutDashboard },
    { id: 'projects', label: t.navProjects, icon: FolderKanban },
    { id: 'media', label: t.navMedia, icon: HardDrive },
    { id: 'settings', label: t.navSettings, icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0B0F17] dark:text-slate-100">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-6 py-3.5 backdrop-blur-xs dark:border-slate-800 dark:bg-[#0B0F17]/95">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            {t.brand}
          </button>

          {firebaseUser && (
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`whitespace-nowrap shrink-0 transition-colors ${
                    activeTab === item.id
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}

          <div className="flex items-center shrink-0">
            {firebaseUser ? (
              <button
                type="button"
                onClick={() => openWizard(null)}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t.primaryCtaNewVideo}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={signingIn}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>{signingIn ? t.signingIn : t.signInWithGoogle}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {loading ? (
        <div className="mx-auto max-w-4xl px-6 py-24 text-center text-sm text-slate-500 dark:text-slate-400">
          {locale === 'fa' ? 'در حال بارگذاری استودیو...' : 'Loading Motion AI Studio...'}
        </div>
      ) : !firebaseUser ? (
        <main className="mx-auto max-w-3xl px-6 py-20">
          <div className="rounded-xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-[#111827]">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 text-balance">
              {t.authRequiredTitle}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {t.authRequiredDesc}
            </p>

            {authError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                {authError}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={signInWithGoogle}
                disabled={signingIn}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" />
                <span>{signingIn ? t.signingIn : t.signInWithGoogle}</span>
              </button>
              <button
                type="button"
                onClick={handleToggleLocale}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Languages className="h-4 w-4" />
                <span>{t.langToggle}</span>
              </button>
              <button
                type="button"
                onClick={handleToggleTheme}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span>{theme === 'dark' ? t.themeLight : t.themeDark}</span>
              </button>
            </div>
          </div>
        </main>
      ) : (
        <div className="mx-auto flex max-w-[1440px] flex-col md:flex-row">
          {/* Studio Sidebar */}
          <aside className="flex w-full flex-col justify-between border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-[#0F1521] md:min-h-[calc(100vh-57px)] md:w-64 md:border-b-0 md:border-e">
            <div>
              {user && (
                <div className="mb-5 border-b border-slate-200 pb-4 dark:border-slate-800">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {user.displayName}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                    {user.email}
                  </p>
                </div>
              )}

              <div className="flex flex-row gap-1 overflow-x-auto md:flex-col">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sidebar Utility Controls */}
            <div className="mt-4 hidden space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800 md:block">
              <div className="px-2 text-xs text-slate-500 dark:text-slate-400">
                {wsConnected ? t.wsConnected : t.wsDisconnected}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleLocale}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Languages className="h-3.5 w-3.5" />
                  <span>{t.langToggle}</span>
                </button>
                <button
                  type="button"
                  onClick={handleToggleTheme}
                  className="flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  aria-label={theme === 'dark' ? t.themeLight : t.themeDark}
                >
                  {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                </button>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>{t.signOut}</span>
              </button>
            </div>
          </aside>

          {/* Main Viewport */}
          <main className="min-w-0 flex-1 p-6 lg:p-8">
            {errorBanner && (
              <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                <span>{errorBanner}</span>
                <button
                  type="button"
                  onClick={() => setErrorBanner(null)}
                  className="text-xs font-semibold underline"
                >
                  {locale === 'fa' ? 'بستن' : 'Dismiss'}
                </button>
              </div>
            )}

            {activeTab === 'dashboard' && <DashboardView />}
            {activeTab === 'projects' && (
              <ProjectsWorkspaceView onRefreshAll={refreshWorkspaceData} />
            )}
            {activeTab === 'media' && (
              <MediaLibraryView onRefreshAll={refreshWorkspaceData} />
            )}
            {activeTab === 'settings' && (
              <SettingsView
                onRunHealthCheck={runHealthCheck}
                checkingHealth={checkingHealth}
                onRefreshAll={refreshWorkspaceData}
                onToggleLocale={handleToggleLocale}
                onToggleTheme={handleToggleTheme}
              />
            )}
          </main>
        </div>
      )}

      <ProjectWizardModal
        onCreated={async (created) => {
          await refreshWorkspaceData();
          openProjectInWorkspace(created.id);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <StudioWorkspace />
    </AuthProvider>
  );
}
