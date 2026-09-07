import { COMMON_TYPOS, ROLE_ACCOUNTS } from '../data/domains.js';

export interface ParsedEmail {
  valid: boolean;
  normalized: string;
  localPart: string;
  domain: string;
  error?: string;
}

/**
 * Pragmatic RFC 5322 subset: dot-atom local part, optionally quoted, plus a
 * hostname domain. We intentionally reject things that are technically legal
 * (IP-literal domains, comments) because no real outreach list contains them
 * and accepting them only widens the surface for junk.
 */
const LOCAL_ATOM = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LOCAL_DOT_ATOM = `${LOCAL_ATOM}(?:\\.${LOCAL_ATOM})*`;
const LOCAL_QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const DOMAIN_LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const DOMAIN = `${DOMAIN_LABEL}(?:\\.${DOMAIN_LABEL})+`;

const EMAIL_RE = new RegExp(
  `^(?:${LOCAL_DOT_ATOM}|${LOCAL_QUOTED})@${DOMAIN}$`
);

/** Parse and normalize an address, reporting why it failed when it does. */
export function parseEmail(input: string): ParsedEmail {
  const trimmed = String(input ?? '').trim();
  const empty: ParsedEmail = {
    valid: false,
    normalized: trimmed,
    localPart: '',
    domain: '',
  };

  if (!trimmed) return { ...empty, error: 'Address is empty' };
  if (trimmed.length > 254) {
    return { ...empty, error: 'Address exceeds the 254-character limit' };
  }

  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    return { ...empty, error: 'Address must contain a local part and a domain' };
  }

  const localPart = trimmed.slice(0, at);
  // Only the domain is case-insensitive; local parts are technically not.
  const domain = trimmed.slice(at + 1).toLowerCase();
  const normalized = `${localPart}@${domain}`;

  if (localPart.length > 64) {
    return { ...empty, normalized, error: 'Local part exceeds 64 characters' };
  }
  if (domain.length > 253) {
    return { ...empty, normalized, error: 'Domain exceeds 253 characters' };
  }
  if (!EMAIL_RE.test(normalized)) {
    return { ...empty, normalized, error: 'Address is not a valid mailbox' };
  }
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
    return { ...empty, normalized, error: 'Local part has a misplaced dot' };
  }
  if (domain.includes('..') || domain.startsWith('-') || domain.endsWith('-')) {
    return { ...empty, normalized, error: 'Domain is malformed' };
  }

  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if (tld.length < 2 || /^\d+$/.test(tld)) {
    return { ...empty, normalized, error: 'Domain has an invalid TLD' };
  }

  return { valid: true, normalized, localPart, domain };
}

/** Suggest a correction when the domain is a known fat-finger of a big provider. */
export function suggestCorrection(domain: string): string | undefined {
  return COMMON_TYPOS.get(domain);
}

export function isRoleAccount(localPart: string): boolean {
  const key = localPart.toLowerCase().replace(/[._-]/g, '');
  if (ROLE_ACCOUNTS.has(localPart.toLowerCase())) return true;
  return ROLE_ACCOUNTS.has(key);
}

/**
 * Flag local parts that look machine-generated (`xk3f9qz2@`), which correlate
 * with spam traps and throwaway signups. Heuristic on purpose: it only ever
 * downgrades a result to "risky", never to "undeliverable".
 */
export function looksGibberish(localPart: string): boolean {
  const s = localPart.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.length < 8) return false; // Too short to judge fairly.

  const letters = s.replace(/[0-9]/g, '');
  if (letters.length >= 6) {
    const vowels = (letters.match(/[aeiouy]/g) ?? []).length;
    if (vowels / letters.length < 0.15) return true; // Almost no vowels.
    if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(letters)) return true; // Long consonant run.
  }

  const digits = (s.match(/[0-9]/g) ?? []).length;
  if (digits / s.length > 0.55) return true; // Mostly digits.

  const unique = new Set(s).size;
  return unique / s.length > 0.92 && s.length >= 12; // Near-random alphabet spread.
}
