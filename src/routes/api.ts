import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { mapWithConcurrency } from '../lib/pool.js';
import { resolveDomain, resolveMailPolicy } from '../lib/dns.js';
import { findEmail } from '../lib/finder.js';
import { cacheStats, verifyEmail } from '../lib/verifier.js';
import { parseEmailList, toCsv } from '../lib/csv.js';
import { hasUpstream, pingUpstream } from '../lib/upstream.js';
import type { VerificationResult } from '../types.js';

export const api = Router();

const verifySchema = z.object({
  email: z.string().min(3).max(320),
  skipSmtp: z.boolean().optional(),
  fresh: z.boolean().optional(),
});

const bulkSchema = z.object({
  emails: z.union([z.array(z.string()), z.string()]),
  skipSmtp: z.boolean().optional(),
});

const findSchema = z
  .object({
    domain: z.string().min(3).max(253),
    firstName: z.string().max(80).optional(),
    lastName: z.string().max(80).optional(),
    fullName: z.string().max(160).optional(),
    maxCandidates: z.number().int().min(1).max(13).optional(),
    stopOnFirstHit: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.fullName?.trim() || v.firstName?.trim()), {
    message: 'Provide fullName, or firstName and lastName',
  });

/** Aggregate counts the UI shows above a bulk run. */
function summarize(results: VerificationResult[]) {
  const summary = {
    total: results.length,
    deliverable: 0,
    risky: 0,
    undeliverable: 0,
    unknown: 0,
    disposable: 0,
    roleAccounts: 0,
    catchAll: 0,
  };
  for (const r of results) {
    summary[r.status] += 1;
    if (r.checks.disposable) summary.disposable += 1;
    if (r.checks.roleAccount) summary.roleAccounts += 1;
    if (r.checks.catchAll) summary.catchAll += 1;
  }
  return summary;
}

/**
 * Report which verification mode is actually in effect, so the UI can tell the
 * user whether mailboxes can be confirmed at all rather than silently serving
 * "unknown" for everything.
 *
 * `mode` is one of:
 *   full     - SMTP probing happens in this process
 *   upstream - SMTP probing is delegated to another instance
 *   dns-only - no SMTP anywhere; mailboxes cannot be confirmed
 */
api.get('/health', async (_req, res) => {
  const upstream = hasUpstream() ? await pingUpstream() : null;
  const mode = upstream ? 'upstream' : config.smtpEnabled ? 'full' : 'dns-only';

  res.json({
    status: 'ok',
    mode,
    smtpEnabled: config.smtpEnabled,
    serverless: config.isServerless,
    catchAllDetection: config.catchAllDetection,
    ...(upstream
      ? { upstream: { configured: true, reachable: upstream.reachable, error: upstream.error } }
      : {}),
    bulkMaxEmails: config.bulkMaxEmails,
    cache: cacheStats(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** Verify a single address. GET is handy for curl and quick links. */
api.get('/verify', async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse({
      email: req.query.email,
      skipSmtp: req.query.skipSmtp === 'true' ? true : undefined,
      fresh: req.query.fresh === 'true' ? true : undefined,
    });
    if (!parsed.success) {
      res.status(400).json({ error: 'Provide an ?email= parameter' });
      return;
    }
    res.json(await verifyEmail(parsed.data.email, parsed.data));
  } catch (err) {
    next(err);
  }
});

api.post('/verify', async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }
    res.json(await verifyEmail(parsed.data.email, parsed.data));
  } catch (err) {
    next(err);
  }
});

/** Verify a list. Accepts a JSON array or pasted/CSV text. */
api.post('/verify/bulk', async (req, res, next) => {
  try {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    const emails = Array.isArray(parsed.data.emails)
      ? parseEmailList(parsed.data.emails.join('\n'))
      : parseEmailList(parsed.data.emails);

    if (emails.length === 0) {
      res.status(400).json({ error: 'No email addresses found in the input' });
      return;
    }
    if (emails.length > config.bulkMaxEmails) {
      res.status(413).json({
        error: `Too many addresses. The limit is ${config.bulkMaxEmails} per request.`,
        received: emails.length,
      });
      return;
    }

    const startedAt = Date.now();
    const results = await mapWithConcurrency(emails, config.bulkConcurrency, (email) =>
      verifyEmail(email, { skipSmtp: parsed.data.skipSmtp })
    );

    res.json({
      summary: summarize(results),
      results,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    next(err);
  }
});

/** Same as /verify/bulk but streams a CSV back for spreadsheet workflows. */
api.post('/verify/bulk.csv', async (req, res, next) => {
  try {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const emails = Array.isArray(parsed.data.emails)
      ? parseEmailList(parsed.data.emails.join('\n'))
      : parseEmailList(parsed.data.emails);

    if (emails.length === 0 || emails.length > config.bulkMaxEmails) {
      res.status(400).json({ error: 'Provide between 1 and ' + config.bulkMaxEmails + ' addresses' });
      return;
    }

    const results = await mapWithConcurrency(emails, config.bulkConcurrency, (email) =>
      verifyEmail(email, { skipSmtp: parsed.data.skipSmtp })
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="verification-results.csv"');
    res.send(toCsv(results));
  } catch (err) {
    next(err);
  }
});

/** Guess and verify the address of a named person at a domain. */
api.post('/find', async (req, res, next) => {
  try {
    const parsed = findSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.issues });
      return;
    }

    let { firstName = '', lastName = '' } = parsed.data;
    if (parsed.data.fullName?.trim()) {
      const { splitFullName } = await import('../lib/finder.js');
      const split = splitFullName(parsed.data.fullName);
      firstName = firstName || split.first;
      lastName = lastName || split.last;
    }

    res.json(
      await findEmail(firstName, lastName, parsed.data.domain, {
        maxCandidates: parsed.data.maxCandidates,
        stopOnFirstHit: parsed.data.stopOnFirstHit,
      })
    );
  } catch (err) {
    next(err);
  }
});

/** Inspect a domain's mail setup without touching any mailbox. */
api.get('/domain/:domain', async (req, res, next) => {
  try {
    const domain = String(req.params.domain ?? '').toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      res.status(400).json({ error: 'Invalid domain' });
      return;
    }
    const [info, policy] = await Promise.all([
      resolveDomain(domain),
      resolveMailPolicy(domain),
    ]);
    res.json({ ...info, ...policy });
  } catch (err) {
    next(err);
  }
});
