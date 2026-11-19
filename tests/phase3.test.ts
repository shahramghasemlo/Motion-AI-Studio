import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { promisify } from 'node:util';
import { ensureStorageDirectories, TEMP_DIR } from '../src/server/storage.ts';
import {
  convertImageToKeyframe,
  detectSceneSegments,
  extractDominantColors,
  extractSceneKeyframe,
  probeVideoMetadata,
} from '../src/server/videoAnalyzer.ts';
import { inspectVideoLink } from '../src/server/videoIngestion.ts';
import { studioWsHub } from '../src/server/ws.ts';

const execFileAsync = promisify(execFile);

describe('Phase 3 — Reference Video Ingestion, FFmpeg Analysis & Route Guards', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempVideoPath: string;
  let tempFramePath: string;
  let tempSourcePngPath: string;
  let tempConvertedJpgPath: string;

  before(async () => {
    process.env.NODE_ENV = 'production';
    await ensureStorageDirectories();

    const stamp = Date.now();
    tempVideoPath = path.join(TEMP_DIR, `phase3_test_${stamp}.mp4`);
    tempFramePath = path.join(TEMP_DIR, `phase3_frame_${stamp}.jpg`);
    tempSourcePngPath = path.join(TEMP_DIR, `phase3_brief_${stamp}.png`);
    tempConvertedJpgPath = path.join(TEMP_DIR, `phase3_brief_out_${stamp}.jpg`);

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
    await fs.rm(tempVideoPath, { force: true }).catch(() => {});
    await fs.rm(tempFramePath, { force: true }).catch(() => {});
    await fs.rm(tempSourcePngPath, { force: true }).catch(() => {});
    await fs.rm(tempConvertedJpgPath, { force: true }).catch(() => {});
    studioWsHub.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    const { pool } = await import('../src/db/index.ts');
    await pool.end();
  });

  it('rejects malformed URLs and private/SSRF hostnames in inspectVideoLink', async () => {
    const bad = await inspectVideoLink('not-a-valid-url');
    assert.equal(bad.accessStatus, 'invalid_url');

    const loopback = await inspectVideoLink('http://127.0.0.1/sample.mp4');
    assert.equal(loopback.accessStatus, 'invalid_url');

    const local = await inspectVideoLink('http://localhost:3000/sample.mp4');
    assert.equal(local.accessStatus, 'invalid_url');

    const metadataIp = await inspectVideoLink('http://169.254.169.254/latest/meta-data');
    assert.equal(metadataIp.accessStatus, 'invalid_url');
  });

  it('detects restricted platforms (YouTube / Instagram) and prompts direct upload', async () => {
    const yt = await inspectVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(yt.platform, 'youtube');
    assert.equal(yt.accessStatus, 'restricted_requires_upload');
    assert.ok(yt.accessMessage.length > 10);

    const ig = await inspectVideoLink('https://www.instagram.com/reel/C8example123/');
    assert.equal(ig.platform, 'instagram');
    assert.equal(ig.accessStatus, 'restricted_requires_upload');
    assert.ok(ig.accessMessage.length > 10);
  });

  it('runs FFprobe, FFmpeg scene splitting, JPEG keyframe extraction, and RGB dominant palette extraction', async () => {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=4:size=320x240:rate=24',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=4',
        '-pix_fmt',
        'yuv420p',
        '-shortest',
        tempVideoPath,
      ],
      { timeout: 20000 }
    );

    const probe = await probeVideoMetadata(tempVideoPath);
    assert.equal(probe.width, 320);
    assert.equal(probe.height, 240);
    assert.equal(probe.hasAudio, true);
    assert.ok(probe.durationMs >= 3500 && probe.durationMs <= 4500);

    const scenes = await detectSceneSegments(tempVideoPath, probe.durationMs);
    assert.ok(scenes.length >= 3);
    assert.equal(scenes[0].startTimeMs, 0);
    assert.equal(scenes[scenes.length - 1].endTimeMs, probe.durationMs);

    await extractSceneKeyframe(tempVideoPath, 1500, tempFramePath);
    const jpegBuf = await fs.readFile(tempFramePath);
    assert.ok(jpegBuf.length > 500);
    assert.equal(jpegBuf[0], 0xff);
    assert.equal(jpegBuf[1], 0xd8);
    assert.equal(jpegBuf[2], 0xff);

    const colors = await extractDominantColors(tempFramePath);
    assert.ok(colors.length >= 1 && colors.length <= 4);
    for (const hex of colors) {
      assert.match(hex, /^#[0-9A-F]{6}$/);
    }
  });

  it('converts reference PNG image to JPEG keyframe and extracts dominant RGB colors', async () => {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'color=c=0x1D4ED8:s=320x240:d=0.1', '-frames:v', '1', tempSourcePngPath],
      { timeout: 15000 }
    );

    await convertImageToKeyframe(tempSourcePngPath, tempConvertedJpgPath);
    const jpgBuf = await fs.readFile(tempConvertedJpgPath);
    assert.ok(jpgBuf.length > 300);
    assert.equal(jpgBuf[0], 0xff);
    assert.equal(jpgBuf[1], 0xd8);

    const colors = await extractDominantColors(tempConvertedJpgPath);
    assert.ok(colors.length >= 1);
    assert.match(colors[0], /^#[0-9A-F]{6}$/);
  });

  it('guards all Phase 3 reference analysis endpoints with 401 when unauthenticated', async () => {
    const endpoints: Array<{ method: string; url: string }> = [
      { method: 'GET', url: `${baseUrl}/api/projects/1/references` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/references/brief` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/references/check-link` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/references/upload` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/references/1/reanalyze` },
      { method: 'GET', url: `${baseUrl}/api/references/1/scenes/1/frame` },
      { method: 'DELETE', url: `${baseUrl}/api/references/1?confirm=true` },
    ];

    for (const ep of endpoints) {
      const res = await fetch(ep.url, { method: ep.method });
      assert.equal(res.status, 401, `Expected 401 for ${ep.method} ${ep.url}`);
      const json = (await res.json()) as { code: string };
      assert.equal(json.code, 'AUTH_MISSING_TOKEN');
    }
  });
});
