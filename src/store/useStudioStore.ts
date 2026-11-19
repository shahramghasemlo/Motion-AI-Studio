import { create } from 'zustand';
import type { Locale } from '../i18n/translations.ts';
import type { StarterTemplate } from '../shared/templates.ts';

export type StudioTab = 'dashboard' | 'projects' | 'media' | 'settings';
export type ThemeMode = 'dark' | 'light';

export interface StudioUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  role: string;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  preferredLocale: Locale;
  preferredTheme: ThemeMode;
}

export interface StudioProject {
  id: number;
  userId: number;
  title: string;
  topic: string;
  businessName: string;
  productType: string;
  targetAudience: string;
  language: string;
  aspectRatio: string;
  customWidth: number;
  customHeight: number;
  durationSeconds: number;
  designStyle: string;
  outputQuality: string;
  status: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface StudioMediaAsset {
  id: number;
  projectId: number | null;
  originalName: string;
  displayName: string;
  category: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256Hash: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  isProtectedOriginal: boolean;
  createdAt: string;
}

export interface StudioRenderOutput {
  id: number;
  projectId: number;
  format: string;
  quality: string;
  fps: number;
  status: string;
  progressPercent: number;
  outputSizeBytes: number | null;
  createdAt: string;
}

export interface StudioAiProvider {
  id: number;
  providerKey: string;
  displayName: string;
  capability: string;
  modelName: string;
  priority: number;
  isEnabled: boolean;
  isFreeTier: boolean;
  quotaLimit: number;
  quotaUsed: number;
  status: string;
}

export interface StudioActivityLog {
  id: number;
  action: string;
  summary: string;
  createdAt: string;
}

export interface HealthCapabilities {
  ffmpegAvailable: boolean;
  ffmpegVersion: string;
  geminiConfigured: boolean;
  websocketClients: number;
  maxUploadMb: number;
  databaseStatus: 'ready' | 'untested' | 'error';
}

export interface DashboardSummary {
  projectCount: number;
  mediaCount: number;
  activeProcessingCount: number;
  completedOutputsCount: number;
  latestProject: StudioProject | null;
}

interface StudioState {
  locale: Locale;
  theme: ThemeMode;
  activeTab: StudioTab;
  selectedProjectId: number | null;
  wizardOpen: boolean;
  wizardTemplateId: string | null;

  user: StudioUser | null;
  summary: DashboardSummary | null;
  projects: StudioProject[];
  mediaAssets: StudioMediaAsset[];
  renderOutputs: StudioRenderOutput[];
  templates: StarterTemplate[];
  providers: StudioAiProvider[];
  activityLogs: StudioActivityLog[];
  storageByCategory: Record<string, { count: number; bytes: number }>;
  health: HealthCapabilities | null;
  wsConnected: boolean;
  errorBanner: string | null;
  analysisPulse: number;
  blueprintPulse: number;
  timelinePulse: number;
  renderPulse: number;

  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemeMode) => void;
  setActiveTab: (tab: StudioTab) => void;
  openProjectInWorkspace: (projectId: number) => void;
  setSelectedProjectId: (projectId: number | null) => void;
  openWizard: (templateId?: string | null) => void;
  closeWizard: () => void;

  setUser: (user: StudioUser | null) => void;
  setDashboardData: (payload: {
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
  }) => void;
  setProviders: (providers: StudioAiProvider[]) => void;
  setHealth: (health: HealthCapabilities | null) => void;
  setWsConnected: (connected: boolean) => void;
  setErrorBanner: (message: string | null) => void;
  bumpAnalysisPulse: () => void;
  bumpBlueprintPulse: () => void;
  bumpTimelinePulse: () => void;
  bumpRenderPulse: () => void;
  updateStorageUsage: (usedBytes: number, quotaBytes?: number) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  locale: 'fa',
  theme: 'dark',
  activeTab: 'dashboard',
  selectedProjectId: null,
  wizardOpen: false,
  wizardTemplateId: null,

  user: null,
  summary: null,
  projects: [],
  mediaAssets: [],
  renderOutputs: [],
  templates: [],
  providers: [],
  activityLogs: [],
  storageByCategory: {},
  health: null,
  wsConnected: false,
  errorBanner: null,
  analysisPulse: 0,
  blueprintPulse: 0,
  timelinePulse: 0,
  renderPulse: 0,

  setLocale: (locale) => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
    set({ locale });
  },
  setTheme: (theme) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme });
  },
  setActiveTab: (activeTab) => set({ activeTab }),
  openProjectInWorkspace: (projectId) =>
    set({ selectedProjectId: projectId, activeTab: 'projects' }),
  setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
  openWizard: (templateId = null) =>
    set({ wizardOpen: true, wizardTemplateId: templateId ?? null }),
  closeWizard: () => set({ wizardOpen: false, wizardTemplateId: null }),

  setUser: (user) => set({ user }),
  setDashboardData: (payload) =>
    set((state) => ({
      summary: payload.summary,
      projects: payload.projects,
      mediaAssets: payload.mediaAssets,
      renderOutputs: payload.renderOutputs,
      activityLogs: payload.activityLogs,
      templates: payload.templates,
      storageByCategory: payload.storage.byCategory,
      user: state.user
        ? {
            ...state.user,
            storageUsedBytes: payload.storage.usedBytes,
            storageQuotaBytes: payload.storage.quotaBytes,
          }
        : null,
    })),
  setProviders: (providers) => set({ providers }),
  setHealth: (health) => set({ health }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
  setErrorBanner: (errorBanner) => set({ errorBanner }),
  bumpAnalysisPulse: () => set((state) => ({ analysisPulse: state.analysisPulse + 1 })),
  bumpBlueprintPulse: () => set((state) => ({ blueprintPulse: state.blueprintPulse + 1 })),
  bumpTimelinePulse: () => set((state) => ({ timelinePulse: state.timelinePulse + 1 })),
  bumpRenderPulse: () => set((state) => ({ renderPulse: state.renderPulse + 1 })),
  updateStorageUsage: (usedBytes, quotaBytes) =>
    set((state) => ({
      user: state.user
        ? {
            ...state.user,
            storageUsedBytes: usedBytes,
            storageQuotaBytes: quotaBytes ?? state.user.storageQuotaBytes,
          }
        : null,
    })),
}));
