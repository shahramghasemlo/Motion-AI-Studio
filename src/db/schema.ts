import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Users table synchronized with Firebase Authentication UID
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  role: text('role').notNull().default('user'), // 'user' | 'admin'
  storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' })
    .notNull()
    .default(524288000), // 500 MB default
  storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' })
    .notNull()
    .default(0),
  preferredLocale: text('preferred_locale').notNull().default('fa'), // 'fa' | 'en'
  preferredTheme: text('preferred_theme').notNull().default('dark'), // 'dark' | 'light'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Commercial video & motion graphics projects
export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  topic: text('topic').notNull().default(''),
  businessName: text('business_name').notNull().default(''),
  productType: text('product_type').notNull().default(''),
  targetAudience: text('target_audience').notNull().default(''),
  language: text('language').notNull().default('fa'), // 'fa' | 'en'
  aspectRatio: text('aspect_ratio').notNull().default('9:16'), // '9:16' | '16:9' | '1:1' | '4:5' | 'custom'
  customWidth: integer('custom_width').notNull().default(1080),
  customHeight: integer('custom_height').notNull().default(1920),
  durationSeconds: integer('duration_seconds').notNull().default(15),
  designStyle: text('design_style').notNull().default('modern_minimal'),
  outputQuality: text('output_quality').notNull().default('1080p'),
  status: text('status').notNull().default('draft'), // 'draft' | 'analyzing' | 'ready' | 'rendering' | 'completed'
  referenceStyleProfile: jsonb('reference_style_profile').$type<Record<string, unknown> | null>().default(null),
  scenarioData: jsonb('scenario_data').$type<Record<string, unknown> | null>().default(null),
  timelineData: jsonb('timeline_data').$type<Record<string, unknown> | null>().default(null),
  audioSettings: jsonb('audio_settings').$type<Record<string, unknown> | null>().default(null),
  currentVersion: integer('current_version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Project version snapshots for safe restore & rollback
export const projectVersions = pgTable('project_versions', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  versionNumber: integer('version_number').notNull(),
  label: text('label').notNull().default('Snapshot'),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Scene-based independent production units (each scene can be edited/locked/regenerated independently)
export const projectScenes = pgTable('project_scenes', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  title: text('title').notNull(),
  startTimeMs: integer('start_time_ms').notNull().default(0),
  durationMs: integer('duration_ms').notNull().default(3000),
  locked: boolean('locked').notNull().default(false),
  textContent: text('text_content').notNull().default(''),
  visualPrompt: text('visual_prompt').notNull().default(''),
  animationPreset: text('animation_preset').notNull().default('fade_slide_up'),
  transitionType: text('transition_type').notNull().default('cross_dissolve'),
  effectsConfig: jsonb('effects_config').$type<Record<string, unknown>>().notNull().default({}),
  layersConfig: jsonb('layers_config').$type<Array<Record<string, unknown>>>().notNull().default([]),
  variants: jsonb('variants').$type<Array<Record<string, unknown>>>().notNull().default([]),
  activeVariantIndex: integer('active_variant_index').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// User Media Library assets with integrity hashes and original-file protection
export const mediaAssets = pgTable('media_assets', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  projectId: integer('project_id').references(() => projects.id, {
    onDelete: 'set null',
  }),
  originalName: text('original_name').notNull(),
  displayName: text('display_name').notNull(),
  category: text('category').notNull().default('image'), // 'image' | 'video' | 'logo' | 'audio' | 'music' | 'font' | 'background' | 'graphic' | 'reference_video'
  mimeType: text('mime_type').notNull(),
  extension: text('extension').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull(),
  sha256Hash: text('sha256_hash').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationMs: integer('duration_ms'),
  isProtectedOriginal: boolean('is_protected_original').notNull().default(true),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Multi-provider AI manager registry (zero secrets exposed to frontend)
export const aiProviders = pgTable('ai_providers', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  providerKey: text('provider_key').notNull(), // 'gemini' | 'ffmpeg_local' | 'web_speech' | 'custom_endpoint'
  displayName: text('display_name').notNull(),
  capability: text('capability').notNull(), // 'text' | 'image_analysis' | 'video_analysis' | 'image_gen' | 'video_gen' | 'audio_tts'
  modelName: text('model_name').notNull(),
  priority: integer('priority').notNull().default(1),
  isEnabled: boolean('is_enabled').notNull().default(true),
  isFreeTier: boolean('is_free_tier').notNull().default(true),
  quotaLimit: integer('quota_limit').notNull().default(100),
  quotaUsed: integer('quota_used').notNull().default(0),
  status: text('status').notNull().default('active'), // 'active' | 'degraded' | 'exhausted' | 'disabled'
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Background render job queue
export const renderJobs = pgTable('render_jobs', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  format: text('format').notNull().default('mp4'), // 'mp4' | 'webm' | 'gif' | 'png'
  quality: text('quality').notNull().default('1080p'),
  fps: integer('fps').notNull().default(30),
  status: text('status').notNull().default('queued'), // 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progressPercent: integer('progress_percent').notNull().default(0),
  outputPath: text('output_path'),
  outputSizeBytes: bigint('output_size_bytes', { mode: 'number' }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Audit & recent activity trail
export const activityLogs = pgTable('activity_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  projectId: integer('project_id').references(() => projects.id, {
    onDelete: 'set null',
  }),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Phase 3: Reference videos & multimodal analysis reports
export const referenceVideos = pgTable('reference_videos', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  sourceType: text('source_type').notNull().default('upload'), // 'upload' | 'url'
  sourceUrl: text('source_url'),
  platform: text('platform').notNull().default('local'), // 'local' | 'youtube' | 'instagram' | 'direct_video' | 'unsupported'
  accessStatus: text('access_status').notNull().default('accessible'), // 'accessible' | 'restricted_requires_upload' | 'invalid_url'
  accessMessage: text('access_message').notNull().default(''),
  mediaAssetId: integer('media_asset_id').references(() => mediaAssets.id, {
    onDelete: 'set null',
  }),
  durationMs: integer('duration_ms'),
  width: integer('width'),
  height: integer('height'),
  fps: text('fps'),
  hasAudio: boolean('has_audio').notNull().default(false),
  analysisStatus: text('analysis_status').notNull().default('pending'), // 'pending' | 'extracting_frames' | 'analyzing_ai' | 'completed' | 'failed'
  analysisError: text('analysis_error'),
  overallSummary: jsonb('overall_summary').$type<Record<string, unknown> | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const referenceScenes = pgTable('reference_scenes', {
  id: serial('id').primaryKey(),
  referenceVideoId: integer('reference_video_id')
    .references(() => referenceVideos.id, { onDelete: 'cascade' })
    .notNull(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  sceneNumber: integer('scene_number').notNull(),
  startTimeMs: integer('start_time_ms').notNull(),
  endTimeMs: integer('end_time_ms').notNull(),
  durationMs: integer('duration_ms').notNull(),
  frameStorageKey: text('frame_storage_key').notNull(),
  detectedText: text('detected_text').notNull().default(''),
  textAnimation: text('text_animation').notNull().default(''),
  visualEffects: jsonb('visual_effects').$type<string[]>().notNull().default([]),
  cameraMotion: text('camera_motion').notNull().default(''),
  dominantColors: jsonb('dominant_colors').$type<string[]>().notNull().default([]),
  transitionType: text('transition_type').notNull().default(''),
  typographyNotes: text('typography_notes').notNull().default(''),
  aiDescription: text('ai_description').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  mediaAssets: many(mediaAssets),
  renderJobs: many(renderJobs),
  activityLogs: many(activityLogs),
  referenceVideos: many(referenceVideos),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  versions: many(projectVersions),
  scenes: many(projectScenes),
  mediaAssets: many(mediaAssets),
  renderJobs: many(renderJobs),
  referenceVideos: many(referenceVideos),
}));

export const projectVersionsRelations = relations(projectVersions, ({ one }) => ({
  project: one(projects, {
    fields: [projectVersions.projectId],
    references: [projects.id],
  }),
  author: one(users, {
    fields: [projectVersions.userId],
    references: [users.id],
  }),
}));

export const projectScenesRelations = relations(projectScenes, ({ one }) => ({
  project: one(projects, {
    fields: [projectScenes.projectId],
    references: [projects.id],
  }),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  owner: one(users, {
    fields: [mediaAssets.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [mediaAssets.projectId],
    references: [projects.id],
  }),
}));

export const renderJobsRelations = relations(renderJobs, ({ one }) => ({
  project: one(projects, {
    fields: [renderJobs.projectId],
    references: [projects.id],
  }),
  owner: one(users, {
    fields: [renderJobs.userId],
    references: [users.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [activityLogs.projectId],
    references: [projects.id],
  }),
}));

export const referenceVideosRelations = relations(referenceVideos, ({ one, many }) => ({
  owner: one(users, {
    fields: [referenceVideos.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [referenceVideos.projectId],
    references: [projects.id],
  }),
  mediaAsset: one(mediaAssets, {
    fields: [referenceVideos.mediaAssetId],
    references: [mediaAssets.id],
  }),
  scenes: many(referenceScenes),
}));

export const referenceScenesRelations = relations(referenceScenes, ({ one }) => ({
  referenceVideo: one(referenceVideos, {
    fields: [referenceScenes.referenceVideoId],
    references: [referenceVideos.id],
  }),
  project: one(projects, {
    fields: [referenceScenes.projectId],
    references: [projects.id],
  }),
}));

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ProjectVersionRow = typeof projectVersions.$inferSelect;
export type ProjectSceneRow = typeof projectScenes.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type AiProviderRow = typeof aiProviders.$inferSelect;
export type RenderJobRow = typeof renderJobs.$inferSelect;
export type ActivityLogRow = typeof activityLogs.$inferSelect;
export type ReferenceVideoRow = typeof referenceVideos.$inferSelect;
export type ReferenceSceneRow = typeof referenceScenes.$inferSelect;
