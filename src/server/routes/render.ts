import { and, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import fs from 'node:fs/promises';
import { db } from '../../db/index.ts';
import { projects, renderJobs, users } from '../../db/schema.ts';
import { logActivity } from '../../db/users.ts';
import { requireAuth, type AuthRequest } from '../../middleware/auth.ts';
import { EXPORTS_DIR, resolveSafeUserPath, sendFileSafely } from '../storage.ts';
import {
  computeRenderResolution,
  signalRenderJobCancellation,
  startRenderJobInBackground,
  type RenderFormat,
  type RenderQuality,
} from '../videoRenderer.ts';
import { studioWsHub } from '../ws.ts';

export const renderRouter = Router();

const ALLOWED_FORMATS: RenderFormat[] = ['mp4', 'webm', 'gif', 'png'];
const ALLOWED_QUALITIES: RenderQuality[] = ['720p', '1080p', '4k'];

const DOWNLOAD_MIME_MAP: Record<string, { mime: string; ext: string }> = {
  mp4: { mime: 'video/mp4', ext: 'mp4' },
  webm: { mime: 'video/webm', ext: 'webm' },
  gif: { mime: 'image/gif', ext: 'gif' },
  png: { mime: 'application/zip', ext: 'zip' },
};

renderRouter.get('/renders', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const rows = await db
      .select({
        id: renderJobs.id,
        projectId: renderJobs.projectId,
        projectTitle: projects.title,
        format: renderJobs.format,
        quality: renderJobs.quality,
        fps: renderJobs.fps,
        status: renderJobs.status,
        progressPercent: renderJobs.progressPercent,
        outputSizeBytes: renderJobs.outputSizeBytes,
        errorMessage: renderJobs.errorMessage,
        createdAt: renderJobs.createdAt,
        updatedAt: renderJobs.updatedAt,
      })
      .from(renderJobs)
      .leftJoin(projects, eq(renderJobs.projectId, projects.id))
      .where(eq(renderJobs.userId, dbUser.id))
      .orderBy(desc(renderJobs.createdAt))
      .limit(50);

    res.json({
      jobs: rows,
      storage: {
        usedBytes: dbUser.storageUsedBytes,
        quotaBytes: dbUser.storageQuotaBytes,
      },
    });
  } catch (error) {
    console.error('Error listing user render jobs:', error);
    res.status(500).json({ error: 'خطا در دریافت لیست رندرها.' });
  }
});

renderRouter.get('/projects/:projectId/renders', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const projectId = Number(req.params.projectId);

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, dbUser.id)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const jobs = await db
      .select()
      .from(renderJobs)
      .where(and(eq(renderJobs.projectId, projectId), eq(renderJobs.userId, dbUser.id)))
      .orderBy(desc(renderJobs.createdAt))
      .limit(30);

    res.json({
      jobs,
      storage: {
        usedBytes: dbUser.storageUsedBytes,
        quotaBytes: dbUser.storageQuotaBytes,
      },
    });
  } catch (error) {
    console.error('Error fetching project renders:', error);
    res.status(500).json({ error: 'خطا در دریافت وضعیت رندرهای پروژه.' });
  }
});

renderRouter.post('/projects/:projectId/renders', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const projectId = Number(req.params.projectId);

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, dbUser.id)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    if (dbUser.storageUsedBytes >= dbUser.storageQuotaBytes) {
      res.status(413).json({
        error: 'سقف فضای ذخیره‌سازی حساب شما پر شده است. ابتدا بخشی از خروجی‌ها یا فایل‌ها را حذف کنید.',
      });
      return;
    }

    const rawFormat = String(req.body?.format || 'mp4').toLowerCase() as RenderFormat;
    const rawQuality = String(req.body?.quality || project.outputQuality || '1080p').toLowerCase() as RenderQuality;
    const rawFps = Number(req.body?.fps ?? 30);

    const format: RenderFormat = ALLOWED_FORMATS.includes(rawFormat) ? rawFormat : 'mp4';
    const quality: RenderQuality = ALLOWED_QUALITIES.includes(rawQuality) ? rawQuality : '1080p';
    const fps = Number.isFinite(rawFps) ? Math.max(12, Math.min(60, Math.round(rawFps))) : 30;

    const [job] = await db
      .insert(renderJobs)
      .values({
        projectId,
        userId: dbUser.id,
        format,
        quality,
        fps,
        status: 'queued',
        progressPercent: 0,
      })
      .returning();

    await db
      .update(projects)
      .set({ status: 'rendering', updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    const resolution = computeRenderResolution(project.customWidth, project.customHeight, quality);

    await logActivity(
      dbUser.id,
      'render.queued',
      `رندر ${format.toUpperCase()} (${quality}) برای «${project.title}» در صف قرار گرفت`,
      projectId,
      { jobId: job.id, format, quality, fps, resolution }
    );

    studioWsHub.emitToUser(dbUser.id, 'render:queued', {
      jobId: job.id,
      projectId,
      format,
      quality,
      fps,
    });

    if (req.body?.sync !== true) {
      startRenderJobInBackground(job.id);
    }

    res.status(202).json({
      job,
      resolution,
    });
  } catch (error) {
    console.error('Error queueing render job:', error);
    res.status(500).json({ error: 'خطا در ثبت درخواست رندر.' });
  }
});

renderRouter.post('/renders/:jobId/cancel', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const jobId = Number(req.params.jobId);

    const [job] = await db
      .select()
      .from(renderJobs)
      .where(and(eq(renderJobs.id, jobId), eq(renderJobs.userId, dbUser.id)))
      .limit(1);

    if (!job) {
      res.status(404).json({ error: 'پردازش رندر یافت نشد.' });
      return;
    }

    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
      res.json({ job });
      return;
    }

    signalRenderJobCancellation(jobId);

    const [updated] = await db
      .update(renderJobs)
      .set({
        status: 'cancelled',
        errorMessage: 'توسط کاربر لغو شد.',
        updatedAt: new Date(),
      })
      .where(eq(renderJobs.id, jobId))
      .returning();

    await db
      .update(projects)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(eq(projects.id, job.projectId));

    studioWsHub.emitToUser(dbUser.id, 'render:cancelled', {
      jobId,
      projectId: job.projectId,
    });

    res.json({ job: updated });
  } catch (error) {
    console.error('Error cancelling render job:', error);
    res.status(500).json({ error: 'خطا در لغو پردازش رندر.' });
  }
});

renderRouter.post('/renders/:jobId/retry', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const jobId = Number(req.params.jobId);

    const [existing] = await db
      .select()
      .from(renderJobs)
      .where(and(eq(renderJobs.id, jobId), eq(renderJobs.userId, dbUser.id)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'رندر قبلی یافت نشد.' });
      return;
    }

    const [newJob] = await db
      .insert(renderJobs)
      .values({
        projectId: existing.projectId,
        userId: dbUser.id,
        format: existing.format,
        quality: existing.quality,
        fps: existing.fps,
        status: 'queued',
        progressPercent: 0,
      })
      .returning();

    await db
      .update(projects)
      .set({ status: 'rendering', updatedAt: new Date() })
      .where(eq(projects.id, existing.projectId));

    studioWsHub.emitToUser(dbUser.id, 'render:queued', {
      jobId: newJob.id,
      projectId: existing.projectId,
      format: newJob.format,
      quality: newJob.quality,
      fps: newJob.fps,
    });

    startRenderJobInBackground(newJob.id);

    res.status(202).json({ job: newJob });
  } catch (error) {
    console.error('Error retrying render job:', error);
    res.status(500).json({ error: 'خطا در اجرای مجدد رندر.' });
  }
});

renderRouter.get('/renders/:jobId/download', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const jobId = Number(req.params.jobId);

    const [job] = await db
      .select()
      .from(renderJobs)
      .where(and(eq(renderJobs.id, jobId), eq(renderJobs.userId, dbUser.id)))
      .limit(1);

    if (!job || job.status !== 'completed' || !job.outputPath) {
      res.status(404).json({ error: 'فایل خروجی آماده یا موجود نیست.' });
      return;
    }

    const fullPath = resolveSafeUserPath(EXPORTS_DIR, job.outputPath);
    const info = DOWNLOAD_MIME_MAP[job.format] ?? {
      mime: 'application/octet-stream',
      ext: job.format,
    };

    res.setHeader('Content-Type', info.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="motion-studio-render-${job.id}.${info.ext}"`
    );
    await sendFileSafely(res, fullPath, 'فایل خروجی روی دیسک یافت نشد.');
  } catch (error) {
    console.error('Error downloading render output:', error);
    res.status(500).json({ error: 'خطا در دانلود فایل خروجی.' });
  }
});

renderRouter.delete('/renders/:jobId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const jobId = Number(req.params.jobId);
    const confirmed = req.query.confirm === 'true' || req.body?.confirm === true;

    if (!confirmed) {
      res.status(400).json({ error: 'برای حذف خروجی رندر، تأیید صریح الزامی است.' });
      return;
    }

    const [existing] = await db
      .select()
      .from(renderJobs)
      .where(and(eq(renderJobs.id, jobId), eq(renderJobs.userId, dbUser.id)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'خروجی رندر یافت نشد.' });
      return;
    }

    if (existing.status === 'processing' || existing.status === 'queued') {
      signalRenderJobCancellation(jobId);
    }

    await db
      .delete(renderJobs)
      .where(and(eq(renderJobs.id, jobId), eq(renderJobs.userId, dbUser.id)));

    if (existing.outputPath) {
      try {
        const fullPath = resolveSafeUserPath(EXPORTS_DIR, existing.outputPath);
        await fs.rm(fullPath, { force: true });
      } catch {
        // Ignore missing disk artifact
      }
    }

    const freedBytes = Number(existing.outputSizeBytes || 0);
    const [updatedUser] = await db
      .update(users)
      .set({
        storageUsedBytes: sql`GREATEST(0, ${users.storageUsedBytes} - ${freedBytes})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, dbUser.id))
      .returning();

    await logActivity(
      dbUser.id,
      'render.deleted',
      `خروجی رندر #${jobId} (${existing.format.toUpperCase()}) حذف شد`,
      existing.projectId
    );

    res.json({
      deletedId: jobId,
      storage: {
        usedBytes: updatedUser.storageUsedBytes,
        quotaBytes: updatedUser.storageQuotaBytes,
      },
    });
  } catch (error) {
    console.error('Error deleting render output:', error);
    res.status(500).json({ error: 'خطا در حذف خروجی رندر.' });
  }
});
