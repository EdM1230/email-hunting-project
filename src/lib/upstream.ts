import { config } from '../config.js';
import type { VerificationResult } from '../types.js';

/**
 * Delegate verification to another instance of this app.
 *
 * Serverless platforms block outbound port 25, so a Netlify deployment can
 * never confirm a mailbox on its own. Pointing `VERIFY_UPSTREAM_URL` at an
 * instance running somewhere with port 25 open keeps the hosted UI and API
 * while the SMTP work happens on a box that can actually do it.
 */
export class UpstreamError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export function hasUpstream(): boolean {
  return Boolean(config.upstreamUrl);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);

  try {
    const response = await fetch(`${config.upstreamUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.upstreamKey ? { 'X-API-Key': config.upstreamKey } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new UpstreamError(
        `Upstream verifier returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`
      );
    }
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new UpstreamError(`Upstream verifier timed out after ${config.upstreamTimeoutMs}ms`);
    }
    throw new UpstreamError(
      `Could not reach the upstream verifier: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  } finally {
    clearTimeout(timer);
  }
}

export function verifyUpstream(
  email: string,
  options: { skipSmtp?: boolean; fresh?: boolean } = {}
): Promise<VerificationResult> {
  return post<VerificationResult>('/api/verify', { email, ...options });
}

/** Confirm the upstream is reachable, so /api/health can report it honestly. */
export async function pingUpstream(): Promise<{ reachable: boolean; error?: string }> {
  try {
    const response = await fetch(`${config.upstreamUrl}/api/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { reachable: false, error: `HTTP ${response.status}` };
    const health = (await response.json()) as { smtpEnabled?: boolean };
    return health.smtpEnabled === false
      ? { reachable: true, error: 'Upstream reachable, but its SMTP stage is disabled' }
      : { reachable: true };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}
