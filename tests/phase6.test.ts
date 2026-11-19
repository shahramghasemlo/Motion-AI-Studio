import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { db } from '../src/db/index.ts';
import { projects, renderJobs, users } from '../src/db/schema.ts';
import { EXPORTS_DIR, resolveSafeUserPath, sendFileSafely } from '../src/server/storage.ts';
import { computeRenderResolution, runRenderJob } from '../src/server/videoRenderer.ts';
import { studioWsHub } from '../src/server/ws.ts';

const execFileAsync = promisify(execFile);

describe('Phase 6 — Server-Side FFmpeg Render, Export Queue & API Guards', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    process.env.NODE_ENV = 'production';
    const { createStudioServer } = await import('../server.ts');
    const app = await createStudioServer();
    server = http.createServer(app);
    studioWsHub.attach(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    studioWsHub.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    const { pool } = await import('../src/db/index.ts');
    await pool.end();
  });

  it('computes even FFmpeg-safe dimensions across aspect ratios and quality tiers', () => {
    const r916 = computeRenderResolution(1080, 1920, '720p');
    assert.equal(r916.width, 720);
    assert.equal(r916.height, 1280);
    assert.equal(r916.width % 2, 0);
    assert.equal(r916.height % 2, 0);

    const r169 = computeRenderResolution(1920, 1080, '4k');
    assert.equal(r169.width, 3840);
    assert.equal(r169.height, 2160);

    const rOdd = computeRenderResolution(1001, 1333, '1080p');
    assert.equal(rOdd.width % 2, 0);
    assert.equal(rOdd.height % 2, 0);
  });

  it('renders real MP4 video and PNG ZIP sequence via FFmpeg & Canvas and validates output streams', async () => {
    const testUid = `phase6-test-${Date.now()}`;
    const [testUser] = await db
      .insert(users)
      .values({
        uid: testUid,
        email: `${testUid}@example.com`,
        displayName: 'Phase 6 Render Test',
      })
      .returning();

    const [testProject] = await db
      .insert(projects)
      .values({
        userId: testUser.id,
        title: 'تست رندر واقعی FFmpeg',
        aspectRatio: '16:9',
        customWidth: 640,
        customHeight: 360,
        durationSeconds: 2,
        outputQuality: '720p',
        timelineData: {
          fps: 15,
          zoomPxPerSec: 60,
          tracks: [
            { id: 'track-video', type: 'video', nameFa: 'V1', nameEn: 'V1', muted: false, locked: false },
            { id: 'track-text', type: 'text', nameFa: 'T1', nameEn: 'T1', muted: false, locked: false },
            { id: 'track-overlay', type: 'overlay', nameFa: 'O1', nameEn: 'O1', muted: false, locked: false },
            { id: 'track-audio', type: 'audio', nameFa: 'A1', nameEn: 'A1', muted: false, locked: false },
          ],
          clips: [
            {
              id: 'v-1',
              trackId: 'track-video',
              trackType: 'video',
              label: 'BG',
              startTimeMs: 0,
              durationMs: 2000,
              bgColor: '#0F172A',
              accentColor: '#2563EB',
            },
            {
              id: 't-1',
              trackId: 'track-text',
              trackType: 'text',
              label: 'Headline',
              startTimeMs: 100,
              durationMs: 1800,
              text: 'Motion AI Studio تست رندر',
              fontSize: 48,
              textColor: '#F8FAFC',
              accentColor: '#2563EB',
              animationPreset: 'fade_slide_up',
              xPercent: 50,
              yPercent: 50,
            },
          ],
        },
      })
      .returning();

    const createdFiles: string[] = [];

    try {
      // 1) Real MP4 Render
      const [mp4Job] = await db
        .insert(renderJobs)
        .values({
          projectId: testProject.id,
          userId: testUser.id,
          format: 'mp4',
          quality: '720p',
          fps: 15,
          status: 'queued',
          progressPercent: 0,
        })
        .returning();

      await runRenderJob(mp4Job.id);

      const [completedMp4] = await db
        .select()
        .from(renderJobs)
        .where(eq(renderJobs.id, mp4Job.id))
        .limit(1);

      assert.equal(completedMp4.status, 'completed');
      assert.equal(completedMp4.progressPercent, 100);
      assert.ok(completedMp4.outputPath);
      assert.ok((completedMp4.outputSizeBytes ?? 0) > 500);

      const mp4FullPath = resolveSafeUserPath(EXPORTS_DIR, completedMp4.outputPath!);
      createdFiles.push(mp4FullPath);

      const { stdout: probeOut } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height',
        '-of',
        'json',
        mp4FullPath,
      ]);
      const probeJson = JSON.parse(probeOut) as {
        streams: Array<{ codec_name: string; width: number; height: number }>;
      };
      assert.equal(probeJson.streams[0]?.codec_name, 'h264');
      assert.equal(probeJson.streams[0]?.width, 1280);
      assert.equal(probeJson.streams[0]?.height, 720);

      // 2) PNG Frame Sequence ZIP Render
      const [pngJob] = await db
        .insert(renderJobs)
        .values({
          projectId: testProject.id,
          userId: testUser.id,
          format: 'png',
          quality: '720p',
          fps: 12,
          status: 'queued',
          progressPercent: 0,
        })
        .returning();

      await runRenderJob(pngJob.id);

      const [completedPng] = await db
        .select()
        .from(renderJobs)
        .where(eq(renderJobs.id, pngJob.id))
        .limit(1);

      assert.equal(completedPng.status, 'completed');
      const zipFullPath = resolveSafeUserPath(EXPORTS_DIR, completedPng.outputPath!);
      createdFiles.push(zipFullPath);

      const zipBuf = await fs.readFile(zipFullPath);
      const zip = await JSZip.loadAsync(zipBuf);
      assert.ok(zip.file('frame_0001.png'));
      assert.ok(zip.file('manifest.json'));
    } finally {
      for (const f of createdFiles) {
        await fs.rm(f, { force: true }).catch(() => {});
      }
      await fs.rm(resolveSafeUserPath(EXPORTS_DIR, `user_${testUser.id}`), {
        recursive: true,
        force: true,
      }).catch(() => {});
      await db.delete(users).where(eq(users.id, testUser.id));
    }
  });

  it('guards all Phase 6 render & download endpoints with 401 when unauthenticated', async () => {
    const endpoints: Array<{ method: string; url: string }> = [
      { method: 'GET', url: `${baseUrl}/api/renders` },
      { method: 'GET', url: `${baseUrl}/api/projects/1/renders` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/renders` },
      { method: 'POST', url: `${baseUrl}/api/renders/1/cancel` },
      { method: 'POST', url: `${baseUrl}/api/renders/1/retry` },
      { method: 'GET', url: `${baseUrl}/api/renders/1/download` },
      { method: 'DELETE', url: `${baseUrl}/api/renders/1?confirm=true` },
    ];

    for (const ep of endpoints) {
      const res = await fetch(ep.url, { method: ep.method });
      assert.equal(res.status, 401, `Expected 401 for ${ep.method} ${ep.url}`);
      const json = (await res.json()) as { code: string };
      assert.equal(json.code, 'AUTH_MISSING_TOKEN');
    }
  });

  it('sendFileSafely returns clean 404 JSON instead of throwing unhandled ENOENT', async () => {
    let statusCode = 0;
    let payload: Record<string, unknown> | null = null;
    const mockRes = {
      headersSent: false,
      status(code: number) {
        statusCode = code;
        return mockRes;
      },
      json(body: Record<string, unknown>) {
        payload = body;
        mockRes.headersSent = true;
        return mockRes;
      },
      sendFile() {
        throw new Error('Should not call sendFile when missing');
      },
    };

    await sendFileSafely(
      mockRes as unknown as import('express').Response,
      '/app/applet/port1356/uploads/user_1/does-not-exist.png',
      'فایل یافت نشد'
    );
    assert.equal(statusCode, 404);
    assert.deepEqual(payload, { error: 'فایل یافت نشد' });
  });
});
