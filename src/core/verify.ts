import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifySignature(body: Buffer, header: string | undefined, secret: string): boolean {
  if (!header || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;

  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(body).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
