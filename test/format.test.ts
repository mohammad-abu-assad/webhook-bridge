import { describe, expect, it } from 'vitest';
import { formatEvent } from '../src/core/format.js';

describe('formatEvent', () => {
  const run = { html_url: 'https://github.com/example/repo/actions/runs/123' };

  it.each([
    ['failure', 'Deploy failed', 0xed4245],
    ['success', 'Deploy passed', 0x57f287],
  ])('formats a completed %s workflow', (conclusion, title, color) => {
    expect(formatEvent('workflow_run', { action: 'completed', workflow_run: { ...run, conclusion } }))
      .toEqual({ embeds: [{ title, url: run.html_url, color }] });
  });

  it('formats a push to main', () => {
    expect(formatEvent('push', { ref: 'refs/heads/main', compare: 'https://github.com/example/repo/compare/a...b' }))
      .toEqual({ embeds: [{ title: 'New push', url: 'https://github.com/example/repo/compare/a...b', color: 0x5865f2 }] });
  });

  it.each([
    ['workflow_run', { action: 'requested', workflow_run: { ...run, conclusion: 'failure' } }],
    ['workflow_run', { action: 'completed', workflow_run: { ...run, conclusion: 'cancelled' } }],
    ['workflow_run', { action: 'completed', workflow_run: { conclusion: 'failure' } }],
    ['push', { ref: 'refs/heads/other' }],
    ['ping', {}],
    ['unknown', {}],
    ['push', null],
  ])('ignores unsupported or incomplete %s events', (event, payload) => {
    expect(formatEvent(event, payload)).toBeNull();
  });
});
