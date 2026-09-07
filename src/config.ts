import 'dotenv/config';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * True when running inside a serverless function (Netlify, AWS Lambda).
 *
 * This is not a cosmetic distinction. Lambda-based platforms block outbound
 * port 25 with no exception, so the SMTP stage cannot work there, and every
 * probe would simply burn the function's execution time until it timed out.
 * The defaults below change accordingly.
 */
export const isServerless = Boolean(
  process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT
);

/**
 * Upstream verifier URL, e.g. `https://probe.yourdomain.com`.
 *
 * When set, verification is delegated to another instance of this app running
 * somewhere that *does* have outbound port 25. That is how a serverless
 * deployment still confirms real mailboxes: this instance serves the UI and
 * API, and the upstream box does the SMTP work.
 */

export const config = {
  port: num('PORT', 3000),

  /**
   * Hostname sent in the SMTP EHLO. Mail servers check that this resolves and
   * matches the connecting IP's reverse DNS - a mismatch is the fastest way to
   * get your prober blocked, so set it to a real hostname you control.
   */
  smtpHeloHost: process.env.SMTP_HELO_HOST ?? 'localhost',

  /**
   * Address used in `MAIL FROM`. Should be a real, monitored mailbox on a
   * domain with SPF configured; empty-sender probes are widely rejected.
   */
  smtpFromEmail: process.env.SMTP_FROM_EMAIL ?? 'verify@localhost',

  /**
   * Disable the SMTP stage entirely and rely on syntax + DNS heuristics.
   * Defaults to off under serverless, where port 25 is blocked regardless.
   */
  smtpEnabled: bool('SMTP_ENABLED', !isServerless),
  smtpPort: num('SMTP_PORT', 25),
  smtpTimeoutMs: num('SMTP_TIMEOUT_MS', 8000),
  /** How many mail exchangers to try before giving up on a domain. */
  smtpMaxHosts: num('SMTP_MAX_HOSTS', 2),
  /** Probe a random local part to detect accept-all domains. */
  catchAllDetection: bool('CATCH_ALL_DETECTION', true),

  /** Verified results are memoized for this long to spare remote servers. */
  cacheTtlMs: num('CACHE_TTL_MS', 24 * 60 * 60 * 1000),
  cacheMaxEntries: num('CACHE_MAX_ENTRIES', 50_000),

  /** Parallel verifications inside one bulk request. Keep low: be a good citizen. */
  bulkConcurrency: num('BULK_CONCURRENCY', 5),
  /**
   * Cap per bulk request. Serverless functions are killed at a hard wall-clock
   * limit (30s on Netlify), so a large list must be chunked by the client
   * rather than accepted and then truncated by a timeout.
   */
  bulkMaxEmails: num('BULK_MAX_EMAILS', isServerless ? 100 : 1000),

  /** Serialize probes per mail exchanger and pause between them. */
  perHostDelayMs: num('PER_HOST_DELAY_MS', 1200),

  rateLimitWindowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: num('RATE_LIMIT_MAX', 60),

  /** When set, every /api request must send `X-API-Key` with this value. */
  apiKey: process.env.API_KEY ?? '',

  // The upstream settings are read per call rather than captured at import.
  // A serverless container is long-lived, and this lets the prober be pointed
  // somewhere else without a redeploy.

  /** Delegate verification to an upstream instance that has port 25 open. */
  get upstreamUrl(): string {
    return (process.env.VERIFY_UPSTREAM_URL ?? '').trim().replace(/\/+$/, '');
  },
  /** `X-API-Key` sent to the upstream verifier. */
  get upstreamKey(): string {
    return process.env.VERIFY_UPSTREAM_KEY ?? '';
  },
  /** Give up on the upstream well inside the serverless execution limit. */
  get upstreamTimeoutMs(): number {
    return num('VERIFY_UPSTREAM_TIMEOUT_MS', isServerless ? 20_000 : 30_000);
  },

  isServerless,
} as const;

export type Config = typeof config;
