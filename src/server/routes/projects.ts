import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/index.ts';
import {
  projectScenes,
  projects,
  projectVersions,
} from '../../db/schema.ts';
import { logActivity } from '../../db/users.ts';
import type { AuthRequest } from '../../middleware/auth.ts';
import { STARTER_TEMPLATES } from '../../shared/templates.ts';
import { studioWsHub } from '../ws.ts';

export const projectsRouter = Router();

const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

projectsRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt));

    res.json({ projects: rows });
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).json({ error: 'خطا در دریافت لیست پروژه‌ها.' });
  }
});

projectsRouter.post('/', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const {
      title,
      topic = '',
      businessName = '',
      productType = '',
      targetAudience = '',
      language = 'fa',
      aspectRatio = '9:16',
      customWidth,
      customHeight,
      durationSeconds = 15,
      designStyle = 'modern_minimal',
      outputQuality = '1080p',
      templateId,
    } = req.body ?? {};

    if (!title || typeof title !== 'string' || title.trim().length < 2) {
      res.status(400).json({ error: 'عنوان پروژه باید حداقل ۲ کاراکتر باشد.' });
      return;
    }

    const template =
      typeof templateId === 'string'
        ? STARTER_TEMPLATES.find((t) => t.id === templateId)
        : undefined;

    const effectiveAspect = template ? template.aspectRatio : String(aspectRatio);
    const dims = ASPECT_DIMENSIONS[effectiveAspect] ?? {
      width: Math.max(240, Math.min(3840, Number(customWidth) || 1080)),
      height: Math.max(240, Math.min(3840, Number(customHeight) || 1920)),
    };

    const clampedDuration = Math.max(
      5,
      Math.min(180, Number(durationSeconds || template?.durationSeconds) || 15)
    );
    const effectiveLang = language === 'en' ? 'en' : 'fa';

    const [created] = await db
      .insert(projects)
      .values({
        userId,
        title: title.trim(),
        topic: String(topic).trim(),
        businessName: String(businessName).trim(),
        productType: String(productType).trim(),
        targetAudience: String(targetAudience).trim(),
        language: effectiveLang,
        aspectRatio: effectiveAspect,
        customWidth: dims.width,
        customHeight: dims.height,
        durationSeconds: clampedDuration,
        designStyle: String(template?.designStyle || designStyle),
        outputQuality: ['720p', '1080p', '4k'].includes(String(outputQuality))
          ? String(outputQuality)
          : '1080p',
        status: 'draft',
        currentVersion: 1,
      })
      .returning();

    let createdScenes: Array<typeof projectScenes.$inferSelect> = [];
    if (template && template.defaultScenes.length > 0) {
      let cursorMs = 0;
      createdScenes = await db
        .insert(projectScenes)
        .values(
          template.defaultScenes.map((sc, idx) => {
            const startTimeMs = cursorMs;
            cursorMs += sc.durationMs;
            return {
              projectId: created.id,
              orderIndex: idx,
              title: effectiveLang === 'fa' ? sc.titleFa : sc.titleEn,
              startTimeMs,
              durationMs: sc.durationMs,
              locked: false,
              textContent: effectiveLang === 'fa' ? sc.textFa : sc.textEn,
              visualPrompt: `${created.topic || created.title} — ${
                effectiveLang === 'fa' ? sc.titleFa : sc.titleEn
              }`,
              animationPreset: sc.animationPreset,
              transitionType: sc.transitionType,
              effectsConfig: { accentHex: template.accentHex },
              layersConfig: [],
              variants: [],
              activeVariantIndex: 0,
            };
          })
        )
        .returning();
    }

    await db.insert(projectVersions).values({
      projectId: created.id,
      userId,
      versionNumber: 1,
      label: template
        ? `نسخه اولیه (قالب ${effectiveLang === 'fa' ? template.titleFa : template.titleEn})`
        : 'نسخه اولیه پروژه',
      snapshot: {
        project: created,
        scenes: createdScenes,
      },
    });

    await logActivity(userId, 'project.created', `پروژه «${created.title}» ایجاد شد`, created.id);
    studioWsHub.emitToUser(userId, 'project:created', { project: created });

    res.status(201).json({ project: created, scenes: createdScenes });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'خطا در ایجاد پروژه جدید.' });
  }
});

projectsRouter.get('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: 'شناسه پروژه نامعتبر است.' });
      return;
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه مورد نظر یافت نشد.' });
      return;
    }

    const [versions, scenes] = await Promise.all([
      db
        .select()
        .from(projectVersions)
        .where(eq(projectVersions.projectId, projectId))
        .orderBy(desc(projectVersions.versionNumber)),
      db
        .select()
        .from(projectScenes)
        .where(eq(projectScenes.projectId, projectId))
        .orderBy(projectScenes.orderIndex),
    ]);

    res.json({ project, versions, scenes });
  } catch (error) {
    console.error('Error fetching project details:', error);
    res.status(500).json({ error: 'خطا در دریافت اطلاعات پروژه.' });
  }
});

projectsRouter.patch('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: 'شناسه پروژه نامعتبر است.' });
      return;
    }

    const [existing] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'پروژه مورد نظر یافت نشد.' });
      return;
    }

    const body = req.body ?? {};
    const updates: Partial<typeof projects.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (typeof body.title === 'string' && body.title.trim().length >= 2) {
      updates.title = body.title.trim();
    }
    if (typeof body.topic === 'string') updates.topic = body.topic.trim();
    if (typeof body.businessName === 'string') updates.businessName = body.businessName.trim();
    if (typeof body.productType === 'string') updates.productType = body.productType.trim();
    if (typeof body.targetAudience === 'string') updates.targetAudience = body.targetAudience.trim();
    if (body.language === 'fa' || body.language === 'en') updates.language = body.language;
    if (typeof body.aspectRatio === 'string') {
      updates.aspectRatio = body.aspectRatio;
      const presetDims = ASPECT_DIMENSIONS[body.aspectRatio];
      if (presetDims) {
        updates.customWidth = presetDims.width;
        updates.customHeight = presetDims.height;
      }
    }
    if (typeof body.customWidth === 'number' && Number.isFinite(body.customWidth)) {
      updates.customWidth = Math.max(240, Math.min(3840, Math.round(body.customWidth)));
    }
    if (typeof body.customHeight === 'number' && Number.isFinite(body.customHeight)) {
      updates.customHeight = Math.max(240, Math.min(3840, Math.round(body.customHeight)));
    }
    if (typeof body.designStyle === 'string') updates.designStyle = body.designStyle;
    if (['720p', '1080p', '4k'].includes(body.outputQuality)) {
      updates.outputQuality = body.outputQuality;
    }
    if (typeof body.durationSeconds === 'number') {
      updates.durationSeconds = Math.max(5, Math.min(180, body.durationSeconds));
    }

    const [updated] = await db
      .update(projects)
      .set(updates)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning();

    studioWsHub.emitToUser(userId, 'project:updated', { project: updated });
    res.json({ project: updated });
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'خطا در بروزرسانی پروژه.' });
  }
});

projectsRouter.post('/:id/duplicate', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.id);

    const [source] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!source) {
      res.status(404).json({ error: 'پروژه مبدأ یافت نشد.' });
      return;
    }

    const [copy] = await db
      .insert(projects)
      .values({
        userId,
        title: `${source.title} (کپی)`,
        topic: source.topic,
        businessName: source.businessName,
        productType: source.productType,
        targetAudience: source.targetAudience,
        language: source.language,
        aspectRatio: source.aspectRatio,
        customWidth: source.customWidth,
        customHeight: source.customHeight,
        durationSeconds: source.durationSeconds,
        designStyle: source.designStyle,
        outputQuality: source.outputQuality,
        status: 'draft',
        referenceStyleProfile: source.referenceStyleProfile,
        scenarioData: source.scenarioData,
        timelineData: source.timelineData,
        audioSettings: source.audioSettings,
        currentVersion: 1,
      })
      .returning();

    const sourceScenes = await db
      .select()
      .from(projectScenes)
      .where(eq(projectScenes.projectId, source.id));

    if (sourceScenes.length > 0) {
      await db.insert(projectScenes).values(
        sourceScenes.map((sc) => ({
          projectId: copy.id,
          orderIndex: sc.orderIndex,
          title: sc.title,
          startTimeMs: sc.startTimeMs,
          durationMs: sc.durationMs,
          locked: sc.locked,
          textContent: sc.textContent,
          visualPrompt: sc.visualPrompt,
          animationPreset: sc.animationPreset,
          transitionType: sc.transitionType,
          effectsConfig: sc.effectsConfig,
          layersConfig: sc.layersConfig,
          variants: sc.variants,
          activeVariantIndex: sc.activeVariantIndex,
        }))
      );
    }

    await logActivity(userId, 'project.duplicated', `نسخه کپی از «${source.title}» ساخته شد`, copy.id);
    res.status(201).json({ project: copy });
  } catch (error) {
    console.error('Error duplicating project:', error);
    res.status(500).json({ error: 'خطا در تکثیر پروژه.' });
  }
});

projectsRouter.post('/:id/versions', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.id);
    const label = typeof req.body?.label === 'string' && req.body.label.trim()
      ? req.body.label.trim()
      : 'ذخیره دستی نسخه';

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const scenes = await db
      .select()
      .from(projectScenes)
      .where(eq(projectScenes.projectId, projectId))
      .orderBy(projectScenes.orderIndex);

    const nextVersion = project.currentVersion + 1;

    const [versionRow] = await db
      .insert(projectVersions)
      .values({
        projectId,
        userId,
        versionNumber: nextVersion,
        label,
        snapshot: {
          project,
          scenes,
        },
      })
      .returning();

    await db
      .update(projects)
      .set({ currentVersion: nextVersion, updatedAt: new Date() })
      .where(eq(projects.id, projectId));

    await logActivity(userId, 'project.version_saved', `نسخه ${nextVersion} برای «${project.title}» ذخیره شد`, projectId);
    res.status(201).json({ version: versionRow, currentVersion: nextVersion });
  } catch (error) {
    console.error('Error saving project version:', error);
    res.status(500).json({ error: 'خطا در ذخیره نسخه پروژه.' });
  }
});

projectsRouter.post('/:id/versions/:versionId/restore', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.id);
    const versionId = Number(req.params.versionId);

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const [versionRow] = await db
      .select()
      .from(projectVersions)
      .where(and(eq(projectVersions.id, versionId), eq(projectVersions.projectId, projectId)))
      .limit(1);

    if (!versionRow) {
      res.status(404).json({ error: 'نسخه مورد نظر یافت نشد.' });
      return;
    }

    const snapshot = versionRow.snapshot as {
      project?: Record<string, unknown>;
      scenes?: Array<Record<string, unknown>>;
    };

    const snapProject = snapshot.project || {};
    const [restored] = await db
      .update(projects)
      .set({
        title: typeof snapProject.title === 'string' ? snapProject.title : project.title,
        topic: typeof snapProject.topic === 'string' ? snapProject.topic : project.topic,
        designStyle:
          typeof snapProject.designStyle === 'string' ? snapProject.designStyle : project.designStyle,
        referenceStyleProfile:
          (snapProject.referenceStyleProfile as Record<string, unknown> | null) ?? null,
        scenarioData: (snapProject.scenarioData as Record<string, unknown> | null) ?? null,
        timelineData: (snapProject.timelineData as Record<string, unknown> | null) ?? null,
        audioSettings: (snapProject.audioSettings as Record<string, unknown> | null) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
      .returning();

    await logActivity(
      userId,
      'project.version_restored',
      `نسخه ${versionRow.versionNumber} برای «${restored.title}» بازیابی شد`,
      projectId
    );
    res.json({ project: restored, restoredFromVersion: versionRow.versionNumber });
  } catch (error) {
    console.error('Error restoring project version:', error);
    res.status(500).json({ error: 'خطا در بازیابی نسخه پروژه.' });
  }
});

projectsRouter.get('/:id/export', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.id);

    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'پروژه یافت نشد.' });
      return;
    }

    const scenes = await db
      .select()
      .from(projectScenes)
      .where(eq(projectScenes.projectId, projectId))
      .orderBy(projectScenes.orderIndex);

    res.json({
      schema: 'motion-ai-studio/project-bundle/v1',
      exportedAt: new Date().toISOString(),
      project: {
        title: project.title,
        topic: project.topic,
        businessName: project.businessName,
        productType: project.productType,
        targetAudience: project.targetAudience,
        language: project.language,
        aspectRatio: project.aspectRatio,
        customWidth: project.customWidth,
        customHeight: project.customHeight,
        durationSeconds: project.durationSeconds,
        designStyle: project.designStyle,
        outputQuality: project.outputQuality,
        referenceStyleProfile: project.referenceStyleProfile,
        scenarioData: project.scenarioData,
        timelineData: project.timelineData,
        audioSettings: project.audioSettings,
      },
      scenes,
    });
  } catch (error) {
    console.error('Error exporting project:', error);
    res.status(500).json({ error: 'خطا در خروجی گرفتن از ساختار پروژه.' });
  }
});

projectsRouter.post('/import', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const bundle = req.body;
    if (!bundle || bundle.schema !== 'motion-ai-studio/project-bundle/v1' || !bundle.project?.title) {
      res.status(400).json({ error: 'فرمت فایل پروژه معتبر نیست.' });
      return;
    }

    const p = bundle.project;
    const [imported] = await db
      .insert(projects)
      .values({
        userId,
        title: `${String(p.title).trim()} (واردشده)`,
        topic: String(p.topic || ''),
        businessName: String(p.businessName || ''),
        productType: String(p.productType || ''),
        targetAudience: String(p.targetAudience || ''),
        language: p.language === 'en' ? 'en' : 'fa',
        aspectRatio: String(p.aspectRatio || '9:16'),
        customWidth: Number(p.customWidth) || 1080,
        customHeight: Number(p.customHeight) || 1920,
        durationSeconds: Number(p.durationSeconds) || 15,
        designStyle: String(p.designStyle || 'modern_minimal'),
        outputQuality: String(p.outputQuality || '1080p'),
        status: 'draft',
        referenceStyleProfile: p.referenceStyleProfile ?? null,
        scenarioData: p.scenarioData ?? null,
        timelineData: p.timelineData ?? null,
        audioSettings: p.audioSettings ?? null,
      })
      .returning();

    await logActivity(userId, 'project.imported', `پروژه «${imported.title}» وارد شد`, imported.id);
    res.status(201).json({ project: imported });
  } catch (error) {
    console.error('Error importing project:', error);
    res.status(500).json({ error: 'خطا در وارد کردن پروژه.' });
  }
});

projectsRouter.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const userId = req.dbUser!.id;
    const projectId = Number(req.params.id);
    const confirmed = req.query.confirm === 'true' || req.body?.confirm === true;

    if (!confirmed) {
      res.status(400).json({ error: 'برای حذف پروژه، تأیید صریح کاربر الزامی است.' });
      return;
    }

    const deleted = await db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning();

    if (deleted.length === 0) {
      res.status(404).json({ error: 'پروژه یافت نشد یا دسترسی مجاز نیست.' });
      return;
    }

    await logActivity(userId, 'project.deleted', `پروژه «${deleted[0].title}» حذف شد`);
    studioWsHub.emitToUser(userId, 'project:deleted', { projectId });
    res.json({ deletedId: projectId });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'خطا در حذف پروژه.' });
  }
});
