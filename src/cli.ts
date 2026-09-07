/**
 * Command-line front end for the same pipeline the API uses.
 *
 *   npm run verify -- someone@example.com
 *   npm run verify -- --file leads.csv --out results.csv
 *   npm run verify -- --find "Ada Lovelace" --domain example.com
 */
import { readFile, writeFile } from 'node:fs/promises';
import { config } from './config.js';
import { parseEmailList, toCsv } from './lib/csv.js';
import { findEmail, splitFullName } from './lib/finder.js';
import { mapWithConcurrency } from './lib/pool.js';
import { verifyEmail } from './lib/verifier.js';
import { loadExternalLists } from './data/load.js';

const ESC = String.fromCharCode(27);
const COLORS: Record<string, string> = {
  deliverable: ESC + '[32m',
  risky: ESC + '[33m',
  undeliverable: ESC + '[31m',
  unknown: ESC + '[90m',
};
const RESET = ESC + '[0m';

function label(status: string): string {
  return `${COLORS[status] ?? ''}${status.padEnd(13)}${RESET}`;
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    console.log(`Usage:
  verify <email>                          Verify one address
  verify --file <path> [--out <csv>]      Verify every address in a file
  verify --find "<name>" --domain <site>  Find someone's address at a domain

Options:
  --no-smtp    Skip the SMTP stage (syntax + DNS only)`);
    return;
  }

  await loadExternalLists();
  const skipSmtp = args.includes('--no-smtp');

  const name = flag(args, 'find');
  if (name) {
    const domain = flag(args, 'domain');
    if (!domain) {
      console.error('--find also needs --domain');
      process.exit(1);
    }
    const { first, last } = splitFullName(name);
    const result = await findEmail(first, last, domain);
    if (result.catchAll) {
      console.log('Domain accepts all addresses - results are ranked guesses.\n');
    }
    for (const candidate of result.candidates) {
      console.log(
        `${label(candidate.verification.status)} ${String(candidate.confidence).padStart(3)}%  ` +
          `${candidate.email}  (${candidate.pattern})`
      );
    }
    console.log(`\nBest guess: ${result.best?.email ?? 'none found'}`);
    return;
  }

  const file = flag(args, 'file');
  const emails = file
    ? parseEmailList(await readFile(file, 'utf8'))
    : args.filter((a) => a.includes('@'));

  if (emails.length === 0) {
    console.error('No email addresses to verify.');
    process.exit(1);
  }

  const results = await mapWithConcurrency(emails, config.bulkConcurrency, async (email) => {
    const result = await verifyEmail(email, { skipSmtp });
    console.log(
      `${label(result.status)} ${String(result.score).padStart(3)}  ` +
        `${result.normalized || email}  ${result.message}`
    );
    return result;
  });

  const out = flag(args, 'out');
  if (out) {
    await writeFile(out, toCsv(results), 'utf8');
    console.log(`\nWrote ${results.length} rows to ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
