import { and, asc, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/index.ts';
import {
  mediaAssets,
  projectScenes,
  projects,
  referenceVideos,
} from '../../db/schema.ts';
import { logActivity } from '../../db/users.ts';
import { requireAuth, type AuthRequest } from '../../middleware/auth.ts';
import {
  generateProjectBlueprint,
  mapAnimationPreset,
  mapTransitionType,
  regenerateSingleScene,
} from '../styleAdapter.ts';

export const blueprintRouter = Router();

async function resequenceProjectScenes(projectId: number) {
  const ordered = await db
    .select()
    .from(projectScenes)
    .where(eq(projectScenes.projectId, projectId))
    .orderBy(asc(projectScenes.orderIndex), asc(projectScenes.id));

  let cursorMs = 0;
  const updatedRows = [];
  for (let i = 0; i < ordered.length; i++) {
    const sc = ordered[i];
    const [row] = await db
      .update(projectScenes)
      .set({
        orderIndex: i,
        startTimeMs: cursorMs,
        updatedAt: new Date(),
      })
      .where(eq(projectScenes.id, sc.id))
      .returning();
    cursorMs += Math.max(500, sc.durationMs);
    updatedRows.push(row);
  }
  return updatedRows;
}

blueprintRouter.get('/projects/:projectId/blueprint', requireAuth, async (req: AuthRequest, res) => {
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

    const [scenes, references, userMedia] = await Promise.all([
      db
        .select()
        .from(projectScenes)
        .where(eq(projectScenes.projectId, projectId))
        .orderBy(asc(projectScenes.orderIndex), asc(projectScenes.id)),
      db
        .select()
        .from(referenceVideos)
        .where(and(eq(referenceVideos.projectId, projectId), eq(referenceVideos.userId, userId)))
        .orderBy(desc(referenceVideos.createdAt)),
      db
        .select()
        .from(mediaAssets)
        .where(eq(mediaAssets.userId, userId))
        .orderBy(desc(mediaAssets.createdAt)),
    ]);

    res.json({
      project,
      referenceStyleProfile: project.referenceStyleProfile,
      scenarioData: project.scenarioData,
      scenes,
      references,
      mediaAssets: userMedia,
    });
  } catch (error) {
    console.error('Error fetching project blueprint:', error);
    res.status(500).json({ error: 'خطا در دریافت الگوی سبک و سناریوی پروژه.' });
  }
});

blueprintRouter.post('/projects/:projectId/blueprint/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.projectId);
    const {
      referenceVideoId,
      toneOfVoice = '',
      ctaText = '',
      customInstructions = '',
      mediaAssetIds = [],
      preserveLocked = true,
    } = req.body ?? {};

    const result = await generateProjectBlueprint({
      userId,
      projectId,
      referenceVideoId: referenceVideoId ? Number(referenceVideoId) : null,
      toneOfVoice: String(toneOfVoice || ''),
      ctaText: String(ctaText || ''),
      customInstructions: String(customInstructions || ''),
      mediaAssetIds: Array.isArray(mediaAssetIds)
        ? mediaAssetIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
        : [],
      preserveLocked: Boolean(preserveLocked),
    });

    res.json(result);
  } catch (error) {
    console.error('Error generating project blueprint:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'خطا در تولید سناریو و صحنه‌های پروژه.',
    });
  }
});

blueprintRouter.patch('/projects/:projectId/blueprint/style', requireAuth, async (req: AuthRequest, res) => {
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

    const { referenceStyleProfile, scenarioData } = req.body ?? {};
    const [updated] = await db
      .update(projects)
      .set({
        referenceStyleProfile:
          referenceStyleProfile !== undefined ? referenceStyleProfile : project.referenceStyleProfile,
        scenarioData: scenarioData !== undefined ? scenarioData : project.scenarioData,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
      .returning();

    await logActivity(
      userId,
      'blueprint.updated',
      `تنظیمات پالت سبک و سناریوی پروژه «${updated.title}» ذخیره شد`,
      projectId
    );

    res.json({
      project: updated,
      referenceStyleProfile: updated.referenceStyleProfile,
      scenarioData: updated.scenarioData,
    });
  } catch (error) {
    console.error('Error saving blueprint style/scenario:', error);
    res.status(500).json({ error: 'خطا در ذخیره پالت و سناریو.' });
  }
});

blueprintRouter.post('/projects/:projectId/scenes', requireAuth, async (req: AuthRequest, res) => {
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

    const existing = await db
      .select()
      .from(projectScenes)
      .where(eq(projectScenes.projectId, projectId));

    const {
      title = project.language === 'en' ? `Scene ${existing.length + 1}` : `صحنه ${existing.length + 1}`,
      textContent = '',
      visualPrompt = '',
      durationMs = 3000,
      animationPreset = 'fade_slide_up',
      transitionType = 'cross_dissolve',
    } = req.body ?? {};

    const clampedDuration = Math.max(800, Math.min(60000, Number(durationMs) || 3000));
    const [created] = await db
      .insert(projectScenes)
      .values({
        projectId,
        orderIndex: existing.length,
        title: String(title),
        startTimeMs: 0,
        durationMs: clampedDuration,
        locked: false,
        textContent: String(textContent),
        visualPrompt: String(visualPrompt),
        animationPreset: mapAnimationPreset(String(animationPreset)),
        transitionType: mapTransitionType(String(transitionType)),
        effectsConfig: {},
        layersConfig: [],
        variants: [],
        activeVariantIndex: 0,
      })
      .returning();

    const scenes = await resequenceProjectScenes(projectId);
    res.status(201).json({ scene: created, scenes });
  } catch (error) {
    console.error('Error creating manual scene:', error);
    res.status(500).json({ error: 'خطا در افزودن صحنه جدید.' });
  }
});

blueprintRouter.patch('/projects/:projectId/scenes/:sceneId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.projectId);
    const sceneId = Number(req.params.sceneId);

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const [scene] = await db
      .select()
      .from(projectScenes)
      .where(and(eq(projectScenes.id, sceneId), eq(projectScenes.projectId, projectId)))
      .limit(1);

    if (!scene) {
      res.status(404).json({ error: 'صحنه یافت نشد.' });
      return;
    }

    const body = req.body ?? {};

    // Allow instant variant switching
    let nextTitle = body.title !== undefined ? String(body.title) : scene.title;
    let nextText = body.textContent !== undefined ? String(body.textContent) : scene.textContent;
    let nextVisual = body.visualPrompt !== undefined ? String(body.visualPrompt) : scene.visualPrompt;
    let nextAnim =
      body.animationPreset !== undefined
        ? mapAnimationPreset(String(body.animationPreset))
        : scene.animationPreset;
    let nextTrans =
      body.transitionType !== undefined
        ? mapTransitionType(String(body.transitionType))
        : scene.transitionType;
    let nextVariantIdx = scene.activeVariantIndex;

    if (
      body.activeVariantIndex !== undefined &&
      Array.isArray(scene.variants) &&
      scene.variants[Number(body.activeVariantIndex)]
    ) {
      nextVariantIdx = Number(body.activeVariantIndex);
      const chosen = scene.variants[nextVariantIdx] as Record<string, unknown>;
      if (typeof chosen.title === 'string') nextTitle = chosen.title;
      if (typeof chosen.textContent === 'string') nextText = chosen.textContent;
      if (typeof chosen.visualPrompt === 'string') nextVisual = chosen.visualPrompt;
      if (typeof chosen.animationPreset === 'string') {
        nextAnim = mapAnimationPreset(chosen.animationPreset);
      }
      if (typeof chosen.transitionType === 'string') {
        nextTrans = mapTransitionType(chosen.transitionType);
      }
    }

    const nextDuration =
      body.durationMs !== undefined
        ? Math.max(800, Math.min(60000, Number(body.durationMs) || scene.durationMs))
        : scene.durationMs;

    await db
      .update(projectScenes)
      .set({
        title: nextTitle,
        textContent: nextText,
        visualPrompt: nextVisual,
        durationMs: nextDuration,
        animationPreset: nextAnim,
        transitionType: nextTrans,
        locked: body.locked !== undefined ? Boolean(body.locked) : scene.locked,
        effectsConfig:
          body.effectsConfig !== undefined ? body.effectsConfig : scene.effectsConfig,
        layersConfig: body.layersConfig !== undefined ? body.layersConfig : scene.layersConfig,
        activeVariantIndex: nextVariantIdx,
        updatedAt: new Date(),
      })
      .where(eq(projectScenes.id, sceneId));

    const scenes = await resequenceProjectScenes(projectId);
    const updated = scenes.find((s) => s.id === sceneId);
    res.json({ scene: updated, scenes });
  } catch (error) {
    console.error('Error updating scene:', error);
    res.status(500).json({ error: 'خطا در ذخیره تغییرات صحنه.' });
  }
});

blueprintRouter.post(
  '/projects/:projectId/scenes/:sceneId/regenerate',
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.dbUser!.id;
      const projectId = Number(req.params.projectId);
      const sceneId = Number(req.params.sceneId);
      const instruction =
        typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';

      const updated = await regenerateSingleScene({
        userId,
        projectId,
        sceneId,
        instruction,
      });

      const scenes = await resequenceProjectScenes(projectId);
      res.json({ scene: updated, scenes });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'خطا در بازتولید صحنه.';
      res.status(msg.includes('قفل') ? 409 : 400).json({ error: msg });
    }
  }
);

blueprintRouter.delete(
  '/projects/:projectId/scenes/:sceneId',
  requireAuth,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.dbUser!.id;
      const projectId = Number(req.params.projectId);
      const sceneId = Number(req.params.sceneId);

      const [project] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: 'پروژه یافت نشد.' });
        return;
      }

      const [deleted] = await db
        .delete(projectScenes)
        .where(and(eq(projectScenes.id, sceneId), eq(projectScenes.projectId, projectId)))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: 'صحنه یافت نشد.' });
        return;
      }

      const scenes = await resequenceProjectScenes(projectId);
      res.json({ deletedId: sceneId, scenes });
    } catch (error) {
      console.error('Error deleting scene:', error);
      res.status(500).json({ error: 'خطا در حذف صحنه.' });
    }
  }
);
