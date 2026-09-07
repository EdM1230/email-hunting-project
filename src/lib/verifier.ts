import { config } from '../config.js';
import { DISPOSABLE_DOMAINS, FREE_PROVIDERS } from '../data/domains.js';
import type {
  VerificationChecks,
  VerificationReason,
  VerificationResult,
  VerificationStatus,
} from '../types.js';
import { TtlCache } from './cache.js';
import { resolveDomain } from './dns.js';
import { probeMailbox, type SmtpProbeResult } from './smtp.js';
import { isRoleAccount, looksGibberish, parseEmail, suggestCorrection } from './syntax.js';

const cache = new TtlCache<VerificationResult>(config.cacheTtlMs, config.cacheMaxEntries);

export interface VerifyOptions {
  /** Skip the SMTP stage for this call (syntax + DNS only, always fast). */
  skipSmtp?: boolean;
  /** Bypass the memoized result and re-probe. */
  fresh?: boolean;
  /** Probe a random local part to detect accept-all domains. */
  detectCatchAll?: boolean;
}

function emptyChecks(): VerificationChecks {
  return {
    syntax: false,
    mxFound: false,
    smtpConnected: false,
    mailboxExists: null,
    catchAll: null,
    disposable: false,
    roleAccount: false,
    freeProvider: false,
    parkedDomain: false,
    gibberish: false,
  };
}

const MESSAGES: Record<VerificationReason, string> = {
  accepted_email: 'The mail server accepted this address.',
  invalid_syntax: 'This is not a valid email address.',
  invalid_domain: 'The domain does not resolve.',
  no_mx_record: 'The domain has no mail server, so it cannot receive email.',
  rejected_email: 'The mail server said this mailbox does not exist.',
  mailbox_full: 'The mailbox exists but is full, so delivery may bounce.',
  disposable_domain: 'This is a disposable, throwaway mailbox.',
  role_account: 'This is a shared role inbox rather than a person.',
  accept_all_domain: 'The domain accepts all addresses, so this cannot be confirmed.',
  greylisted: 'The mail server deferred the check. Retry in a few minutes.',
  smtp_unreachable: 'Could not reach the mail server to confirm the mailbox.',
  smtp_disabled: 'SMTP verification is turned off; result is based on DNS only.',
  timeout: 'The mail server did not respond in time.',
  blocked_by_provider: 'The provider blocks verification probes, so this cannot be confirmed.',
  unexpected_error: 'Verification failed because of an unexpected error.',
};

/**
 * Turn the collected signals into a status and a 0-100 confidence score.
 *
 * The score answers one question: how likely is a message to this address to
 * reach a human? It starts from the SMTP verdict and is then adjusted by the
 * heuristic signals, so a confirmed mailbox on a role account still scores
 * lower than a confirmed personal one.
 */
function score(
  reason: VerificationReason,
  checks: VerificationChecks
): { status: VerificationStatus; score: number } {
  let status: VerificationStatus;
  let value: number;

  switch (reason) {
    case 'invalid_syntax':
    case 'invalid_domain':
    case 'no_mx_record':
    case 'rejected_email':
      return { status: 'undeliverable', score: 0 };
    case 'disposable_domain':
      return { status: 'risky', score: 10 };
    case 'accepted_email':
      status = 'deliverable';
      value = 95;
      break;
    case 'accept_all_domain':
      status = 'risky';
      value = 45;
      break;
    case 'mailbox_full':
      status = 'risky';
      value = 35;
      break;
    case 'role_account':
      status = 'risky';
      value = 55;
      break;
    case 'greylisted':
    case 'blocked_by_provider':
    case 'timeout':
    case 'smtp_unreachable':
      status = 'unknown';
      value = 40;
      break;
    case 'smtp_disabled':
      // DNS-only: the domain can receive mail, but the mailbox is unconfirmed.
      status = 'unknown';
      value = 50;
      break;
    default:
      status = 'unknown';
      value = 30;
  }

  if (checks.roleAccount && reason !== 'role_account') value -= 20;
  if (checks.gibberish) value -= 15;
  if (checks.parkedDomain) value -= 25;
  if (checks.catchAll === true && reason === 'accepted_email') value -= 45;
  if (checks.freeProvider) value -= 3; // Valid, just a weaker B2B signal.

  value = Math.max(0, Math.min(100, Math.round(value)));

  // Keep status and score consistent after the adjustments above.
  if (status === 'deliverable' && value < 70) status = 'risky';
  if (checks.roleAccount && status === 'deliverable') status = 'risky';

  return { status, score: value };
}

function smtpReason(probe: SmtpProbeResult): VerificationReason {
  if (!probe.connected) {
    if (probe.error && /timeout/i.test(probe.error)) return 'timeout';
    return 'smtp_unreachable';
  }
  switch (probe.mailbox) {
    case 'exists':
      return probe.catchAll === true ? 'accept_all_domain' : 'accepted_email';
    case 'not_found':
      return 'rejected_email';
    case 'mailbox_full':
      return 'mailbox_full';
    case 'greylisted':
      return 'greylisted';
    case 'blocked':
      return 'blocked_by_provider';
    default:
      return 'smtp_unreachable';
  }
}

function finalize(
  input: string,
  normalized: string,
  localPart: string,
  domain: string,
  reason: VerificationReason,
  checks: VerificationChecks,
  extra: Partial<VerificationResult>,
  startedAt: number
): VerificationResult {
  const { status, score: value } = score(reason, checks);
  return {
    email: input,
    normalized,
    localPart,
    domain,
    status,
    score: value,
    reason,
    message: MESSAGES[reason],
    checks,
    mx: [],
    durationMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
    cached: false,
    ...extra,
  };
}

/** Run the full verification pipeline for one address. */
export async function verifyEmail(
  input: string,
  options: VerifyOptions = {}
): Promise<VerificationResult> {
  const startedAt = Date.now();
  const parsed = parseEmail(input);
  const checks = emptyChecks();

  // Stage 1 - syntax. Cheap and disqualifying, so it runs first.
  if (!parsed.valid) {
    return finalize(
      input,
      parsed.normalized,
      parsed.localPart,
      parsed.domain,
      'invalid_syntax',
      checks,
      {
        message: parsed.error ?? MESSAGES.invalid_syntax,
        didYouMean: parsed.domain ? suggestCorrection(parsed.domain) : undefined,
      },
      startedAt
    );
  }

  checks.syntax = true;
  const { normalized, localPart, domain } = parsed;
  const didYouMean = suggestCorrection(domain);
  const cacheKey = `${normalized}|${options.skipSmtp ? 'dns' : 'smtp'}`;

  if (!options.fresh) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit, email: input, cached: true };
  }

  // Stage 2 - static domain and local-part intelligence.
  checks.disposable = DISPOSABLE_DOMAINS.has(domain);
  checks.freeProvider = FREE_PROVIDERS.has(domain);
  checks.roleAccount = isRoleAccount(localPart);
  checks.gibberish = looksGibberish(localPart);

  if (checks.disposable) {
    const result = finalize(
      input, normalized, localPart, domain,
      'disposable_domain', checks, { didYouMean }, startedAt
    );
    cache.set(cacheKey, result);
    return result;
  }

  // Stage 3 - DNS. No mail exchanger means nothing can be delivered, ever.
  const domainInfo = await resolveDomain(domain);
  checks.mxFound = domainInfo.mx.length > 0;
  checks.parkedDomain = domainInfo.parked;

  if (!domainInfo.resolves) {
    const result = finalize(
      input, normalized, localPart, domain,
      'invalid_domain', checks, { didYouMean }, startedAt
    );
    cache.set(cacheKey, result);
    return result;
  }
  if (!checks.mxFound) {
    const result = finalize(
      input, normalized, localPart, domain,
      'no_mx_record', checks,
      {
        didYouMean,
        // RFC 7505: the domain published a null MX, which is an explicit
        // "we accept no mail" rather than a missing configuration.
        message: domainInfo.nullMx
          ? 'The domain publishes a null MX record and accepts no email at all.'
          : MESSAGES.no_mx_record,
      },
      startedAt
    );
    cache.set(cacheKey, result);
    return result;
  }

  // Stage 4 - SMTP envelope probe, the only stage that confirms a mailbox.
  const smtpOn = config.smtpEnabled && !options.skipSmtp;
  if (!smtpOn) {
    const reason: VerificationReason = checks.roleAccount ? 'role_account' : 'smtp_disabled';
    const result = finalize(
      input, normalized, localPart, domain, reason, checks,
      { mx: domainInfo.mx, didYouMean }, startedAt
    );
    cache.set(cacheKey, result);
    return result;
  }

  let probe: SmtpProbeResult;
  try {
    probe = await probeMailbox(normalized, domainInfo.mx.map((r) => r.exchange), {
      detectCatchAll: options.detectCatchAll ?? config.catchAllDetection,
    });
  } catch (err) {
    const result = finalize(
      input, normalized, localPart, domain, 'unexpected_error', checks,
      {
        mx: domainInfo.mx,
        didYouMean,
        smtpResponse: err instanceof Error ? err.message : String(err),
      },
      startedAt
    );
    return result; // Transient failure - do not cache.
  }

  checks.smtpConnected = probe.connected;
  checks.catchAll = probe.catchAll;
  checks.mailboxExists =
    probe.mailbox === 'exists' ? true : probe.mailbox === 'not_found' ? false : null;

  let reason = smtpReason(probe);
  // A confirmed shared inbox is still a role account for outreach purposes.
  if (reason === 'accepted_email' && checks.roleAccount) reason = 'role_account';

  const result = finalize(
    input, normalized, localPart, domain, reason, checks,
    {
      mx: domainInfo.mx,
      didYouMean,
      smtpResponse: probe.lastReply ?? probe.error,
    },
    startedAt
  );

  // Temporary verdicts must not be memoized - they should be retried later.
  const transient: VerificationReason[] = [
    'greylisted', 'timeout', 'smtp_unreachable', 'unexpected_error',
  ];
  if (!transient.includes(reason)) cache.set(cacheKey, result);

  return result;
}

export function cacheStats(): { size: number } {
  return { size: cache.size };
}

export function clearCache(): void {
  cache.clear();
}
