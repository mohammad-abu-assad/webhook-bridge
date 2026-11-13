import { describe, expect, it, vi } from 'vitest';
import { DeliveryStore } from '../src/core/dedupe.js';

describe('DeliveryStore', () => {
  it('processes a delivery only once', async () => {
    const store = new DeliveryStore();
    const work = vi.fn().mockResolvedValue(undefined);
    expect(await store.process('delivery-1', work)).toBe('processed');
    expect(await store.process('delivery-1', work)).toBe('duplicate');
    expect(work).toHaveBeenCalledOnce();
    expect(await store.process('delivery-2', work)).toBe('processed');
  });

  it('waits for an in-progress delivery without repeating its work', async () => {
    const store = new DeliveryStore();
    let finish!: () => void;
    const work = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = store.process('delivery-1', work);
    const second = store.process('delivery-1', work);
    expect(work).toHaveBeenCalledOnce();
    finish();
    expect(await first).toBe('processed');
    expect(await second).toBe('duplicate');
  });

  it('allows a later attempt when the first delivery fails', async () => {
    const store = new DeliveryStore();
    const work = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(undefined);
    await expect(store.process('delivery-1', work)).rejects.toThrow('failed');
    expect(await store.process('delivery-1', work)).toBe('processed');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('reports a failure to concurrent callers and permits a later retry', async () => {
    const store = new DeliveryStore();
    let fail!: (error: Error) => void;
    const work = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const first = store.process('delivery-1', work);
    const second = store.process('delivery-1', work);
    const results = Promise.allSettled([first, second]);
    fail(new Error('failed'));
    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(await store.process('delivery-1', async () => {})).toBe('processed');
  });
});
