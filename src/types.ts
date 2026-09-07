/** Final verdict for an address. Mirrors the vocabulary outreach tools expect. */
export type VerificationStatus =
  | 'deliverable'
  | 'risky'
  | 'undeliverable'
  | 'unknown';

/** Machine-readable explanation of how we arrived at the status. */
export type VerificationReason =
  | 'accepted_email'
  | 'invalid_syntax'
  | 'invalid_domain'
  | 'no_mx_record'
  | 'rejected_email'
  | 'mailbox_full'
  | 'disposable_domain'
  | 'role_account'
  | 'accept_all_domain'
  | 'greylisted'
  | 'smtp_unreachable'
  | 'smtp_disabled'
  | 'timeout'
  | 'blocked_by_provider'
  | 'unexpected_error';

export interface MxRecord {
  exchange: string;
  priority: number;
}

export interface VerificationChecks {
  /** Address parses as a valid RFC 5322 mailbox. */
  syntax: boolean;
  /** Domain resolves and publishes MX (or a usable A/AAAA fallback). */
  mxFound: boolean;
  /** We opened an SMTP session with the mail exchanger. */
  smtpConnected: boolean;
  /** The mail server accepted `RCPT TO` for this exact address. */
  mailboxExists: boolean | null;
  /** Domain accepts every address, so per-mailbox results are meaningless. */
  catchAll: boolean | null;
  /** Domain belongs to a known temporary/burner mail provider. */
  disposable: boolean;
  /** Local part is a shared inbox (info@, sales@, support@...). */
  roleAccount: boolean;
  /** Domain is a free consumer mailbox provider (gmail.com, outlook.com...). */
  freeProvider: boolean;
  /** Domain is a known parked/inactive placeholder. */
  parkedDomain: boolean;
  /** Local part looks machine-generated (high entropy, no vowels...). */
  gibberish: boolean;
}

export interface VerificationResult {
  email: string;
  /** Normalized address actually tested (trimmed, lowercased domain). */
  normalized: string;
  localPart: string;
  domain: string;
  status: VerificationStatus;
  /** Confidence that mail sent here will land, 0-100. */
  score: number;
  reason: VerificationReason;
  /** Human-readable one-liner for the UI. */
  message: string;
  checks: VerificationChecks;
  mx: MxRecord[];
  /** Raw last SMTP reply, useful when debugging a surprising verdict. */
  smtpResponse?: string;
  /** Suggested correction for an obvious typo, e.g. gmial.com -> gmail.com. */
  didYouMean?: string;
  durationMs: number;
  checkedAt: string;
  cached: boolean;
}

export interface FinderCandidate {
  email: string;
  /** Pattern that produced this candidate, e.g. "{first}.{last}". */
  pattern: string;
  /** Prior likelihood of the pattern before verification, 0-100. */
  patternWeight: number;
  verification: VerificationResult;
  /** Blended pattern prior + verification score. */
  confidence: number;
}

export interface FinderResult {
  domain: string;
  firstName: string;
  lastName: string;
  fullName: string;
  /** Highest-confidence candidate, or null when nothing was accepted. */
  best: FinderCandidate | null;
  candidates: FinderCandidate[];
  /** True when the domain accepts everything, making the result a guess. */
  catchAll: boolean;
  /**
   * True when candidates were actually confirmed over SMTP. False when the
   * domain is accept-all or the mail server was unreachable - the ranking is
   * then based on pattern frequency alone.
   */
  confirmed: boolean;
  /** Why nothing could be confirmed, when `confirmed` is false. */
  unconfirmedReason?: 'accept_all_domain' | 'smtp_unavailable';
  durationMs: number;
}
