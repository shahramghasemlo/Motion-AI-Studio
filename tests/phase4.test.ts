import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import {
  buildReferenceStyleProfile,
  mapAnimationPreset,
  mapTransitionType,
  normalizeSceneTimingAndLocking,
} from '../src/server/styleAdapter.ts';
import { studioWsHub } from '../src/server/ws.ts';

describe('Phase 4 — Smart Style Adaptation, Scene Timing, Locking & API Guards', () => {
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

  it('extracts structured style profile from reference analysis and normalizes presets', () => {
    assert.equal(mapAnimationPreset('Kinetic Pop Bounce'), 'kinetic_pop');
    assert.equal(mapAnimationPreset('Typewriter reveal'), 'typewriter');
    assert.equal(mapTransitionType('Fast Whip Pan'), 'whip_pan');
    assert.equal(mapTransitionType('Fade Out Ending'), 'fade_out');

    const profile = buildReferenceStyleProfile(
      { designStyle: 'luxury_editorial', durationSeconds: 15, language: 'fa' },
      {
        id: 7,
        userId: 1,
        projectId: 1,
        sourceType: 'upload',
        sourceUrl: null,
        platform: 'local',
        accessStatus: 'accessible',
        accessMessage: '',
        mediaAssetId: 10,
        durationMs: 15000,
        width: 1080,
        height: 1920,
        fps: '30',
        hasAudio: true,
        analysisStatus: 'completed',
        analysisError: null,
        overallSummary: {
          palette: ['#111827', '#D4AF37', '#F8FAFC'],
          rhythm: 'ریتم لوکس و متعادل',
          bpmEstimate: '105 BPM',
          typographyStyle: 'وزیرمتن بولد',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      [
        {
          id: 1,
          referenceVideoId: 7,
          projectId: 1,
          sceneNumber: 1,
          startTimeMs: 0,
          endTimeMs: 5000,
          durationMs: 5000,
          frameStorageKey: 'user_1/ref_7/scene_1.jpg',
          detectedText: 'Sample',
          textAnimation: 'Kinetic Pop',
          visualEffects: ['Soft Glow'],
          cameraMotion: 'Zoom In',
          dominantColors: ['#111827', '#D4AF37'],
          transitionType: 'Whip Pan',
          typographyNotes: 'Bold',
          aiDescription: 'Intro',
          createdAt: new Date(),
        },
      ]
    );

    assert.equal(profile.sourceReferenceId, 7);
    assert.equal(profile.colorPalette.primary, '#111827');
    assert.equal(profile.colorPalette.accent, '#F8FAFC');
    assert.ok(profile.motionLanguage.textAnimations.includes('kinetic_pop'));
    assert.ok(profile.motionLanguage.transitions.includes('whip_pan'));
  });

  it('preserves locked scenes and calculates exact sequential startTimeMs', () => {
    const normalized = normalizeSceneTimingAndLocking(
      15000,
      [
        {
          id: 10,
          title: 'Locked Opening Hook',
          durationMs: 4000,
          locked: true,
          textContent: 'تخفیف ویژه بهاره',
          visualPrompt: 'Hero logo intro',
          animationPreset: 'kinetic_pop',
          transitionType: 'cross_dissolve',
          effectsConfig: {},
          layersConfig: [],
          variants: [],
          activeVariantIndex: 0,
        },
        {
          id: 11,
          title: 'Unlocked Old Scene',
          durationMs: 5000,
          locked: false,
          textContent: 'Old',
          visualPrompt: 'Old',
          animationPreset: 'fade_slide_up',
          transitionType: 'hard_cut',
          effectsConfig: {},
          layersConfig: [],
          variants: [],
          activeVariantIndex: 0,
        },
      ],
      [
        {
          title: 'New Feature Highlight',
          durationSharePercent: 50,
          textContent: 'ارسال رایگان به سراسر کشور',
          visualPrompt: 'Product close-up',
          animationPreset: 'slide_left',
          transitionType: 'whip_pan',
          cameraMotion: 'Pan',
          visualEffects: ['Glow'],
          attachedAssetId: null,
        },
        {
          title: 'New Final CTA',
          durationSharePercent: 50,
          textContent: 'همین حالا سفارش دهید',
          visualPrompt: 'CTA card',
          animationPreset: 'scale_reveal',
          transitionType: 'fade_out',
          cameraMotion: 'Zoom',
          visualEffects: ['Shadow'],
          attachedAssetId: null,
        },
      ],
      {
        primary: '#0F172A',
        secondary: '#1E293B',
        accent: '#2563EB',
        background: '#0B0F17',
        text: '#F8FAFC',
        swatches: ['#0F172A', '#2563EB'],
      },
      [],
      true
    );

    assert.equal(normalized.length, 3);
    assert.equal(normalized[0].locked, true);
    assert.equal(normalized[0].title, 'Locked Opening Hook');
    assert.equal(normalized[0].startTimeMs, 0);
    assert.equal(normalized[0].durationMs, 4000);
    assert.equal(normalized[1].startTimeMs, 4000);
    assert.equal(normalized[2].startTimeMs, normalized[1].startTimeMs + normalized[1].durationMs);
    const totalSum = normalized.reduce((s, r) => s + r.durationMs, 0);
    assert.equal(totalSum, 15000);
  });

  it('guards all Phase 4 blueprint & scene endpoints with 401 when unauthenticated', async () => {
    const endpoints: Array<{ method: string; url: string }> = [
      { method: 'GET', url: `${baseUrl}/api/projects/1/blueprint` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/blueprint/generate` },
      { method: 'PATCH', url: `${baseUrl}/api/projects/1/blueprint/style` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/scenes` },
      { method: 'PATCH', url: `${baseUrl}/api/projects/1/scenes/1` },
      { method: 'POST', url: `${baseUrl}/api/projects/1/scenes/1/regenerate` },
      { method: 'DELETE', url: `${baseUrl}/api/projects/1/scenes/1` },
    ];

    for (const ep of endpoints) {
      const res = await fetch(ep.url, { method: ep.method });
      assert.equal(res.status, 401, `Expected 401 for ${ep.method} ${ep.url}`);
      const json = (await res.json()) as { code: string };
      assert.equal(json.code, 'AUTH_MISSING_TOKEN');
    }
  });
});
