import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../src/lambda.js';

const secret = 'test-secret';
const body = JSON.stringify({ action: 'completed', workflow_run: { conclusion: 'failure', html_url: 'https://github.com/example/repo/actions/runs/1' } });
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const event = { headers: { 'x-hub-signature-256': signature, 'x-github-delivery': 'delivery-1', 'x-github-event': 'workflow_run' }, body, isBase64Encoded: false };

function setup() {
  const deps = {
    loadSecrets: vi.fn().mockResolvedValue({ githubSecret: secret, discordUrl: 'https://example.test/webhook' }),
    claimDelivery: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
  };
  return { deps, handle: createHandler(deps) };
}

describe('Lambda function URL handler', () => {
  it('verifies and sends a base64-encoded event', async () => {
    const { deps, handle } = setup();
    const result = await handle({ ...event, body: Buffer.from(body).toString('base64'), isBase64Encoded: true });
    expect(result.statusCode).toBe(200);
    expect(deps.claimDelivery).toHaveBeenCalledWith('delivery-1');
    expect(deps.sendMessage).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: 'delivery-1', event: 'workflow_run', action: 'completed', outcome: 'alerted', durationMs: expect.any(Number) }));
  });

  it('rejects tampered and missing signatures without writing to DynamoDB', async () => {
    const { deps, handle } = setup();
    expect((await handle({ ...event, body: '{}' })).statusCode).toBe(401);
    expect((await handle({ ...event, headers: {} })).statusCode).toBe(401);
    expect(deps.claimDelivery).not.toHaveBeenCalled();
  });

  it('acknowledges duplicates without sending an alert', async () => {
    const { deps, handle } = setup();
    deps.claimDelivery.mockResolvedValue(false);
    expect((await handle(event)).statusCode).toBe(200);
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'duplicate' }));
  });

  it('returns an error for DynamoDB failures and never sends', async () => {
    const { deps, handle } = setup();
    deps.claimDelivery.mockRejectedValue(new Error('database unavailable'));
    expect((await handle(event)).statusCode).toBe(500);
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }));
  });

  it('rejects missing delivery IDs after verification', async () => {
    const { deps, handle } = setup();
    expect((await handle({ ...event, headers: { 'x-hub-signature-256': signature } })).statusCode).toBe(400);
    expect(deps.claimDelivery).not.toHaveBeenCalled();
  });

  it('ignores ping and logs it', async () => {
    const { deps, handle } = setup();
    const ping = '{}';
    const pingSignature = `sha256=${createHmac('sha256', secret).update(ping).digest('hex')}`;
    expect((await handle({ ...event, body: ping, headers: { ...event.headers, 'x-github-event': 'ping', 'x-hub-signature-256': pingSignature } })).statusCode).toBe(200);
    expect(deps.sendMessage).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'ignored' }));
  });

  it('returns an error when sending fails after the delivery is claimed', async () => {
    const { deps, handle } = setup();
    deps.sendMessage.mockRejectedValue(new Error('failure'));
    expect((await handle(event)).statusCode).toBe(502);
    expect(deps.claimDelivery).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }));
  });
});
