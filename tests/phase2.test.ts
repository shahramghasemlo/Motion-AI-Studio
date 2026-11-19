import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { STARTER_TEMPLATES } from '../src/shared/templates.ts';
import { studioWsHub } from '../src/server/ws.ts';

describe('Phase 2 — Starter Templates & API Hardening', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    process.env.NODE_ENV = 'production';
    process.env.MAX_UPLOAD_MB = 'invalid-non-numeric-value';
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

  it('validates starter templates catalog integrity', () => {
    assert.ok(STARTER_TEMPLATES.length >= 4);
    for (const tpl of STARTER_TEMPLATES) {
      assert.ok(tpl.id);
      assert.ok(tpl.titleFa && tpl.titleEn);
      assert.ok(tpl.defaultScenes.length >= 3);
    }
  });

  it('guards /api/dashboard with 401 when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard`);
    assert.equal(res.status, 401);
    const json = (await res.json()) as { code: string };
    assert.equal(json.code, 'AUTH_MISSING_TOKEN');
  });

  it('returns JSON 404 on unknown /api/* route instead of HTML fallback', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('application/json'));
    const body = (await res.json()) as { error: string };
    assert.ok(body.error);
  });
});
