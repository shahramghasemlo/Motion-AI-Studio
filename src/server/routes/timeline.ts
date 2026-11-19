import { and, asc, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/index.ts';
import {
  mediaAssets,
  projectScenes,
  projects,
  projectVersions,
} from '../../db/schema.ts';
import { logActivity } from '../../db/users.ts';
import { requireAuth, type AuthRequest } from '../../middleware/auth.ts';
import {
  buildTimelineFromProjectScenes,
  DEFAULT_AUDIO_SETTINGS,
  type AudioSettingsDoc,
  type TimelineDocument,
} from '../../shared/motionEngine.ts';
import { studioWsHub } from '../ws.ts';

export const timelineRouter = Router();

timelineRouter.get('/projects/:projectId/timeline', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.projectId);

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const [scenes, userAssets] = await Promise.all([
      db
        .select()
        .from(projectScenes)
        .where(eq(projectScenes.projectId, projectId))
        .orderBy(asc(projectScenes.orderIndex), asc(projectScenes.id)),
      db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.userId, userId))
        .orderBy(desc(mediaAssets.createdAt)),
    ]);

    const existingTimeline = project.timelineData as TimelineDocument | null;
    const timelineData =
      existingTimeline && Array.isArray(existingTimeline.clips) && existingTimeline.clips.length > 0
        ? existingTimeline
        : buildTimelineFromProjectScenes(project, scenes, null);

    const audioSettings: AudioSettingsDoc = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...((project.audioSettings as Partial<AudioSettingsDoc> | null) ?? {}),
    };

    res.json({
      project,
      scenes,
      timelineData,
      audioSettings,
      mediaAssets: userAssets,
    });
  } catch (error) {
    console.error('Error fetching project timeline:', error);
    res.status(500).json({ error: 'خطا در دریافت داده‌های تایم‌لاین.' });
  }
});

timelineRouter.put('/projects/:projectId/timeline', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.projectId);

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const { timelineData, audioSettings, saveSnapshot = false } = req.body ?? {};
    if (!timelineData || !Array.isArray(timelineData.clips) || !Array.isArray(timelineData.tracks)) {
      res.status(400).json({ error: 'ساختار داده‌های تایم‌لاین معتبر نیست.' });
      return;
    }

    const nextAudio: AudioSettingsDoc = {
      ...DEFAULT_AUDIO_SETTINGS,
      ...(audioSettings ?? {}),
    };

    let nextVersion = project.currentVersion;
    if (saveSnapshot) {
      nextVersion += 1;
      const scenes = await db
        .select()
        .from(projectScenes)
        .where(eq(projectScenes.projectId, projectId))
        .orderBy(asc(projectScenes.orderIndex));

      await db.insert(projectVersions).values({
        projectId,
        userId,
        versionNumber: nextVersion,
        label: project.language === 'en' ? 'Timeline Editor Save' : 'ذخیره تایم‌لاین تدوین',
        snapshot: {
          project: { ...project, timelineData, audioSettings: nextAudio },
          scenes,
        },
      });
    }

    const [updated] = await db
      .update(projects)
      .set({
        timelineData,
        audioSettings: nextAudio as unknown as Record<string, unknown>,
        currentVersion: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
      .returning();

    await logActivity(
      userId,
      'timeline.saved',
      `تایم‌لاین و تنظیمات صوتی پروژه «${updated.title}» ذخیره شد`,
      projectId
    );

    studioWsHub.emitToUser(userId, 'timeline:updated', { projectId });

    res.json({
      project: updated,
      timelineData: updated.timelineData,
      audioSettings: updated.audioSettings,
    });
  } catch (error) {
    console.error('Error saving timeline:', error);
    res.status(500).json({ error: 'خطا در ذخیره تایم‌لاین پروژه.' });
  }
});

timelineRouter.post('/projects/:projectId/timeline/sync-scenes', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.projectId);

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const scenes = await db
      .select()
      .from(projectScenes)
      .where(eq(projectScenes.projectId, projectId))
      .orderBy(asc(projectScenes.orderIndex), asc(projectScenes.id));

    const existing = project.timelineData as TimelineDocument | null;
    const syncedTimeline = buildTimelineFromProjectScenes(project, scenes, existing);

    const [updated] = await db
      .update(projects)
      .set({
        timelineData: syncedTimeline as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
      .returning();

    studioWsHub.emitToUser(userId, 'timeline:updated', { projectId });

    res.json({
      timelineData: updated.timelineData,
      scenes,
    });
  } catch (error) {
    console.error('Error syncing timeline from scenes:', error);
    res.status(500).json({ error: 'خطا در همگام‌سازی تایم‌لاین با صحنه‌ها.' });
  }
});

timelineRouter.post('/projects/:projectId/scenes/reorder', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.projectId);
    const orderedIds = Array.isArray(req.body?.orderedSceneIds)
      ? req.body.orderedSceneIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const currentScenes = await db
      .select()
      .from(projectScenes)
      .where(eq(projectScenes.projectId, projectId))
      .orderBy(asc(projectScenes.orderIndex));

    type SceneRow = (typeof currentScenes)[number];
    const sceneMap = new Map<number, SceneRow>(currentScenes.map((s) => [s.id, s]));
    const reorderedPrefix = orderedIds
      .map((id: number) => sceneMap.get(id))
      .filter((s: SceneRow | undefined): s is SceneRow => Boolean(s));
    const sorted = [
      ...reorderedPrefix,
      ...currentScenes.filter((s) => !orderedIds.includes(s.id)),
    ];

    let cursorMs = 0;
    const updatedScenes = [];
    for (let i = 0; i < sorted.length; i++) {
      const sc = sorted[i];
      const [row] = await db
        .update(projectScenes)
        .set({
          orderIndex: i,
          startTimeMs: cursorMs,
          updatedAt: new Date(),
        })
        .where(eq(projectScenes.id, sc.id))
        .returning();
      cursorMs += Math.max(500, sc.durationMs);
      updatedScenes.push(row);
    }

    res.json({ scenes: updatedScenes });
  } catch (error) {
    console.error('Error reordering scenes:', error);
    res.status(500).json({ error: 'خطا در تغییر ترتیب صحنه‌ها.' });
  }
});
