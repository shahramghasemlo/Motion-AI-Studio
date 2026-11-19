import 'dotenv/config';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { desc, eq, sql } from 'drizzle-orm';
import express from 'express';
import multer from 'multer';
import { db } from './src/db/index.ts';
import { activityLogs } from './src/db/schema.ts';
import { updateUserPreferences } from './src/db/users.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import { isGeminiConfigured } from './src/server/gemini.ts';
import { analysisRouter } from './src/server/routes/analysis.ts';
import { blueprintRouter } from './src/server/routes/blueprint.ts';
import { dashboardRouter } from './src/server/routes/dashboard.ts';
import { mediaRouter } from './src/server/routes/media.ts';
import { projectsRouter } from './src/server/routes/projects.ts';
import { providersRouter } from './src/server/routes/providers.ts';
import { renderRouter } from './src/server/routes/render.ts';
import { timelineRouter } from './src/server/routes/timeline.ts';
import { ensureStorageDirectories, MAX_UPLOAD_MB } from './src/server/storage.ts';
import { studioWsHub } from './src/server/ws.ts';

const execFileAsync = promisify(execFile);

async function detectFfmpegVersion(): Promise<{ available: boolean; version: string }> {
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version'], { timeout: 2500 });
    const firstLine = stdout.split('\n')[0]?.trim() || 'ffmpeg';
    return { available: true, version: firstLine };
  } catch {
    return { available: false, version: 'unavailable' };
  }
}

export async function createStudioServer() {
  await ensureStorageDirectories();

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', async (req, res) => {
    const ffmpeg = await detectFfmpegVersion();
    let databaseStatus: 'ready' | 'untested' | 'error' = 'untested';

    if (req.query.checkDb === '1') {
      try {
        await db.execute(sql`SELECT 1`);
        databaseStatus = 'ready';
      } catch (err) {
        console.error('Database health probe failed:', err);
        databaseStatus = 'error';
      }
    }

    res.json({
      status: 'ok',
      service: 'Motion AI Studio',
      phase: 1,
      uptimeSeconds: Math.floor(process.uptime()),
      capabilities: {
        ffmpegAvailable: ffmpeg.available,
        ffmpegVersion: ffmpeg.version,
        geminiConfigured: isGeminiConfigured(),
        websocketClients: studioWsHub.getConnectedCount(),
        maxUploadMb: MAX_UPLOAD_MB,
        databaseStatus,
      },
    });
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    const dbUser = req.dbUser!;
    res.json({
      user: {
        id: dbUser.id,
        uid: dbUser.uid,
        email: dbUser.email,
        displayName: dbUser.displayName,
        avatarUrl: dbUser.avatarUrl,
        role: dbUser.role,
        storageQuotaBytes: dbUser.storageQuotaBytes,
        storageUsedBytes: dbUser.storageUsedBytes,
        preferredLocale: dbUser.preferredLocale,
        preferredTheme: dbUser.preferredTheme,
        createdAt: dbUser.createdAt,
      },
    });
  });

  app.patch('/api/auth/preferences', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const { preferredLocale, preferredTheme } = req.body ?? {};
      const updated = await updateUserPreferences(dbUser.id, {
        preferredLocale:
          preferredLocale === 'fa' || preferredLocale === 'en' ? preferredLocale : undefined,
        preferredTheme:
          preferredTheme === 'dark' || preferredTheme === 'light' ? preferredTheme : undefined,
      });
      res.json({
        preferredLocale: updated.preferredLocale,
        preferredTheme: updated.preferredTheme,
      });
    } catch (error) {
      console.error('Error updating preferences:', error);
      res.status(500).json({ error: 'خطا در ذخیره تنظیمات کاربری.' });
    }
  });

  app.get('/api/activity', requireAuth, async (req: AuthRequest, res) => {
    try {
      const logs = await db
        .select()
        .from(activityLogs)
        .where(eq(activityLogs.userId, req.dbUser!.id))
        .orderBy(desc(activityLogs.createdAt))
        .limit(20);
      res.json({ logs });
    } catch (error) {
      console.error('Error fetching activity logs:', error);
      res.status(500).json({ error: 'خطا در دریافت گزارش فعالیت‌ها.' });
    }
  });

  app.use('/api/dashboard', requireAuth, dashboardRouter);
  app.use('/api/projects', requireAuth, projectsRouter);
  app.use('/api/media', requireAuth, mediaRouter);
  app.use('/api/providers', requireAuth, providersRouter);
  app.use('/api', analysisRouter);
  app.use('/api', blueprintRouter);
  app.use('/api', timelineRouter);
  app.use('/api', renderRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'مسیر API مورد نظر یافت نشد.' });
  });

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({
            error: `حجم فایل از سقف مجاز (${MAX_UPLOAD_MB} مگابایت) بیشتر است.`,
          });
          return;
        }
        res.status(400).json({ error: `خطای آپلود: ${err.message}` });
        return;
      }
      console.error('Unhandled server error:', err);
      res.status(500).json({ error: 'خطای داخلی سرور رخ داد.' });
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', async (_req, res) => {
      const html = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    });
  }

  return app;
}

const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('server.ts');

if (isMainModule) {
  const PORT = Number(process.env.PORT || 3000);
  createStudioServer()
    .then((app) => {
      const server = http.createServer(app);
      studioWsHub.attach(server);
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`Motion AI Studio server listening on http://0.0.0.0:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start Motion AI Studio server:', err);
      process.exit(1);
    });
}
