import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { createDeliveryClaim, createSecretLoader, type Secrets } from './aws.js';
import { sendDiscordMessage } from './core/discord.js';
import { formatEvent, type DiscordMessage } from './core/format.js';
import { verifySignature } from './core/verify.js';

type FunctionUrlEvent = {
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type LogEntry = {
  deliveryId: string | null;
  event: string | null;
  action: string | null;
  outcome: 'alerted' | 'duplicate' | 'ignored' | 'rejected' | 'error';
  durationMs: number;
};

type Dependencies = {
  loadSecrets: () => Promise<Secrets>;
  claimDelivery: (deliveryId: string) => Promise<boolean>;
  sendMessage: (url: string, message: DiscordMessage) => Promise<void>;
  log: (entry: LogEntry) => void;
};

export function createHandler(deps: Dependencies) {
  return async (request: FunctionUrlEvent): Promise<{ statusCode: number; body: string }> => {
    const started = performance.now();
    const headers = request.headers ?? {};
    const deliveryId = headers['x-github-delivery'] ?? null;
    const event = headers['x-github-event'] ?? null;
    let action: string | null = null;
    let outcome: LogEntry['outcome'] = 'error';
    const result = (statusCode: number, body: string) => ({ statusCode, body });

    try {
      const secrets = await deps.loadSecrets();
      const rawBody = Buffer.from(request.body ?? '', request.isBase64Encoded ? 'base64' : 'utf8');
      if (!verifySignature(rawBody, headers['x-hub-signature-256'], secrets.githubSecret)) {
        outcome = 'rejected';
        return result(401, 'Unauthorized');
      }
      if (!deliveryId?.trim()) {
        outcome = 'rejected';
        return result(400, 'Delivery ID is required');
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch {
        outcome = 'rejected';
        return result(400, 'Invalid JSON');
      }
      if (payload !== null && typeof payload === 'object' && 'action' in payload && typeof payload.action === 'string') action = payload.action;

      if (!await deps.claimDelivery(deliveryId)) {
        outcome = 'duplicate';
        return result(200, 'OK');
      }
      const message = formatEvent(event ?? '', payload);
      if (!message) {
        outcome = 'ignored';
        return result(200, 'OK');
      }
      try {
        await deps.sendMessage(secrets.discordUrl, message);
      } catch {
        return result(502, 'Discord delivery failed');
      }
      outcome = 'alerted';
      return result(200, 'OK');
    } catch {
      return result(500, 'Internal server error');
    } finally {
      deps.log({ deliveryId, event, action, outcome, durationMs: Math.round(performance.now() - started) });
    }
  };
}

const dynamodb = new DynamoDBClient({ maxAttempts: 2 });
const ssm = new SSMClient({ maxAttempts: 2 });

export const handler = createHandler({
  loadSecrets: createSecretLoader((command) => ssm.send(command, { abortSignal: AbortSignal.timeout(1000) })),
  claimDelivery: createDeliveryClaim((command) => dynamodb.send(command, { abortSignal: AbortSignal.timeout(1000) })),
  sendMessage: sendDiscordMessage,
  log: (entry) => console.log(JSON.stringify(entry)),
});
