/**
 * Netlify Functions entry point.
 *
 * The same Express app that `npm start` serves, wrapped for Lambda. Netlify
 * serves `public/` as static files and forwards only `/api/*` here (see
 * netlify.toml), so this function never handles asset requests.
 *
 * Note the platform limits this runs under:
 *   - outbound port 25 is blocked, so the SMTP stage is off by default and
 *     mailbox confirmation requires VERIFY_UPSTREAM_URL
 *   - execution is capped at 26s, so BULK_MAX_EMAILS defaults lower here
 *   - the process is recycled between invocations, so the result cache is
 *     warm only for the life of one container
 */
import serverless from 'serverless-http';
import { createApp } from '../../src/server.js';
import { loadExternalLists } from '../../src/data/load.js';

// Cold-start work is done once and reused while the container stays warm.
const ready = loadExternalLists().catch((err) => {
  console.error('[lists] failed to load optional domain lists', err);
});

const handleRequest = serverless(createApp());

const FUNCTION_PREFIX = '/.netlify/functions/api';

/**
 * Present the route to Express exactly as the browser asked for it.
 *
 * Depending on how a request reaches the function, Netlify may pass the
 * original `/api/verify` or the rewritten `/.netlify/functions/api/verify`.
 * Express only mounts `/api`, so normalize both to that form rather than
 * relying on whichever shape a given invocation happens to use.
 */
/**
 * Split an incoming path into the route Express expects and any query
 * parameters that arrived attached to it.
 *
 * serverless-http rebuilds the URL from `queryStringParameters`, so the path it
 * receives must be a bare pathname - a stray `?` in it corrupts the route and
 * every request 404s.
 */
export function normalizePath(path: string): { path: string; query: Record<string, string> } {
  const queryAt = path.indexOf('?');
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const query = Object.fromEntries(
    new URLSearchParams(queryAt === -1 ? '' : path.slice(queryAt + 1))
  );

  let route = pathname.startsWith(FUNCTION_PREFIX)
    ? pathname.slice(FUNCTION_PREFIX.length)
    : pathname;
  if (!route.startsWith('/')) route = `/${route}`;
  if (route !== '/api' && !route.startsWith('/api/')) {
    route = route === '/' ? '/api' : `/api${route}`;
  }
  return { path: route, query };
}

interface LambdaEvent {
  path?: string;
  rawUrl?: string;
  queryStringParameters?: Record<string, string> | null;
  [key: string]: unknown;
}

interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string | number | boolean>;
  body: string;
  isBase64Encoded?: boolean;
}

export const handler = async (
  event: LambdaEvent,
  context: unknown
): Promise<LambdaResponse> => {
  // Let the response return without waiting for the event loop to drain, so a
  // lingering DNS socket cannot hold the invocation open.
  (context as { callbackWaitsForEmptyEventLoop?: boolean }).callbackWaitsForEmptyEventLoop = false;
  await ready;

  const { path, query } = normalizePath(event.path ?? '/');
  const normalized: LambdaEvent = {
    ...event,
    path,
    // Parameters already parsed by the platform win; those recovered from the
    // path only fill in what is missing.
    queryStringParameters: { ...query, ...(event.queryStringParameters ?? {}) },
  };

  if (typeof event.rawUrl === 'string') {
    try {
      const url = new URL(event.rawUrl);
      url.pathname = path;
      normalized.rawUrl = url.toString();
    } catch {
      // A malformed rawUrl is not worth failing the request over.
    }
  }

  return handleRequest(normalized as never, context as never) as Promise<LambdaResponse>;
};
