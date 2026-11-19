import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/index.ts';
import { aiProviders } from '../../db/schema.ts';
import type { AuthRequest } from '../../middleware/auth.ts';
import { DEFAULT_AI_PROVIDER_CATALOG, isGeminiConfigured } from '../gemini.ts';

export const providersRouter = Router();

providersRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    let rows = await db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.userId, userId))
      .orderBy(asc(aiProviders.priority), asc(aiProviders.id));

    if (rows.length === 0) {
      rows = await db
        .insert(aiProviders)
        .values(
          DEFAULT_AI_PROVIDER_CATALOG.map((item) => ({
            ...item,
            userId,
          }))
        )
        .returning();
    }

    res.json({
      providers: rows,
      serverReadiness: {
        geminiConfigured: isGeminiConfigured(),
        localFfmpegReady: true,
      },
    });
  } catch (error) {
    console.error('Error fetching AI providers:', error);
    res.status(500).json({ error: 'خطا در دریافت لیست سرویس‌های هوش مصنوعی.' });
  }
});

providersRouter.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const providerId = Number(req.params.id);
    const { isEnabled, priority } = req.body ?? {};

    const updates: Partial<typeof aiProviders.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof isEnabled === 'boolean') {
      updates.isEnabled = isEnabled;
      updates.status = isEnabled ? 'active' : 'disabled';
    }
    if (typeof priority === 'number' && Number.isInteger(priority)) {
      updates.priority = Math.max(1, Math.min(10, priority));
    }

    const [updated] = await db
      .update(aiProviders)
      .set(updates)
      .where(and(eq(aiProviders.id, providerId), eq(aiProviders.userId, userId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'سرویس مورد نظر یافت نشد.' });
      return;
    }

    res.json({ provider: updated });
  } catch (error) {
    console.error('Error updating AI provider:', error);
    res.status(500).json({ error: 'خطا در بروزرسانی وضعیت سرویس هوش مصنوعی.' });
  }
});
