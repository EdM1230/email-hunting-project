import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DISPOSABLE_DOMAINS, FREE_PROVIDERS } from './domains.js';

async function mergeFile(file: string, target: Set<string>): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return 0; // Optional file; absence is the normal case.
  }
  let added = 0;
  for (const line of raw.split(/\r?\n/)) {
    const domain = line.trim().toLowerCase();
    if (!domain || domain.startsWith('#') || target.has(domain)) continue;
    target.add(domain);
    added += 1;
  }
  return added;
}

/**
 * Merge optional user-supplied blocklists from `data/` into the built-in sets.
 * Lets you pull in a 100k-domain disposable list without editing source.
 */
export async function loadExternalLists(root = process.cwd()): Promise<{
  disposable: number;
  free: number;
}> {
  const [disposable, free] = await Promise.all([
    mergeFile(path.join(root, 'data', 'disposable.txt'), DISPOSABLE_DOMAINS),
    mergeFile(path.join(root, 'data', 'free.txt'), FREE_PROVIDERS),
  ]);
  return { disposable, free };
}
