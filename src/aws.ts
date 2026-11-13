import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { GetParametersCommand, type GetParametersCommandOutput } from '@aws-sdk/client-ssm';

const githubName = '/webhook-bridge/github-webhook-secret';
const discordName = '/webhook-bridge/discord-webhook-url';
const thirtyDays = 30 * 24 * 60 * 60;

export type Secrets = { githubSecret: string; discordUrl: string };

export function createDeliveryClaim(send: (command: PutItemCommand) => Promise<unknown>, now = Date.now) {
  return async (eventId: string): Promise<boolean> => {
    try {
      await send(new PutItemCommand({
        TableName: 'processed-events',
        Item: { eventId: { S: eventId }, expiresAt: { N: String(Math.floor(now() / 1000) + thirtyDays) } },
        ConditionExpression: 'attribute_not_exists(eventId)',
      }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  };
}

export function createSecretLoader(send: (command: GetParametersCommand) => Promise<GetParametersCommandOutput>) {
  let cached: Promise<Secrets> | undefined;
  return (): Promise<Secrets> => {
    if (!cached) {
      cached = (async () => {
        const result = await send(new GetParametersCommand({ Names: [githubName, discordName], WithDecryption: true }));
        const values = new Map(result.Parameters?.map((parameter) => [parameter.Name, parameter.Value]));
        const githubSecret = values.get(githubName);
        const discordUrl = values.get(discordName);
        if (!githubSecret || !discordUrl) throw new Error('Required SSM parameters are missing');
        return { githubSecret, discordUrl };
      })().catch((error: unknown) => {
        cached = undefined;
        throw error;
      });
    }
    return cached;
  };
}
