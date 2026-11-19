import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../../db/index.ts';
import {
  activityLogs,
  mediaAssets,
  projects,
  renderJobs,
} from '../../db/schema.ts';
import { logActivity } from '../../db/users.ts';
import type { AuthRequest } from '../../middleware/auth.ts';
import { STARTER_TEMPLATES } from '../../shared/templates.ts';
import { MAX_UPLOAD_BYTES, TEMP_DIR } from '../storage.ts';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;

    const [userProjects, userAssets, userRenderJobs, userActivity] =
      await Promise.all([
        db
          .select()
          .from(projects)
          .where(eq(projects.userId, dbUser.id))
          .orderBy(desc(projects.updatedAt)),
        db
          .select()
          .from(mediaAssets)
          .where(eq(mediaAssets.userId, dbUser.id))
          .orderBy(desc(mediaAssets.createdAt)),
        db
          .select({
            id: renderJobs.id,
            projectId: renderJobs.projectId,
            format: renderJobs.format,
            quality: renderJobs.quality,
            fps: renderJobs.fps,
            status: renderJobs.status,
            progressPercent: renderJobs.progressPercent,
            outputSizeBytes: renderJobs.outputSizeBytes,
            createdAt: renderJobs.createdAt,
            updatedAt: renderJobs.updatedAt,
          })
          .from(renderJobs)
          .where(eq(renderJobs.userId, dbUser.id))
          .orderBy(desc(renderJobs.createdAt))
          .limit(20),
        db
          .select()
          .from(activityLogs)
          .where(eq(activityLogs.userId, dbUser.id))
          .orderBy(desc(activityLogs.createdAt))
          .limit(15),
      ]);

    const categoryTotals: Record<string, { count: number; bytes: number }> = {};
    for (const asset of userAssets) {
      if (!categoryTotals[asset.category]) {
        categoryTotals[asset.category] = { count: 0, bytes: 0 };
      }
      categoryTotals[asset.category].count += 1;
      categoryTotals[asset.category].bytes += Number(asset.sizeBytes || 0);
    }

    const activeRenderCount = userRenderJobs.filter(
      (j) => j.status === 'queued' || j.status === 'processing'
    ).length;

    res.json({
      summary: {
        projectCount: userProjects.length,
        mediaCount: userAssets.length,
        activeProcessingCount: activeRenderCount,
        completedOutputsCount: userRenderJobs.filter((j) => j.status === 'completed').length,
        latestProject: userProjects[0] ?? null,
      },
      projects: userProjects,
      mediaAssets: userAssets,
      renderOutputs: userRenderJobs,
      activityLogs: userActivity,
      templates: STARTER_TEMPLATES,
      storage: {
        usedBytes: dbUser.storageUsedBytes,
        quotaBytes: dbUser.storageQuotaBytes,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        byCategory: categoryTotals,
      },
    });
  } catch (error) {
    console.error('Error loading dashboard summary:', error);
    res.status(500).json({ error: 'خطا در بارگذاری اطلاعات داشبورد.' });
  }
});

dashboardRouter.post('/cleanup-temp', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const userTempPrefix = `user_${dbUser.id}_`;
    const entries = await fs.readdir(TEMP_DIR).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (entry.startsWith(userTempPrefix)) {
        await fs.rm(path.join(TEMP_DIR, entry), { recursive: true, force: true });
        removed += 1;
      }
    }
    await logActivity(
      dbUser.id,
      'storage.temp_cleaned',
      `${removed} پوشه موقت پاکسازی شد`
    );
    res.json({ cleanedCount: removed });
  } catch (error) {
    console.error('Error cleaning temp files:', error);
    res.status(500).json({ error: 'خطا در پاکسازی فایل‌های موقت.' });
  }
});
