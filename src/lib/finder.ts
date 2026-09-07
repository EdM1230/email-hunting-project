import { config } from '../config.js';
import type { FinderCandidate, FinderResult } from '../types.js';
import { resolveDomain } from './dns.js';
import { probeMailbox } from './smtp.js';
import { verifyEmail } from './verifier.js';

interface Pattern {
  id: string;
  /** Rough real-world frequency of this convention, used as a prior. */
  weight: number;
  build: (first: string, last: string) => string | null;
}

/**
 * Corporate address conventions, ordered by how common they are. The weights
 * are priors: they decide probe order and break ties when several candidates
 * are accepted (or when the domain is accept-all and none can be confirmed).
 */
const PATTERNS: Pattern[] = [
  { id: '{first}.{last}', weight: 33, build: (f, l) => (f && l ? `${f}.${l}` : null) },
  { id: '{first}', weight: 12, build: (f) => f || null },
  { id: '{f}{last}', weight: 12, build: (f, l) => (f && l ? `${f[0]}${l}` : null) },
  { id: '{first}{last}', weight: 8, build: (f, l) => (f && l ? `${f}${l}` : null) },
  { id: '{f}.{last}', weight: 6, build: (f, l) => (f && l ? `${f[0]}.${l}` : null) },
  { id: '{first}_{last}', weight: 4, build: (f, l) => (f && l ? `${f}_${l}` : null) },
  { id: '{last}.{first}', weight: 3, build: (f, l) => (f && l ? `${l}.${f}` : null) },
  { id: '{first}{l}', weight: 3, build: (f, l) => (f && l ? `${f}${l[0]}` : null) },
  { id: '{last}', weight: 2, build: (_f, l) => l || null },
  { id: '{f}{l}', weight: 2, build: (f, l) => (f && l ? `${f[0]}${l[0]}` : null) },
  { id: '{last}{f}', weight: 2, build: (f, l) => (f && l ? `${l}${f[0]}` : null) },
  { id: '{first}-{last}', weight: 1, build: (f, l) => (f && l ? `${f}-${l}` : null) },
  { id: '{last}{first}', weight: 1, build: (f, l) => (f && l ? `${l}${f}` : null) },
];

/** Strip accents, punctuation and spacing so "José Núñez-Ruiz" -> "josenunezruiz". */
export function normalizeName(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Split "Ada Lovelace" into its first and last components. */
export function splitFullName(full: string): { first: string; last: string } {
  const parts = String(full ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0] as string, last: '' };
  return {
    first: parts[0] as string,
    last: parts[parts.length - 1] as string,
  };
}

/** Every candidate address for a name at a domain, most likely first. */
export function buildCandidates(
  firstName: string,
  lastName: string,
  domain: string
): { email: string; pattern: string; weight: number }[] {
  const first = normalizeName(firstName);
  const last = normalizeName(lastName);
  const seen = new Set<string>();
  const out: { email: string; pattern: string; weight: number }[] = [];

  for (const pattern of PATTERNS) {
    const localPart = pattern.build(first, last);
    if (!localPart) continue;
    const email = `${localPart}@${domain.toLowerCase()}`;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, pattern: pattern.id, weight: pattern.weight });
  }
  return out;
}

/**
 * Probe a random local part to learn two things in one connection: whether the
 * domain accepts everything, and whether SMTP verification works here at all.
 * Both answers let the caller skip probing the remaining patterns.
 */
async function inspectDomain(domain: string): Promise<{
  catchAll: boolean;
  smtpUsable: boolean;
}> {
  if (!config.smtpEnabled) return { catchAll: false, smtpUsable: false };
  const info = await resolveDomain(domain);
  if (info.mx.length === 0) return { catchAll: false, smtpUsable: false };

  const decoy = `zz-no-such-user-${Date.now().toString(36)}@${domain}`;
  const probe = await probeMailbox(decoy, info.mx.map((r) => r.exchange), {
    detectCatchAll: false,
  });
  return {
    catchAll: probe.connected && probe.mailbox === 'exists',
    smtpUsable: probe.connected && probe.mailbox !== 'blocked',
  };
}

/**
 * Verdicts that mean "the mail server would not tell us", as opposed to a real
 * answer about the mailbox. Once one of these comes back for a domain, every
 * further probe against it costs a timeout and returns the same non-answer.
 */
const UNCONFIRMABLE_REASONS: string[] = [
  'smtp_unreachable',
  'smtp_disabled',
  'timeout',
  'blocked_by_provider',
  'accept_all_domain',
];

export interface FindOptions {
  /** Stop at the first accepted address instead of scoring every pattern. */
  stopOnFirstHit?: boolean;
  /** Cap how many patterns get probed. */
  maxCandidates?: number;
}

/**
 * Find the most likely address for a person at a domain.
 *
 * Candidates are probed serially in prior order - the per-host queue in the
 * SMTP layer would serialize them anyway, and a burst of failed `RCPT TO`
 * commands against one server is exactly what triggers rate limiting.
 */
export async function findEmail(
  firstName: string,
  lastName: string,
  domain: string,
  options: FindOptions = {}
): Promise<FinderResult> {
  const startedAt = Date.now();
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const max = options.maxCandidates ?? PATTERNS.length;
  const stopOnFirstHit = options.stopOnFirstHit ?? true;

  const { catchAll, smtpUsable } = await inspectDomain(cleanDomain);
  const guesses = buildCandidates(firstName, lastName, cleanDomain).slice(0, max);
  const candidates: FinderCandidate[] = [];

  // On an accept-all domain every probe returns "accepted", so probing is pure
  // noise. Same once SMTP proves unreachable - we would just pay the timeout
  // again for every remaining pattern. In both cases we fall back to ranking
  // by the pattern prior alone and label the result as unconfirmed.
  let unconfirmable = catchAll || !smtpUsable;

  for (const guess of guesses) {
    const verification = unconfirmable
      ? await verifyEmail(guess.email, { skipSmtp: true })
      : await verifyEmail(guess.email, { detectCatchAll: false });

    const confidence = unconfirmable
      ? Math.round(guess.weight * 0.9) // Prior only - nothing was confirmed.
      : Math.round(guess.weight * 0.35 + verification.score * 0.65);

    candidates.push({
      email: guess.email,
      pattern: guess.pattern,
      patternWeight: guess.weight,
      verification,
      confidence,
    });

    // A domain that routes no mail is unreachable for every pattern.
    if (verification.reason === 'no_mx_record' || verification.reason === 'invalid_domain') break;

    if (!unconfirmable) {
      if (stopOnFirstHit && verification.status === 'deliverable') break;
      if (UNCONFIRMABLE_REASONS.includes(verification.reason)) unconfirmable = true;
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  // Never return "nothing found" just because SMTP was unavailable: the ranked
  // pattern prior is still the most useful answer we can give an outreach user.
  const best = candidates.find((c) => c.verification.status !== 'undeliverable') ?? null;

  const first = firstName.trim();
  const last = lastName.trim();
  return {
    domain: cleanDomain,
    firstName: first,
    lastName: last,
    fullName: [first, last].filter(Boolean).join(' '),
    best,
    candidates,
    catchAll,
    confirmed: !unconfirmable,
    unconfirmedReason: unconfirmable
      ? catchAll
        ? 'accept_all_domain'
        : 'smtp_unavailable'
      : undefined,
    durationMs: Date.now() - startedAt,
  };
}
