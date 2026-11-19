import { GoogleGenAI } from '@google/genai';

let cachedAiClient: GoogleGenAI | null = null;

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 10 && key !== 'MY_GEMINI_API_KEY');
}

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'کلید سرویس هوش مصنوعی تنظیم نشده است. لطفاً کلید GEMINI_API_KEY را در تنظیمات Secrets بررسی کنید.'
    );
  }
  if (!cachedAiClient) {
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedAiClient;
}

export const DEFAULT_AI_PROVIDER_CATALOG = [
  {
    providerKey: 'gemini',
    displayName: 'Gemini 4 Hydrogen (تحلیل ویدئو و سناریونویسی)',
    capability: 'video_analysis',
    modelName: 'gemini-4-hydrogen',
    priority: 1,
    isEnabled: true,
    isFreeTier: true,
    quotaLimit: 1500,
    status: 'active',
  },
  {
    providerKey: 'gemini',
    displayName: 'Gemini 4 Hydrogen (تولید سناریو و متن تبلیغاتی)',
    capability: 'text',
    modelName: 'gemini-4-hydrogen',
    priority: 1,
    isEnabled: true,
    isFreeTier: true,
    quotaLimit: 1500,
    status: 'active',
  },
  {
    providerKey: 'gemini',
    displayName: 'Gemini 4 Hydrogen (تحلیل تصویر و تایپوگرافی)',
    capability: 'image_analysis',
    modelName: 'gemini-4-hydrogen',
    priority: 1,
    isEnabled: true,
    isFreeTier: true,
    quotaLimit: 1500,
    status: 'active',
  },
  {
    providerKey: 'ffmpeg_local',
    displayName: 'موتور محلی FFmpeg (استخراج فریم، تحلیل صحنه و رندر مستقل)',
    capability: 'video_gen',
    modelName: 'ffmpeg-wasm-native',
    priority: 1,
    isEnabled: true,
    isFreeTier: true,
    quotaLimit: 999999,
    status: 'active',
  },
  {
    providerKey: 'gemini',
    displayName: 'Gemini 3.8 Flash Lite TTS (صداگذاری و نریشن)',
    capability: 'audio_tts',
    modelName: 'gemini-3.8-flash-lite-tts',
    priority: 2,
    isEnabled: true,
    isFreeTier: true,
    quotaLimit: 500,
    status: 'active',
  },
  {
    providerKey: 'gemini',
    displayName: 'Gemini 3.1 Flash Lite Image (تولید تصویر پس‌زمینه)',
    capability: 'image_gen',
    modelName: 'gemini-3.1-flash-lite-image',
    priority: 2,
    isEnabled: false,
    isFreeTier: false,
    quotaLimit: 100,
    status: 'disabled',
  },
];
