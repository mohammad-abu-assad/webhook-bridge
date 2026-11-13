export type DiscordMessage = {
  embeds: Array<{ title: string; url?: string; color: number }>;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function formatEvent(event: string, payload: unknown): DiscordMessage | null {
  const data = record(payload);
  if (!data) return null;

  if (event === 'workflow_run' && data.action === 'completed') {
    const run = record(data.workflow_run);
    if (!run || typeof run.html_url !== 'string' || !run.html_url) return null;
    if (run.conclusion === 'failure') {
      return { embeds: [{ title: 'Deploy failed', url: run.html_url, color: 0xed4245 }] };
    }
    if (run.conclusion === 'success') {
      return { embeds: [{ title: 'Deploy passed', url: run.html_url, color: 0x57f287 }] };
    }
  }

  if (event === 'push' && data.ref === 'refs/heads/main') {
    const url = typeof data.compare === 'string' && data.compare ? data.compare : undefined;
    return { embeds: [{ title: 'New push', ...(url ? { url } : {}), color: 0x5865f2 }] };
  }
  return null;
}
