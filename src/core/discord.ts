import type { DiscordMessage } from './format.js';

type Options = {
  send?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

export async function sendDiscordMessage(url: string, message: DiscordMessage, options: Options = {}): Promise<void> {
  const send = options.send ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;

  for (let attempt = 0; attempt < 3; attempt++) {
    let retryable = true;
    try {
      const response = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return;
      retryable = response.status === 429 || response.status >= 500;
      // Avoid retrying sooner than Discord permits, or waiting past our short budget.
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (retryAfter > 0) retryable = false;
      }
      await response.body?.cancel();
    } catch {
      // Network errors and timeouts can be transient. Do not expose the webhook URL.
    }
    if (!retryable || attempt === 2) break;
    const base = 100 * 2 ** attempt;
    await sleep(base + Math.floor(random() * base));
  }
  throw new Error('Discord delivery failed');
}
