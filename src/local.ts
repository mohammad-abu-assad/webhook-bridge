import express from 'express';
import { pathToFileURL } from 'node:url';
import { verifySignature } from './core/verify.js';
import { formatEvent } from './core/format.js';
import { sendDiscordMessage } from './core/discord.js';
import { DeliveryStore } from './core/dedupe.js';

export const app = express();
const deliveries = new DeliveryStore();
class MissingDiscordUrlError extends Error {}

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

app.post('/webhooks/github', (request, response, next) => {
  const start = performance.now();
  response.locals.action = null;
  response.locals.outcome = 'error';
  response.on('finish', () => {
    console.log(JSON.stringify({
      deliveryId: request.get('x-github-delivery') ?? null,
      event: request.get('x-github-event') ?? null,
      action: response.locals.action,
      outcome: response.locals.outcome,
      durationMs: Math.round(performance.now() - start),
    }));
  });
  next();
}, express.raw({ type: 'application/json' }), async (request, response) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    response.status(500).send('Webhook secret is not configured');
    return;
  }

  if (!Buffer.isBuffer(request.body) || !verifySignature(request.body, request.get('x-hub-signature-256'), secret)) {
    response.locals.outcome = 'rejected';
    response.sendStatus(401);
    return;
  }

  const deliveryId = request.get('x-github-delivery');
  if (!deliveryId || !deliveryId.trim()) {
    response.locals.outcome = 'rejected';
    response.status(400).send('Delivery ID is required');
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(request.body.toString('utf8'));
  } catch {
    response.locals.outcome = 'rejected';
    response.sendStatus(400);
    return;
  }

  if (payload !== null && typeof payload === 'object' && 'action' in payload && typeof payload.action === 'string') {
    response.locals.action = payload.action;
  }

  const message = formatEvent(request.get('x-github-event') ?? '', payload);
  try {
    const result = await deliveries.process(deliveryId, async () => {
      if (!message) return;
      const discordUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!discordUrl) throw new MissingDiscordUrlError();
      await sendDiscordMessage(discordUrl, message);
    });
    response.locals.outcome = result === 'duplicate' ? 'duplicate' : message ? 'alerted' : 'ignored';
    response.sendStatus(200);
  } catch (error) {
    if (error instanceof MissingDiscordUrlError) response.status(500).send('Discord webhook is not configured');
    else response.status(502).send('Discord delivery failed');
  }
});

app.use('/webhooks/github', (error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const status = typeof error === 'object' && error !== null && 'status' in error && error.status === 413 ? 413 : 400;
  response.locals.outcome = 'rejected';
  response.sendStatus(status);
});

// Only listen when this file is run directly, not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(3000, () => {
    console.log('Server listening on port 3000');
  });
}
