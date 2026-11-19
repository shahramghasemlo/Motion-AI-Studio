import fs from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../../db/index.ts';
import {
  mediaAssets,
  projects,
  referenceScenes,
  referenceVideos,
  users,
} from '../../db/schema.ts';
import { logActivity } from '../../db/users.ts';
import { requireAuth, type AuthRequest } from '../../middleware/auth.ts';
import {
  FRAMES_DIR,
  MAX_UPLOAD_BYTES,
  resolveSafeUserPath,
  saveUserMediaFile,
  sendFileSafely,
  UPLOADS_DIR,
  validateMagicHeader,
} from '../storage.ts';
import {
  analyzeCreativeBriefJob,
  analyzeReferenceVideoJob,
  type BriefImageInput,
} from '../videoAnalyzer.ts';
import { downloadDirectVideoUrl, inspectVideoLink } from '../videoIngestion.ts';

export const analysisRouter = Router();

const SAFE_VIDEO_LIMIT =
  Number.isSafeInteger(MAX_UPLOAD_BYTES) && MAX_UPLOAD_BYTES > 0
    ? MAX_UPLOAD_BYTES
    : 100 * 1024 * 1024;

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SAFE_VIDEO_LIMIT, files: 1 },
});

const uploadBriefImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SAFE_VIDEO_LIMIT, files: 6 },
});

const ALLOWED_VIDEO_EXTS = new Set(['mp4', 'mov', 'webm']);
const ALLOWED_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);

analysisRouter.get('/projects/:projectId/references', requireAuth, async (req: AuthRequest, res) => {
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

    const refs = await db
      .select()
      .from(referenceVideos)
      .where(and(eq(referenceVideos.projectId, projectId), eq(referenceVideos.userId, userId)))
      .orderBy(desc(referenceVideos.createdAt));

    const enriched = await Promise.all(
      refs.map(async (ref) => {
        const scenes = await db
          .select()
          .from(referenceScenes)
          .where(eq(referenceScenes.referenceVideoId, ref.id))
          .orderBy(asc(referenceScenes.sceneNumber));
        return { ...ref, scenes };
      })
    );

    res.json({ references: enriched });
  } catch (error) {
    console.error('Error fetching reference analyses:', error);
    res.status(500).json({ error: 'خطا در دریافت گزارش‌های تحلیل ویدئو.' });
  }
});

analysisRouter.post('/projects/:projectId/references/check-link', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const projectId = Number(req.params.projectId);
    const { url } = req.body ?? {};

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'لطفاً لینک ویدئو را وارد کنید.' });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, dbUser.id)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const inspection = await inspectVideoLink(url);

    if (inspection.accessStatus !== 'accessible') {
      const [refRecord] = await db
        .insert(referenceVideos)
        .values({
          userId: dbUser.id,
          projectId,
          sourceType: 'url',
          sourceUrl: inspection.url,
          platform: inspection.platform,
          accessStatus: inspection.accessStatus,
          accessMessage: inspection.accessMessage,
          analysisStatus: 'failed',
          analysisError: inspection.accessMessage,
          overallSummary: inspection.titlePreview
            ? { detectedTitle: inspection.titlePreview }
            : null,
        })
        .returning();

      res.status(200).json({
        inspection,
        reference: { ...refRecord, scenes: [] },
      });
      return;
    }

    // Accessible direct MP4/MOV/WebM URL: download, validate magic header, save & analyze
    const downloaded = await downloadDirectVideoUrl(inspection.url);
    if (dbUser.storageUsedBytes + downloaded.buffer.length > dbUser.storageQuotaBytes) {
      res.status(413).json({ error: 'فضای ذخیره‌سازی حساب شما کافی نیست.' });
      return;
    }

    const saved = await saveUserMediaFile(dbUser.id, downloaded.filename, downloaded.buffer);
    const [asset] = await db
      .insert(mediaAssets)
      .values({
        userId: dbUser.id,
        projectId,
        originalName: downloaded.filename,
        displayName: downloaded.filename,
        category: 'reference_video',
        mimeType: downloaded.mimeType,
        extension: saved.extension,
        sizeBytes: downloaded.buffer.length,
        storageKey: saved.storageKey,
        sha256Hash: saved.sha256Hash,
        isProtectedOriginal: true,
        metadata: { sourceUrl: inspection.url },
      })
      .returning();

    await db
      .update(users)
      .set({
        storageUsedBytes: sql`${users.storageUsedBytes} + ${downloaded.buffer.length}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, dbUser.id));

    const [refRecord] = await db
      .insert(referenceVideos)
      .values({
        userId: dbUser.id,
        projectId,
        sourceType: 'url',
        sourceUrl: inspection.url,
        platform: 'direct_video',
        accessStatus: 'accessible',
        accessMessage: inspection.accessMessage,
        mediaAssetId: asset.id,
        analysisStatus: 'pending',
      })
      .returning();

    const fullVideoPath = resolveSafeUserPath(UPLOADS_DIR, saved.storageKey);
    setImmediate(() => {
      void analyzeReferenceVideoJob(
        refRecord.id,
        dbUser.id,
        projectId,
        fullVideoPath,
        project.language === 'en' ? 'en' : 'fa'
      );
    });

    res.status(202).json({
      inspection,
      reference: { ...refRecord, scenes: [] },
    });
  } catch (error) {
    console.error('Error checking reference link:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'خطا در بررسی لینک ویدئو.',
    });
  }
});

analysisRouter.post(
  '/projects/:projectId/references/upload',
  requireAuth,
  uploadVideo.single('file'),
  async (req: AuthRequest, res) => {
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

      let assetRecord: typeof mediaAssets.$inferSelect | null = null;

      if (req.body?.mediaAssetId) {
        const assetId = Number(req.body.mediaAssetId);
        const [existingAsset] = await db
          .select()
          .from(mediaAssets)
          .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.userId, dbUser.id)))
          .limit(1);

        if (!existingAsset || !ALLOWED_VIDEO_EXTS.has(existingAsset.extension.toLowerCase())) {
          res.status(400).json({ error: 'فایل ویدئویی انتخاب‌شده معتبر نیست.' });
          return;
        }
        assetRecord = existingAsset;
      } else {
        const file = req.file;
        if (!file) {
          res.status(400).json({ error: 'هیچ فایل ویدئویی ارسال نشده است.' });
          return;
        }

        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        if (!ALLOWED_VIDEO_EXTS.has(ext)) {
          res.status(400).json({
            error: 'فقط فرمت‌های ویدئویی MP4، MOV و WebM برای تحلیل پشتیبانی می‌شوند.',
          });
          return;
        }

        const magic = validateMagicHeader(file.buffer, ext);
        if (!magic.valid) {
          res.status(400).json({ error: magic.reason || 'ساختار فایل ویدئو معتبر نیست.' });
          return;
        }

        if (dbUser.storageUsedBytes + file.size > dbUser.storageQuotaBytes) {
          res.status(413).json({ error: 'فضای ذخیره‌سازی حساب شما کافی نیست.' });
          return;
        }

        const saved = await saveUserMediaFile(dbUser.id, file.originalname, file.buffer);
        const [insertedAsset] = await db
          .insert(mediaAssets)
          .values({
            userId: dbUser.id,
            projectId,
            originalName: file.originalname,
            displayName: file.originalname,
            category: 'reference_video',
            mimeType: file.mimetype || 'video/mp4',
            extension: saved.extension,
            sizeBytes: file.size,
            storageKey: saved.storageKey,
            sha256Hash: saved.sha256Hash,
            isProtectedOriginal: true,
            metadata: {},
          })
          .returning();

        await db
          .update(users)
          .set({
            storageUsedBytes: sql`${users.storageUsedBytes} + ${file.size}`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, dbUser.id));

        assetRecord = insertedAsset;
      }

      const [refRecord] = await db
        .insert(referenceVideos)
        .values({
          userId: dbUser.id,
          projectId,
          sourceType: 'upload',
          platform: 'local',
          accessStatus: 'accessible',
          accessMessage: 'فایل ویدئویی با موفقیت دریافت شد و در صف تحلیل قرار گرفت.',
          mediaAssetId: assetRecord.id,
          analysisStatus: 'pending',
        })
        .returning();

      await logActivity(
        dbUser.id,
        'reference.uploaded',
        `ویدئوی نمونه «${assetRecord.displayName}» برای تحلیل ثبت شد`,
        projectId
      );

      const fullVideoPath = resolveSafeUserPath(UPLOADS_DIR, assetRecord.storageKey);
      setImmediate(() => {
        void analyzeReferenceVideoJob(
          refRecord.id,
          dbUser.id,
          projectId,
          fullVideoPath,
          project.language === 'en' ? 'en' : 'fa'
        );
      });

      res.status(202).json({
        reference: { ...refRecord, scenes: [] },
      });
    } catch (error) {
      console.error('Error uploading reference video:', error);
      res.status(500).json({ error: 'خطا در دریافت و آغاز تحلیل ویدئوی نمونه.' });
    }
  }
);

analysisRouter.post(
  '/projects/:projectId/references/brief',
  requireAuth,
  uploadBriefImages.array('files', 6),
  async (req: AuthRequest, res) => {
    try {
      const dbUser = req.dbUser!;
      const projectId = Number(req.params.projectId);
      const description =
        typeof req.body?.description === 'string' ? req.body.description.trim() : '';

      const [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, dbUser.id)))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      let libraryIds: number[] = [];
      if (typeof req.body?.mediaAssetIds === 'string' && req.body.mediaAssetIds.trim()) {
        try {
          const parsed = JSON.parse(req.body.mediaAssetIds);
          if (Array.isArray(parsed)) {
            libraryIds = parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0);
          }
        } catch {
          libraryIds = req.body.mediaAssetIds
            .split(',')
            .map((v: string) => Number(v.trim()))
            .filter((n: number) => Number.isInteger(n) && n > 0);
        }
      } else if (Array.isArray(req.body?.mediaAssetIds)) {
        libraryIds = req.body.mediaAssetIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
      }

      if (!description && uploadedFiles.length === 0 && libraryIds.length === 0) {
        res.status(400).json({
          error: 'لطفاً حداقل یک توضیح متنی یا یک تصویر مرجع برای طراحی استوری‌بورد وارد کنید.',
        });
        return;
      }

      const briefImages: BriefImageInput[] = [];

      // Validate and persist newly uploaded images
      let incomingTotalBytes = 0;
      for (const file of uploadedFiles) {
        const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
        if (!ALLOWED_IMAGE_EXTS.has(ext)) {
          res.status(400).json({
            error: `فرمت تصویر «${file.originalname}» پشتیبانی نمی‌شود. از PNG، JPG یا WebP استفاده کنید.`,
          });
          return;
        }
        const magic = validateMagicHeader(file.buffer, ext);
        if (!magic.valid) {
          res.status(400).json({
            error: magic.reason || `ساختار تصویر «${file.originalname}» معتبر نیست.`,
          });
          return;
        }
        incomingTotalBytes += file.size;
      }

      if (dbUser.storageUsedBytes + incomingTotalBytes > dbUser.storageQuotaBytes) {
        res.status(413).json({ error: 'فضای ذخیره‌سازی حساب شما کافی نیست.' });
        return;
      }

      for (const file of uploadedFiles) {
        const saved = await saveUserMediaFile(dbUser.id, file.originalname, file.buffer);
        const [insertedAsset] = await db
          .insert(mediaAssets)
          .values({
            userId: dbUser.id,
            projectId,
            originalName: file.originalname,
            displayName: file.originalname,
            category: 'image',
            mimeType: file.mimetype || 'image/png',
            extension: saved.extension,
            sizeBytes: file.size,
            storageKey: saved.storageKey,
            sha256Hash: saved.sha256Hash,
            isProtectedOriginal: true,
            metadata: { role: 'reference_brief_image' },
          })
          .returning();

        briefImages.push({
          assetId: insertedAsset.id,
          filePath: resolveSafeUserPath(UPLOADS_DIR, saved.storageKey),
          mimeType: insertedAsset.mimeType,
          displayName: insertedAsset.displayName,
        });
      }

      if (incomingTotalBytes > 0) {
        await db
          .update(users)
          .set({
            storageUsedBytes: sql`${users.storageUsedBytes} + ${incomingTotalBytes}`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, dbUser.id));
      }

      // Attach existing Media Library images if selected
      for (const assetId of libraryIds.slice(0, 6 - briefImages.length)) {
        const [existingAsset] = await db
          .select()
          .from(mediaAssets)
          .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.userId, dbUser.id)))
          .limit(1);
        if (existingAsset && ALLOWED_IMAGE_EXTS.has(existingAsset.extension.toLowerCase())) {
          briefImages.push({
            assetId: existingAsset.id,
            filePath: resolveSafeUserPath(UPLOADS_DIR, existingAsset.storageKey),
            mimeType: existingAsset.mimeType,
            displayName: existingAsset.displayName,
          });
        }
      }

      const [refRecord] = await db
        .insert(referenceVideos)
        .values({
          userId: dbUser.id,
          projectId,
          sourceType: 'brief_images',
          platform: briefImages.length > 0 ? 'image_brief' : 'text_brief',
          accessStatus: 'accessible',
          accessMessage: 'توضیحات و تصاویر مرجع دریافت شد و طراحی استوری‌بورد آغاز گردید.',
          mediaAssetId: briefImages[0]?.assetId ?? null,
          width: project.customWidth,
          height: project.customHeight,
          durationMs: project.durationSeconds * 1000,
          fps: '30',
          hasAudio: false,
          analysisStatus: 'pending',
          overallSummary: {
            inputBrief: description,
            inputAssetIds: briefImages.map((img) => img.assetId),
          },
        })
        .returning();

      await logActivity(
        dbUser.id,
        'reference.brief_submitted',
        `ورودی بدون ویدئو (${briefImages.length} تصویر و توضیحات) برای طراحی استوری‌بورد ثبت شد`,
        projectId
      );

      setImmediate(() => {
        void analyzeCreativeBriefJob(refRecord.id, dbUser.id, projectId, {
          description,
          images: briefImages,
          projectContext: {
            title: project.title,
            topic: project.topic,
            businessName: project.businessName,
            productType: project.productType,
            targetAudience: project.targetAudience,
            designStyle: project.designStyle,
            durationSeconds: project.durationSeconds,
            aspectRatio: project.aspectRatio,
          },
          language: project.language === 'en' ? 'en' : 'fa',
        });
      });

      res.status(202).json({
        reference: { ...refRecord, scenes: [] },
      });
    } catch (error) {
      console.error('Error creating creative brief reference:', error);
      res.status(500).json({ error: 'خطا در ثبت توضیحات و تصاویر مرجع.' });
    }
  }
);

analysisRouter.post('/projects/:projectId/references/:refId/reanalyze', requireAuth, async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const projectId = Number(req.params.projectId);
    const refId = Number(req.params.refId);

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, dbUser.id)))
      .limit(1);

    const [refRecord] = await db
      .select()
      .from(referenceVideos)
      .where(
        and(
          eq(referenceVideos.id, refId),
          eq(referenceVideos.projectId, projectId),
          eq(referenceVideos.userId, dbUser.id)
        )
      )
      .limit(1);

    if (!project || !refRecord) {
      res.status(404).json({ error: 'گزارش مرجع یافت نشد.' });
      return;
    }

    if (refRecord.sourceType === 'brief_images') {
      const summary = (refRecord.overallSummary ?? {}) as {
        inputBrief?: string;
        inputAssetIds?: number[];
      };
      const assetIds = Array.isArray(summary.inputAssetIds) ? summary.inputAssetIds : [];
      const briefImages: BriefImageInput[] = [];
      for (const assetId of assetIds) {
        const [asset] = await db
          .select()
          .from(mediaAssets)
          .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.userId, dbUser.id)))
          .limit(1);
        if (asset) {
          briefImages.push({
            assetId: asset.id,
            filePath: resolveSafeUserPath(UPLOADS_DIR, asset.storageKey),
            mimeType: asset.mimeType,
            displayName: asset.displayName,
          });
        }
      }

      setImmediate(() => {
        void analyzeCreativeBriefJob(refRecord.id, dbUser.id, projectId, {
          description: summary.inputBrief || '',
          images: briefImages,
          projectContext: {
            title: project.title,
            topic: project.topic,
            businessName: project.businessName,
            productType: project.productType,
            targetAudience: project.targetAudience,
            designStyle: project.designStyle,
            durationSeconds: project.durationSeconds,
            aspectRatio: project.aspectRatio,
          },
          language: project.language === 'en' ? 'en' : 'fa',
        });
      });

      res.status(202).json({ status: 'reanalyzing' });
      return;
    }

    if (!refRecord.mediaAssetId) {
      res.status(404).json({ error: 'ویدئوی نمونه قابل تحلیل یافت نشد.' });
      return;
    }

    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, refRecord.mediaAssetId), eq(mediaAssets.userId, dbUser.id)))
      .limit(1);

    if (!asset) {
      res.status(404).json({ error: 'فایل اصلی ویدئو یافت نشد.' });
      return;
    }

    const fullVideoPath = resolveSafeUserPath(UPLOADS_DIR, asset.storageKey);
    setImmediate(() => {
      void analyzeReferenceVideoJob(
        refRecord.id,
        dbUser.id,
        projectId,
        fullVideoPath,
        project.language === 'en' ? 'en' : 'fa'
      );
    });

    res.status(202).json({ status: 'reanalyzing' });
  } catch (error) {
    console.error('Error reanalyzing reference video:', error);
    res.status(500).json({ error: 'خطا در تحلیل مجدد.' });
  }
});

analysisRouter.get('/references/:refId/scenes/:sceneId/frame', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const refId = Number(req.params.refId);
    const sceneId = Number(req.params.sceneId);

    const [refRecord] = await db
      .select()
      .from(referenceVideos)
      .where(and(eq(referenceVideos.id, refId), eq(referenceVideos.userId, userId)))
      .limit(1);

    if (!refRecord) {
      res.status(404).json({ error: 'دسترسی غیرمجاز یا ویدئو یافت نشد.' });
      return;
    }

    const [scene] = await db
      .select()
      .from(referenceScenes)
      .where(
        and(
          eq(referenceScenes.id, sceneId),
          eq(referenceScenes.referenceVideoId, refId)
        )
      )
      .limit(1);

    if (!scene || !scene.frameStorageKey) {
      res.status(404).json({ error: 'فریم صحنه یافت نشد.' });
      return;
    }

    const fullPath = resolveSafeUserPath(FRAMES_DIR, scene.frameStorageKey);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await sendFileSafely(res, fullPath, 'تصویر فریم صحنه روی دیسک یافت نشد.');
  } catch (error) {
    console.error('Error streaming keyframe:', error);
    res.status(500).json({ error: 'خطا در نمایش تصویر صحنه.' });
  }
});

analysisRouter.delete('/references/:refId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const refId = Number(req.params.refId);
    const confirmed = req.query.confirm === 'true' || req.body?.confirm === true;

    if (!confirmed) {
      res.status(400).json({ error: 'تأیید صریح برای حذف گزارش تحلیل الزامی است.' });
      return;
    }

    const [deleted] = await db
      .delete(referenceVideos)
      .where(and(eq(referenceVideos.id, refId), eq(referenceVideos.userId, userId)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'گزارش تحلیل یافت نشد.' });
      return;
    }

    const frameFolder = resolveSafeUserPath(
      FRAMES_DIR,
      path.join(`user_${userId}`, `ref_${refId}`)
    );
    await fs.rm(frameFolder, { recursive: true, force: true });

    res.json({ deletedId: refId });
  } catch (error) {
    console.error('Error deleting reference analysis:', error);
    res.status(500).json({ error: 'خطا در حذف گزارش تحلیل.' });
  }
});
