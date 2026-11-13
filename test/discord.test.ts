import { describe, expect, it, vi } from 'vitest';
import { sendDiscordMessage } from '../src/core/discord.js';

const message = { embeds: [{ title: 'Deploy failed', color: 0xed4245 }] };
const url = 'https://discord.com/api/webhooks/test/token';

describe('sendDiscordMessage', () => {
  it('posts the embed as JSON', async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await sendDiscordMessage(url, message, { send });
    expect(send).toHaveBeenCalledOnce();
    const [destination, options] = send.mock.calls[0];
    expect(destination).toBe(url);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(message);
    expect(options.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('retries transient responses and network errors at most twice', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await sendDiscordMessage(url, message, { send, sleep, random: () => 0 });
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([100, 200]);
  });

  it('stops after three failed attempts', async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(sendDiscordMessage(url, message, { send, sleep })).rejects.toThrow('Discord delivery failed');
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-rate-limit client errors', async () => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    await expect(sendDiscordMessage(url, message, { send })).rejects.toThrow('Discord delivery failed');
    expect(send).toHaveBeenCalledOnce();
  });
});
