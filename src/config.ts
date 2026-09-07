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

  /** Disable the SMTP stage entirely and rely on syntax + DNS heuristics. */
  smtpEnabled: bool('SMTP_ENABLED', true),
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
  bulkMaxEmails: num('BULK_MAX_EMAILS', 1000),

  /** Serialize probes per mail exchanger and pause between them. */
  perHostDelayMs: num('PER_HOST_DELAY_MS', 1200),

  rateLimitWindowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
  rateLimitMax: num('RATE_LIMIT_MAX', 60),

  /** When set, every /api request must send `X-API-Key` with this value. */
  apiKey: process.env.API_KEY ?? '',
} as const;

export type Config = typeof config;
