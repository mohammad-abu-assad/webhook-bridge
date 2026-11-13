import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { app } from '../src/local.js';

describe('GET /health', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('returns a successful health response', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /webhooks/github', () => {
  let server: Server;
  let url: string;
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const previousDiscordUrl = process.env.DISCORD_WEBHOOK_URL;
  const secret = 'test-secret';

  beforeAll(async () => {
    process.env.GITHUB_WEBHOOK_SECRET = secret;
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/token';
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP address');
    url = `http://127.0.0.1:${address.port}/webhooks/github`;
  });

  afterAll(async () => {
    if (previousSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
    if (previousDiscordUrl === undefined) delete process.env.DISCORD_WEBHOOK_URL;
    else process.env.DISCORD_WEBHOOK_URL = previousDiscordUrl;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('sends a Discord embed for a verified completed failure', async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    // Keep the real fetch for making the request to our local server.
    const localFetch = fetch;
    vi.stubGlobal('fetch', send);
    const body = JSON.stringify({ action: 'completed', workflow_run: { conclusion: 'failure', html_url: 'https://github.com/example/repo/actions/runs/1' } });
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const response = await localFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-event': 'workflow_run', 'x-github-delivery': 'alert-test' }, body });
    expect(response.status).toBe(200);
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ embeds: [{ title: 'Deploy failed', url: 'https://github.com/example/repo/actions/runs/1', color: 0xed4245 }] });
  });

  it('acknowledges ignored events without contacting Discord', async () => {
    const send = vi.fn();
    const localFetch = fetch;
    vi.stubGlobal('fetch', send);
    const body = '{}';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const response = await localFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-event': 'ping', 'x-github-delivery': 'ping-test' }, body });
    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns an error if Discord rejects the alert', async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    const localFetch = fetch;
    vi.stubGlobal('fetch', send);
    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const response = await localFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-event': 'push', 'x-github-delivery': 'failed-test' }, body });
    expect(response.status).toBe(502);
  });

  it('accepts a valid signature for the exact raw body', async () => {
    const body = '{ "action": "completed" }';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-delivery': 'raw-test' }, body });
    expect(response.status).toBe(200);
  });

  it('rejects a tampered body', async () => {
    const signature = `sha256=${createHmac('sha256', secret).update('{"original":true}').digest('hex')}`;
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body: '{"original":false}' });
    expect(response.status).toBe(401);
  });

  it('rejects a missing signature', async () => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
  });

  it('sends only once for a repeated delivery ID', async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const localFetch = fetch;
    vi.stubGlobal('fetch', send);
    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const options = { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-event': 'push', 'x-github-delivery': 'duplicate-test' }, body };
    expect((await localFetch(url, options)).status).toBe(200);
    expect((await localFetch(url, options)).status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
  });

  it('rejects a verified request with no delivery ID', async () => {
    const body = '{}';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
    expect(response.status).toBe(400);
  });

  it('logs one JSON line for an alert and its duplicate without secrets', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const localFetch = fetch;
    vi.stubGlobal('fetch', send);
    const body = JSON.stringify({ action: 'completed', workflow_run: { conclusion: 'failure', html_url: 'https://github.com/example/repo/actions/runs/1' } });
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const options = { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, 'x-github-event': 'workflow_run', 'x-github-delivery': 'logging-test' }, body };
    expect((await localFetch(url, options)).status).toBe(200);
    expect((await localFetch(url, options)).status).toBe(200);
    expect(log).toHaveBeenCalledTimes(2);
    const lines = log.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(lines.map((line) => line.outcome)).toEqual(['alerted', 'duplicate']);
    for (const line of lines) {
      expect(line).toEqual({ deliveryId: 'logging-test', event: 'workflow_run', action: 'completed', outcome: expect.any(String), durationMs: expect.any(Number) });
      expect(JSON.stringify(line)).not.toContain(secret);
      expect(JSON.stringify(line)).not.toContain('token');
    }
  });
});
