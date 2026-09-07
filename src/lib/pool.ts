/**
 * Run tasks with bounded concurrency, preserving input order in the output.
 * Results are settled per task so one failure cannot sink a whole bulk job.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const size = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: size }, run));
  return results;
}
