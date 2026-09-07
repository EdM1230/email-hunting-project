import type { VerificationResult } from '../types.js';

const EMAIL_IN_TEXT = /[^\s,;<>"'()[\]]+@[^\s,;<>"'()[\]]+\.[A-Za-z]{2,}/g;

/**
 * Pull addresses out of arbitrary pasted text - one per line, comma separated,
 * a CSV column, or `Name <addr@example.com>`. Duplicates are dropped so a
 * messy export does not burn quota on the same mailbox twice.
 */
export function parseEmailList(input: string): string[] {
  const matches = String(input ?? '').match(EMAIL_IN_TEXT) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const email = raw.trim().replace(/[.,;:]+$/, '');
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const COLUMNS = [
  'email', 'status', 'score', 'reason', 'message', 'domain',
  'mx_found', 'smtp_connected', 'mailbox_exists', 'catch_all',
  'disposable', 'role_account', 'free_provider', 'gibberish',
  'did_you_mean', 'checked_at',
] as const;

/** Render results as a spreadsheet-friendly CSV. */
export function toCsv(results: VerificationResult[]): string {
  const lines = [COLUMNS.join(',')];
  for (const r of results) {
    lines.push([
      cell(r.normalized || r.email),
      cell(r.status),
      cell(r.score),
      cell(r.reason),
      cell(r.message),
      cell(r.domain),
      cell(r.checks.mxFound),
      cell(r.checks.smtpConnected),
      cell(r.checks.mailboxExists ?? ''),
      cell(r.checks.catchAll ?? ''),
      cell(r.checks.disposable),
      cell(r.checks.roleAccount),
      cell(r.checks.freeProvider),
      cell(r.checks.gibberish),
      cell(r.didYouMean ?? ''),
      cell(r.checkedAt),
    ].join(','));
  }
  return lines.join('\r\n');
}
