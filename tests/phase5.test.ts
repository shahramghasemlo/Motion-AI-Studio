import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import {
  buildTimelineFromProjectScenes,
  computeClipMotionFrameState,
} from '../src/shared/motionEngine.ts';
import { studioWsHub } from '../src/server/ws.ts';

describe('Phase 5 — Real-Time Motion Engine, Multi-Track Timeline & API Guards', () => {
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

  it('builds multi-track timeline from project scenes while preserving manual overlays/audio', () => {
    const doc = buildTimelineFromProjectScenes(
      {
        title: 'کمپین قهوه',
        designStyle: 'luxury_editorial',
        referenceStyleProfile: {
          colorPalette: {
            primary: '#1C1917',
            accent: '#D4AF37',
            background: '#0C0A09',
            text: '#FAFAF9',
          },
        },
      },
      [
        {
          id: 101,
          orderIndex: 0,
          title: 'صحنه ۱',
          startTimeMs: 0,
          durationMs: 4000,
          textContent: 'قهوه دست‌چین اسپرسو',
          animationPreset: 'kinetic_pop',
          transitionType: 'whip_pan',
          effectsConfig: { backgroundHex: '#1C1917', accentHex: '#D4AF37' },
          layersConfig: [{ mediaAssetId: 55 }],
        },
      ],
      {
        fps: 30,
        zoomPxPerSec: 80,
        tracks: [],
        clips: [
          {
            id: 'overlay-manual-1',
            trackId: 'track-overlay',
            trackType: 'overlay',
            label: 'لوگوی برند',
            startTimeMs: 0,
            durationMs: 4000,
            mediaAssetId: 99,
          },
        ],
      }
    );

    assert.equal(doc.fps, 30);
    assert.equal(doc.zoomPxPerSec, 80);
    assert.equal(doc.tracks.length, 4);
    assert.equal(doc.clips.length, 3); // 1 video + 1 text + 1 preserved overlay
    assert.ok(doc.clips.some((c) => c.id === 'overlay-manual-1'));
    const videoClip = doc.clips.find((c) => c.trackType === 'video');
    assert.equal(videoClip?.mediaAssetId, 55);
  });

  it('computes accurate keyframe motion state across fade_slide_up, kinetic_pop, and typewriter', () => {
    const textClip = {
      id: 't1',
      trackId: 'track-text',
      trackType: 'text' as const,
      label: 'Headline',
      startTimeMs: 1000,
      durationMs: 4000,
      animationPreset: 'typewriter',
      transitionType: 'whip_pan',
      scale: 1,
      opacity: 1,
    };

    const beforeStart = computeClipMotionFrameState(textClip, 500);
    assert.equal(beforeStart.visible, false);
    assert.equal(beforeStart.opacity, 0);

    const midTyping = computeClipMotionFrameState(textClip, 2000);
    assert.equal(midTyping.visible, true);
    assert.ok(midTyping.opacity > 0.8);
    assert.ok(midTyping.revealedCharRatio > 0 && midTyping.revealedCharRatio < 1);

    const endFrame = computeClipMotionFrameState(textClip, 4900);
    assert.equal(endFrame.visible, true);
    assert.ok(endFrame.translateX < 0); // whip_pan exit offset

    const popStart = computeClipMotionFrameState(
      { ...textClip, animationPreset: 'kinetic_pop' },
      1150
    );
    assert.equal(popStart.visible, true);
    assert.ok(popStart.scale > 0.7 && popStart.scale < 1.2);
  });

  it('guards all Phase 5 timeline & reorder endpoints with 401 when unauthenticated', async () => {
    const endpoints: Array<{ method: string; url: string }> = [
      { method: 'GET', url: `${baseUrl}/api/projects/1/timeline` },
      { method: 'PUT', url: `${baseUrl}/api/projects/1/timeline` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/timeline/sync-scenes` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/scenes/reorder` },
    ];

    for (const ep of endpoints) {
      const res = await fetch(ep.url, { method: ep.method });
      assert.equal(res.status, 401, `Expected 401 for ${ep.method} ${ep.url}`);
      const json = (await res.json()) as { code: string };
      assert.equal(json.code, 'AUTH_MISSING_TOKEN');
    }
  });
});
