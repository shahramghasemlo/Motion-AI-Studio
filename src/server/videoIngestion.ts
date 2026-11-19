import dns from 'node:dns/promises';
import net from 'node:net';
import { ALLOWED_MEDIA_RULES, MAX_UPLOAD_BYTES, validateMagicHeader } from './storage.ts';

export interface LinkInspectionResult {
  url: string;
  platform: 'youtube' | 'instagram' | 'direct_video' | 'unsupported';
  accessStatus: 'accessible' | 'restricted_requires_upload' | 'invalid_url';
  accessMessage: string;
  titlePreview?: string;
  contentType?: string;
  contentLength?: number;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  return true;
}

async function assertSafePublicHostname(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    net.isIP(lower) && isPrivateIp(lower)
  ) {
    return false;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length) return false;
    return records.every((r) => !isPrivateIp(r.address));
  } catch {
    return false;
  }
}

export async function inspectVideoLink(rawUrl: string): Promise<LinkInspectionResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      url: rawUrl,
      platform: 'unsupported',
      accessStatus: 'invalid_url',
      accessMessage: 'فرمت لینک ویدئو معتبر نیست. لطفاً آدرس کامل با https:// وارد کنید.',
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      url: rawUrl,
      platform: 'unsupported',
      accessStatus: 'invalid_url',
      accessMessage: 'فقط لینک‌های http و https پشتیبانی می‌شوند.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  const isYoutube =
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtu.be';
  const isInstagram =
    host === 'instagram.com' || host.endsWith('.instagram.com');

  if (isYoutube) {
    let titlePreview: string | undefined;
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.toString())}&format=json`,
        { signal: AbortSignal.timeout(2500) }
      );
      if (oembedRes.ok) {
        const meta = (await oembedRes.json()) as { title?: string; author_name?: string };
        if (meta.title) {
          titlePreview = meta.author_name ? `${meta.title} — ${meta.author_name}` : meta.title;
        }
      }
    } catch {
      // Non-fatal metadata preview failure
    }

    return {
      url: parsed.toString(),
      platform: 'youtube',
      accessStatus: 'restricted_requires_upload',
      accessMessage:
        'یوتیوب اجازه دانلود خودکار فایل خام ویدئو را برای پردازش نمی‌دهد. برای تحلیل دقیق فریم‌ها و رعایت قوانین کپی‌رایت، لطفاً فایل ویدئوی نمونه (MP4/MOV/WebM) را مستقیماً بارگذاری کنید.',
      titlePreview,
    };
  }

  if (isInstagram) {
    return {
      url: parsed.toString(),
      platform: 'instagram',
      accessStatus: 'restricted_requires_upload',
      accessMessage:
        'اینستاگرام دسترسی مستقیم به فایل خام ریلز و پست‌ها را محدود کرده است. لطفاً فایل ویدئو را به‌صورت مستقیم آپلود کنید.',
    };
  }

  const safeHost = await assertSafePublicHostname(host);
  if (!safeHost) {
    return {
      url: parsed.toString(),
      platform: 'unsupported',
      accessStatus: 'invalid_url',
      accessMessage: 'دسترسی به این آدرس به دلایل امنیتی مجاز نیست.',
    };
  }

  // Probe direct video URL via HEAD
  try {
    const headRes = await fetch(parsed.toString(), {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
    });
    const contentType = (headRes.headers.get('content-type') || '').toLowerCase();
    const contentLength = Number(headRes.headers.get('content-length') || 0);
    const isDirectVideo =
      contentType.startsWith('video/mp4') ||
      contentType.startsWith('video/webm') ||
      contentType.startsWith('video/quicktime');

    if (headRes.ok && isDirectVideo) {
      if (contentLength > MAX_UPLOAD_BYTES) {
        return {
          url: parsed.toString(),
          platform: 'direct_video',
          accessStatus: 'restricted_requires_upload',
          accessMessage: 'حجم ویدئو از سقف مجاز سرور بیشتر است. لطفاً نسخه فشرده‌تر را مستقیماً آپلود کنید.',
          contentType,
          contentLength,
        };
      }
      return {
        url: parsed.toString(),
        platform: 'direct_video',
        accessStatus: 'accessible',
        accessMessage: 'لینک مستقیم ویدئو قابل دسترسی و آماده دریافت و تحلیل است.',
        contentType,
        contentLength,
      };
    }

    return {
      url: parsed.toString(),
      platform: 'unsupported',
      accessStatus: 'restricted_requires_upload',
      accessMessage:
        'این لینک به یک فایل ویدئویی مستقیم و مجاز اشاره نمی‌کند. لطفاً فایل ویدئوی نمونه را مستقیماً بارگذاری کنید.',
      contentType,
    };
  } catch {
    return {
      url: parsed.toString(),
      platform: 'unsupported',
      accessStatus: 'restricted_requires_upload',
      accessMessage:
        'امکان بررسی دسترسی لینک وجود نداشت یا دسترسی آن محدود است. لطفاً فایل ویدئو را مستقیماً آپلود کنید.',
    };
  }
}

export async function downloadDirectVideoUrl(
  videoUrl: string
): Promise<{ buffer: Buffer; extension: string; mimeType: string; filename: string }> {
  const parsed = new URL(videoUrl);
  const safeHost = await assertSafePublicHostname(parsed.hostname);
  if (!safeHost) {
    throw new Error('آدرس لینک مجاز نیست.');
  }

  const res = await fetch(parsed.toString(), {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`دریافت ویدئو از لینک ناموفق بود (HTTP ${res.status}).`);
  }

  const contentType = (res.headers.get('content-type') || 'video/mp4').split(';')[0].trim().toLowerCase();
  let ext = 'mp4';
  if (contentType === 'video/webm') ext = 'webm';
  else if (contentType === 'video/quicktime') ext = 'mov';

  if (!ALLOWED_MEDIA_RULES[ext]) {
    throw new Error('فرمت ویدئوی لینک پشتیبانی نمی‌شود.');
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('پاسخ ویدئو قابل خواندن نیست.');
  }

  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw new Error('حجم فایل از سقف مجاز بیشتر است.');
    }
    chunks.push(Buffer.from(value));
  }

  const buffer = Buffer.concat(chunks);
  const magic = validateMagicHeader(buffer, ext);
  if (!magic.valid) {
    throw new Error(magic.reason || 'محتوای دریافت‌شده یک فایل ویدئویی معتبر نیست.');
  }

  const rawName = parsed.pathname.split('/').pop() || `reference.${ext}`;
  const filename = rawName.includes('.') ? rawName : `${rawName}.${ext}`;

  return { buffer, extension: ext, mimeType: contentType, filename };
}
