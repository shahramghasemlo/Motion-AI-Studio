# مستندات فنی مرحله اول — زیرساخت و معماری Motion AI Studio

## ۱. نمای کلی معماری
Motion AI Studio یک استودیوی هوشمند طراحی و تدوین موشنگرافیک تبلیغاتی با معماری ماژولار Full-Stack است:
- **Frontend:** `React 19 + TypeScript + Tailwind CSS v4 + Zustand` با پشتیبانی بومی از زبان فارسی (`RTL`)، انگلیسی (`LTR`) و حالت تاریک/روشن (`Dark/Light Mode`).
- **Backend:** سرور یکپارچه `Express + TypeScript` به همراه `WebSocket (/ws)` جهت همگام‌سازی بلادرنگ وضعیت پروژه‌ها، آپلود فایل‌ها و صف رندر.
- **Database:** پایگاه داده **PostgreSQL (Cloud SQL)** با **Drizzle ORM** و Connection Pool امن.
- **Authentication:** احراز هویت کاربران از طریق **Firebase Authentication (Google Sign-In)** و اعتبارسنجی توکن در Middleware سرور (`src/middleware/auth.ts`).

## ۲. ساختار پایگاه داده (PostgreSQL)
جداول اصلی تعریف‌شده در `src/db/schema.ts`:
- `users`: اطلاعات کاربران، نقش، سهمیه و فضای مصرف‌شده، و تنظیمات زبان/تم.
- `projects`: پروژه‌های تبلیغاتی به همراه نسبت تصویر، مدت‌زمان، پروفایل سبک مرجع، سناریو و تایملاین.
- `project_versions`: تاریخچه نسخه‌های ذخیره‌شده و قابل بازیابی هر پروژه.
- `project_scenes`: صحنه‌های مستقل و قابل ویرایش/قفل‌شدن (`locked`) برای تولید صحنه‌محور.
- `media_assets`: کتابخانه رسانه با هش `SHA-256`، دسته‌بندی و پرچم حفاظت از فایل اصلی (`is_protected_original`).
- `ai_providers`: رجیستری سرویس‌های هوش مصنوعی مستقل از ارائه‌دهنده (بدون ذخیره کلید در سمت کلاینت).
- `render_jobs`: صف رندر غیرهمزمان پس‌زمینه.
- `activity_logs`: گزارش رویدادهای کاربر.

## ۳. امنیت فایل و ذخیره‌سازی
- اعتبارسنجی فرمت و امضای باینری (**Magic Header**) در `src/server/storage.ts`.
- جلوگیری از حملات XSS در فایل‌های SVG و جلوگیری از Path Traversal.
- کنترل سهمیه فضا (`storage_quota_bytes`) برای هر کاربر و الزام تأیید صریح برای حذف فایل‌های اصلی.

## ۴. APIهای پیاده‌سازی‌شده در مرحله اول
- `GET /api/health` و `?checkDb=1`
- `GET /api/auth/me` و `PATCH /api/auth/preferences`
- `GET /api/activity`
- `GET/POST /api/projects`، `GET/PATCH/DELETE /api/projects/:id`، `duplicate`، `versions`، `restore`، `export`، `import`
- `GET /api/media`، `POST /api/media/upload`، `PATCH/DELETE /api/media/:id`، `GET /api/media/:id/file`
- `GET /api/providers` و `PATCH /api/providers/:id`
