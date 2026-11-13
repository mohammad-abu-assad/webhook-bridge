import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySignature } from '../src/core/verify.js';

describe('verifySignature', () => {
  const secret = 'test-secret';
  const body = Buffer.from('{"action":"completed"}');
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts a valid signature', () => {
    expect(verifySignature(body, signature, secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifySignature(Buffer.from('{"action":"changed"}'), signature, secret)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
  });

  it('rejects malformed signatures', () => {
    expect(verifySignature(body, 'sha256=xyz', secret)).toBe(false);
  });
});
