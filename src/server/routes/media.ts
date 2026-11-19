import { and, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { db } from '../../db/index.ts';
import { mediaAssets, users } from '../../db/schema.ts';
import { logActivity } from '../../db/users.ts';
import type { AuthRequest } from '../../middleware/auth.ts';
import {
  ALLOWED_MEDIA_RULES,
  deleteUserMediaFile,
  MAX_UPLOAD_BYTES,
  resolveSafeUserPath,
  saveUserMediaFile,
  sendFileSafely,
  UPLOADS_DIR,
  validateMagicHeader,
} from '../storage.ts';
import { studioWsHub } from '../ws.ts';

export const mediaRouter = Router();

const SAFE_FILE_SIZE_LIMIT =
  Number.isSafeInteger(MAX_UPLOAD_BYTES) && MAX_UPLOAD_BYTES > 0
    ? MAX_UPLOAD_BYTES
    : 100 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: SAFE_FILE_SIZE_LIMIT,
    files: 1,
  },
});

mediaRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const assets = await db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.userId, dbUser.id))
      .orderBy(desc(mediaAssets.createdAt));

    res.json({
      assets,
      storage: {
        usedBytes: dbUser.storageUsedBytes,
        quotaBytes: dbUser.storageQuotaBytes,
        maxUploadBytes: SAFE_FILE_SIZE_LIMIT,
      },
    });
  } catch (error) {
    console.error('Error fetching media assets:', error);
    res.status(500).json({ error: 'خطا در دریافت کتابخانه رسانه.' });
  }
});

mediaRouter.post('/upload', upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'هیچ فایلی ارسال نشده است.' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const rule = ALLOWED_MEDIA_RULES[ext === 'jpeg' ? 'jpg' : ext];
    if (!rule) {
      res.status(400).json({
        error: `فرمت .${ext || 'نامشخص'} پشتیبانی نمی‌شود. فرمت‌های مجاز: PNG, JPG, WEBP, SVG, MP4, MOV, WebM, MP3, WAV, TTF, OTF, WOFF2`,
      });
      return;
    }

    const magicCheck = validateMagicHeader(file.buffer, ext);
    if (!magicCheck.valid) {
      res.status(400).json({ error: magicCheck.reason || 'ساختار فایل معتبر نیست.' });
      return;
    }

    if (dbUser.storageUsedBytes + file.size > dbUser.storageQuotaBytes) {
      res.status(413).json({
        error: 'فضای ذخیره‌سازی حساب شما کافی نیست. لطفاً فایل‌های غیرضروری را آزاد کنید.',
      });
      return;
    }

    const requestedCategory =
      typeof req.body?.category === 'string' && req.body.category.trim()
        ? req.body.category.trim()
        : rule.categoryDefault;

    const projectId =
      req.body?.projectId && Number.isInteger(Number(req.body.projectId))
        ? Number(req.body.projectId)
        : null;

    const parsedWidth = Number.parseInt(String(req.body?.width ?? ''), 10);
    const parsedHeight = Number.parseInt(String(req.body?.height ?? ''), 10);
    const parsedDurationMs = Number.parseInt(String(req.body?.durationMs ?? ''), 10);

    const saved = await saveUserMediaFile(dbUser.id, file.originalname, file.buffer);

    const [asset] = await db
      .insert(mediaAssets)
      .values({
        userId: dbUser.id,
        projectId,
        originalName: file.originalname,
        displayName: file.originalname,
        category: requestedCategory,
        mimeType: file.mimetype || rule.mimeTypes[0],
        extension: saved.extension,
        sizeBytes: file.size,
        storageKey: saved.storageKey,
        sha256Hash: saved.sha256Hash,
        width: Number.isFinite(parsedWidth) && parsedWidth > 0 ? parsedWidth : null,
        height: Number.isFinite(parsedHeight) && parsedHeight > 0 ? parsedHeight : null,
        durationMs:
          Number.isFinite(parsedDurationMs) && parsedDurationMs > 0 ? parsedDurationMs : null,
        isProtectedOriginal: true,
        metadata: {},
      })
      .returning();

    const [updatedUser] = await db
      .update(users)
      .set({
        storageUsedBytes: sql`${users.storageUsedBytes} + ${file.size}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, dbUser.id))
      .returning();

    await logActivity(
      dbUser.id,
      'media.uploaded',
      `فایل «${asset.displayName}» در کتابخانه ذخیره شد`,
      projectId,
      { assetId: asset.id, sizeBytes: asset.sizeBytes }
    );

    studioWsHub.emitToUser(dbUser.id, 'media:uploaded', {
      asset,
      storageUsedBytes: updatedUser.storageUsedBytes,
    });

    res.status(201).json({
      asset,
      storage: {
        usedBytes: updatedUser.storageUsedBytes,
        quotaBytes: updatedUser.storageQuotaBytes,
      },
    });
  } catch (error) {
    console.error('Error uploading media asset:', error);
    res.status(500).json({ error: 'خطا در ذخیره‌سازی فایل.' });
  }
});

mediaRouter.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const assetId = Number(req.params.id);
    const { displayName, category, projectId } = req.body ?? {};

    const updates: Partial<typeof mediaAssets.$inferInsert> = {};
    if (typeof displayName === 'string' && displayName.trim().length > 0) {
      updates.displayName = displayName.trim();
    }
    if (typeof category === 'string' && category.trim().length > 0) {
      updates.category = category.trim();
    }
    if (projectId === null) {
      updates.projectId = null;
    } else if (typeof projectId === 'number' && Number.isInteger(projectId) && projectId > 0) {
      updates.projectId = projectId;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'مقداری برای بروزرسانی ارسال نشده است.' });
      return;
    }

    const [updated] = await db
      .update(mediaAssets)
      .set(updates)
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.userId, userId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'فایل مورد نظر یافت نشد.' });
      return;
    }

    res.json({ asset: updated });
  } catch (error) {
    console.error('Error updating media asset:', error);
    res.status(500).json({ error: 'خطا در بروزرسانی مشخصات فایل.' });
  }
});

mediaRouter.get('/:id/file', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const assetId = Number(req.params.id);

    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.userId, userId)))
      .limit(1);

    if (!asset) {
      res.status(404).json({ error: 'فایل یافت نشد.' });
      return;
    }

    const fullPath = resolveSafeUserPath(UPLOADS_DIR, asset.storageKey);
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await sendFileSafely(res, fullPath, 'فایل رسانه روی دیسک سرور یافت نشد.');
  } catch (error) {
    console.error('Error streaming media asset:', error);
    res.status(500).json({ error: 'خطا در بازیابی فایل.' });
  }
});

mediaRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const dbUser = req.dbUser!;
    const assetId = Number(req.params.id);
    const confirmed = req.query.confirm === 'true' || req.body?.confirm === true;

    if (!confirmed) {
      res.status(400).json({
        error: 'فایل‌های اصلی محافظت‌شده هستند. برای حذف، تأیید صریح الزامی است.',
      });
      return;
    }

    const [deleted] = await db
      .delete(mediaAssets)
      .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.userId, dbUser.id)))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'فایل مورد نظر یافت نشد.' });
      return;
    }

    await deleteUserMediaFile(deleted.storageKey);

    const [updatedUser] = await db
      .update(users)
      .set({
        storageUsedBytes: sql`GREATEST(0, ${users.storageUsedBytes} - ${deleted.sizeBytes})`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, dbUser.id))
      .returning();

    await logActivity(dbUser.id, 'media.deleted', `فایل «${deleted.displayName}» حذف شد`);

    res.json({
      deletedId: assetId,
      storage: {
        usedBytes: updatedUser.storageUsedBytes,
        quotaBytes: updatedUser.storageQuotaBytes,
      },
    });
  } catch (error) {
    console.error('Error deleting media asset:', error);
    res.status(500).json({ error: 'خطا در حذف فایل.' });
  }
});
