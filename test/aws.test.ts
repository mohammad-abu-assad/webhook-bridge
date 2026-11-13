import { describe, expect, it, vi } from 'vitest';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { GetParametersCommand } from '@aws-sdk/client-ssm';
import { createDeliveryClaim, createSecretLoader } from '../src/aws.js';

describe('AWS adapters', () => {
  it('conditionally writes a delivery with a 30-day expiry', async () => {
    const send = vi.fn().mockResolvedValue({});
    const claim = createDeliveryClaim(send, () => 1_700_000_000_000);
    expect(await claim('delivery-1')).toBe(true);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutItemCommand);
    expect(command.input).toEqual({ TableName: 'processed-events', Item: { eventId: { S: 'delivery-1' }, expiresAt: { N: String(1_700_000_000 + 30 * 24 * 60 * 60) } }, ConditionExpression: 'attribute_not_exists(eventId)' });
  });

  it('treats only a conditional failure as a duplicate', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { name: 'ConditionalCheckFailedException' });
    const send = vi.fn().mockRejectedValueOnce(duplicate).mockRejectedValueOnce(new Error('unavailable'));
    const claim = createDeliveryClaim(send);
    expect(await claim('x')).toBe(false);
    await expect(claim('y')).rejects.toThrow('unavailable');
  });

  it('decrypts both SSM parameters once for concurrent and later calls', async () => {
    const send = vi.fn().mockResolvedValue({ Parameters: [
      { Name: '/webhook-bridge/github-webhook-secret', Value: 'test-secret' },
      { Name: '/webhook-bridge/discord-webhook-url', Value: 'test-url' },
    ] });
    const load = createSecretLoader(send);
    expect(await Promise.all([load(), load()])).toEqual([{ githubSecret: 'test-secret', discordUrl: 'test-url' }, { githubSecret: 'test-secret', discordUrl: 'test-url' }]);
    await load();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetParametersCommand);
    expect(send.mock.calls[0][0].input).toEqual({ Names: ['/webhook-bridge/github-webhook-secret', '/webhook-bridge/discord-webhook-url'], WithDecryption: true });
  });

  it('retries loading secrets after a failed or incomplete response', async () => {
    const send = vi.fn().mockResolvedValueOnce({ Parameters: [] }).mockResolvedValueOnce({ Parameters: [
      { Name: '/webhook-bridge/github-webhook-secret', Value: 'test-secret' },
      { Name: '/webhook-bridge/discord-webhook-url', Value: 'test-url' },
    ] });
    const load = createSecretLoader(send);
    await expect(load()).rejects.toThrow();
    expect(await load()).toEqual({ githubSecret: 'test-secret', discordUrl: 'test-url' });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
