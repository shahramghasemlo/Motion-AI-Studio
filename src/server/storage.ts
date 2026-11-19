import type { Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const STORAGE_ROOT = path.resolve(
  process.cwd(),
  process.env.STORAGE_ROOT || './storage'
);
export const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
export const FRAMES_DIR = path.join(STORAGE_ROOT, 'frames');
export const TEMP_DIR = path.join(STORAGE_ROOT, 'temp');
export const EXPORTS_DIR = path.join(STORAGE_ROOT, 'exports');
export const BACKUPS_DIR = path.join(STORAGE_ROOT, 'backups');

const parsedUploadMb = Number.parseInt(
  String(process.env.MAX_UPLOAD_MB ?? '100').trim(),
  10
);
export const MAX_UPLOAD_MB =
  Number.isFinite(parsedUploadMb) && parsedUploadMb > 0 ? parsedUploadMb : 100;
export const MAX_UPLOAD_BYTES = Math.floor(MAX_UPLOAD_MB * 1024 * 1024);

export interface AllowedFileRule {
  extensions: string[];
  mimeTypes: string[];
  categoryDefault: string;
}

export const ALLOWED_MEDIA_RULES: Record<string, AllowedFileRule> = {
  png: { extensions: ['.png'], mimeTypes: ['image/png'], categoryDefault: 'image' },
  jpg: {
    extensions: ['.jpg', '.jpeg'],
    mimeTypes: ['image/jpeg'],
    categoryDefault: 'image',
  },
  webp: { extensions: ['.webp'], mimeTypes: ['image/webp'], categoryDefault: 'image' },
  svg: { extensions: ['.svg'], mimeTypes: ['image/svg+xml'], categoryDefault: 'graphic' },
  mp4: { extensions: ['.mp4'], mimeTypes: ['video/mp4'], categoryDefault: 'video' },
  mov: {
    extensions: ['.mov'],
    mimeTypes: ['video/quicktime', 'video/mp4'],
    categoryDefault: 'video',
  },
  webm: { extensions: ['.webm'], mimeTypes: ['video/webm'], categoryDefault: 'video' },
  mp3: {
    extensions: ['.mp3'],
    mimeTypes: ['audio/mpeg', 'audio/mp3'],
    categoryDefault: 'music',
  },
  wav: {
    extensions: ['.wav'],
    mimeTypes: ['audio/wav', 'audio/x-wav', 'audio/wave'],
    categoryDefault: 'audio',
  },
  ttf: {
    extensions: ['.ttf'],
    mimeTypes: ['font/ttf', 'application/x-font-ttf', 'application/octet-stream'],
    categoryDefault: 'font',
  },
  otf: {
    extensions: ['.otf'],
    mimeTypes: ['font/otf', 'application/x-font-otf', 'application/octet-stream'],
    categoryDefault: 'font',
  },
  woff2: {
    extensions: ['.woff2'],
    mimeTypes: ['font/woff2', 'application/octet-stream'],
    categoryDefault: 'font',
  },
};

export async function ensureStorageDirectories(): Promise<void> {
  await Promise.all([
    fs.mkdir(UPLOADS_DIR, { recursive: true }),
    fs.mkdir(FRAMES_DIR, { recursive: true }),
    fs.mkdir(TEMP_DIR, { recursive: true }),
    fs.mkdir(EXPORTS_DIR, { recursive: true }),
    fs.mkdir(BACKUPS_DIR, { recursive: true }),
  ]);
}

export function validateMagicHeader(buffer: Buffer, ext: string): { valid: boolean; reason?: string } {
  if (buffer.length < 4) {
    return { valid: false, reason: 'فایل خالی یا خراب است.' };
  }

  const normalized = ext.toLowerCase().replace('.', '');

  if (normalized === 'png') {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.subarray(0, 8).equals(sig)) return { valid: true };
    return { valid: false, reason: 'امضای باینری فایل PNG معتبر نیست.' };
  }

  if (normalized === 'jpg' || normalized === 'jpeg') {
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { valid: true };
    }
    return { valid: false, reason: 'امضای باینری فایل JPEG معتبر نیست.' };
  }

  if (normalized === 'webp') {
    const riff = buffer.subarray(0, 4).toString('ascii') === 'RIFF';
    const webp = buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (riff && webp) return { valid: true };
    return { valid: false, reason: 'امضای باینری فایل WEBP معتبر نیست.' };
  }

  if (normalized === 'svg') {
    const head = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('utf8');
    if (!/<svg[\s>]/i.test(head)) {
      return { valid: false, reason: 'محتوای فایل SVG معتبر نیست.' };
    }
    const fullText = buffer.toString('utf8');
    if (/<script[\s>]/i.test(fullText) || /\son\w+\s*=/i.test(fullText) || /javascript:/i.test(fullText)) {
      return { valid: false, reason: 'فایل SVG حاوی اسکریپت یا کد غیرمجاز است و مسدود شد.' };
    }
    return { valid: true };
  }

  if (normalized === 'mp4' || normalized === 'mov') {
    const boxType = buffer.subarray(4, 8).toString('ascii');
    if (['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(boxType)) {
      return { valid: true };
    }
    return { valid: false, reason: 'ساختار کانتینر ویدئویی MP4/MOV معتبر نیست.' };
  }

  if (normalized === 'webm') {
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return { valid: true };
    }
    return { valid: false, reason: 'امضای باینری فایل WebM معتبر نیست.' };
  }

  if (normalized === 'mp3') {
    const id3 = buffer.subarray(0, 3).toString('ascii') === 'ID3';
    const frameSync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
    if (id3 || frameSync) return { valid: true };
    return { valid: false, reason: 'امضای باینری فایل MP3 معتبر نیست.' };
  }

  if (normalized === 'wav') {
    const riff = buffer.subarray(0, 4).toString('ascii') === 'RIFF';
    const wave = buffer.subarray(8, 12).toString('ascii') === 'WAVE';
    if (riff && wave) return { valid: true };
    return { valid: false, reason: 'امضای باینری فایل WAV معتبر نیست.' };
  }

  if (normalized === 'ttf') {
    const sfnt = buffer.subarray(0, 4);
    const isTrueType =
      (sfnt[0] === 0x00 && sfnt[1] === 0x01 && sfnt[2] === 0x00 && sfnt[3] === 0x00) ||
      sfnt.toString('ascii') === 'true';
    if (isTrueType) return { valid: true };
    return { valid: false, reason: 'فایل فونت TTF معتبر نیست.' };
  }

  if (normalized === 'otf') {
    if (buffer.subarray(0, 4).toString('ascii') === 'OTTO') return { valid: true };
    return { valid: false, reason: 'فایل فونت OTF معتبر نیست.' };
  }

  if (normalized === 'woff2') {
    if (buffer.subarray(0, 4).toString('ascii') === 'wOF2') return { valid: true };
    return { valid: false, reason: 'فایل فونت WOFF2 معتبر نیست.' };
  }

  return { valid: false, reason: 'فرمت فایل پشتیبانی نمی‌شود.' };
}

export function resolveSafeUserPath(baseDir: string, storageKey: string): string {
  const resolved = path.resolve(baseDir, storageKey);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error('Invalid storage path traversal attempt.');
  }
  return resolved;
}

export async function saveUserMediaFile(
  userId: number,
  originalName: string,
  buffer: Buffer
): Promise<{ storageKey: string; sha256Hash: string; extension: string }> {
  await ensureStorageDirectories();
  const ext = path.extname(originalName).toLowerCase();
  const safeId = crypto.randomUUID();
  const userDir = path.join(UPLOADS_DIR, `user_${userId}`);
  await fs.mkdir(userDir, { recursive: true });

  const storageKey = path.join(`user_${userId}`, `${safeId}${ext}`);
  const fullPath = resolveSafeUserPath(UPLOADS_DIR, storageKey);
  const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

  await fs.writeFile(fullPath, buffer);
  return { storageKey, sha256Hash, extension: ext.replace('.', '') };
}

export async function deleteUserMediaFile(storageKey: string): Promise<void> {
  const fullPath = resolveSafeUserPath(UPLOADS_DIR, storageKey);
  await fs.rm(fullPath, { force: true });
}

export async function cleanupTempJobDir(jobKey: string): Promise<void> {
  const target = resolveSafeUserPath(TEMP_DIR, jobKey);
  await fs.rm(target, { recursive: true, force: true });
}

export async function sendFileSafely(
  res: Response,
  fullPath: string,
  notFoundMessage = 'فایل مورد نظر روی سرور یافت نشد.'
): Promise<void> {
  try {
    await fs.access(fullPath);
  } catch {
    if (!res.headersSent) {
      res.status(404).json({ error: notFoundMessage });
    }
    return;
  }

  await new Promise<void>((resolve) => {
    res.sendFile(fullPath, (err) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (!res.headersSent) {
          if (code === 'ENOENT') {
            res.status(404).json({ error: notFoundMessage });
          } else {
            res.status(500).json({ error: 'خطا در ارسال فایل.' });
          }
        }
      }
      resolve();
    });
  });
}
