import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { WebSocket } from 'ws';
import {
  cleanupTempJobDir,
  deleteUserMediaFile,
  resolveSafeUserPath,
  saveUserMediaFile,
  UPLOADS_DIR,
  validateMagicHeader,
} from '../src/server/storage.ts';
import { studioWsHub } from '../src/server/ws.ts';

describe('Phase 1 — Storage Security & Validation', () => {
  it('accepts valid PNG magic header and rejects spoofed PNG', () => {
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const fakePng = Buffer.from('#!/bin/sh\nrm -rf /', 'utf8');

    assert.equal(validateMagicHeader(validPng, 'png').valid, true);
    assert.equal(validateMagicHeader(fakePng, 'png').valid, false);
  });

  it('blocks SVG containing <script> or inline event handlers', () => {
    const cleanSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    const xssSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const onloadSvg = Buffer.from('<svg onload="alert(1)"></svg>');

    assert.equal(validateMagicHeader(cleanSvg, 'svg').valid, true);
    assert.equal(validateMagicHeader(xssSvg, 'svg').valid, false);
    assert.equal(validateMagicHeader(onloadSvg, 'svg').valid, false);
  });

  it('prevents path traversal outside storage directory', () => {
    assert.throws(() => resolveSafeUserPath(UPLOADS_DIR, '../../etc/passwd'));
  });

  it('saves, hashes with SHA-256, and cleans up user media safely', async () => {
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const saved = await saveUserMediaFile(99999, 'logo.png', validPng);
    assert.equal(saved.extension, 'png');
    assert.equal(saved.sha256Hash.length, 64);
    await deleteUserMediaFile(saved.storageKey);
    await cleanupTempJobDir('test_nonexistent_job');
  });
});

describe('Phase 1 — HTTP Server, Auth Gate & WebSocket', () => {
  let server: http.Server;
  let baseUrl: string;
  let wsUrl: string;

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
    wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
  });

  after(async () => {
    studioWsHub.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    const { pool } = await import('../src/db/index.ts');
    await pool.end();
  });

  it('responds 200 on /api/health with FFmpeg capability status', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      status: string;
      phase: number;
      capabilities: { ffmpegAvailable: boolean };
    };
    assert.equal(body.status, 'ok');
    assert.equal(body.phase, 1);
    assert.equal(typeof body.capabilities.ffmpegAvailable, 'boolean');
  });

  it('enforces authentication on protected routes (returns 401 without Bearer token)', async () => {
    const endpoints = ['/api/auth/me', '/api/projects', '/api/media', '/api/providers'];
    for (const ep of endpoints) {
      const res = await fetch(`${baseUrl}${ep}`);
      assert.equal(res.status, 401, `Expected 401 on ${ep}`);
      const json = (await res.json()) as { code: string };
      assert.equal(json.code, 'AUTH_MISSING_TOKEN');
    }
  });

  it('connects over WebSocket and responds to ping with pong', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket test timed out'));
      }, 4000);

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as { type: string };
        if (msg.type === 'connection:ready') {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else if (msg.type === 'pong') {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });
});
