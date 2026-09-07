import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { loadExternalLists } from './data/load.js';
import { api } from './routes/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Serve the UI from the repo root whether we run from src/ (tsx) or dist/.
const publicDir = path.resolve(here, '..', 'public');

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // Correct client IPs for rate limiting behind a proxy.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    })
  );
  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.text({ type: 'text/csv', limit: '2mb' }));

  const limiter = rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Slow down and try again shortly.' },
    /**
     * Serverless invocations have no real socket, so `req.ip` is undefined and
     * the default key generator throws. Prefer the platform's client-IP header
     * and fall back to a shared bucket, which still caps total throughput.
     */
    keyGenerator: (req) =>
      req.get('x-nf-client-connection-ip') ??
      req.get('cf-connecting-ip') ??
      req.get('x-real-ip') ??
      req.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.ip ??
      'unknown',
    // The custom key generator above handles the serverless case correctly.
    validate: { ip: false, xForwardedForHeader: false },
  });

  // Optional shared-secret gate, so a public deployment is not an open relay
  // of other people's SMTP quota.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (!config.apiKey) return next();
    if (req.path === '/health') return next();
    if (req.get('x-api-key') === config.apiKey) return next();
    res.status(401).json({ error: 'Missing or invalid X-API-Key header' });
  });

  app.use('/api', limiter, api);
  app.use(express.static(publicDir, { maxAge: '1h', index: 'index.html' }));

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'Unknown endpoint' });
      return;
    }
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  return app;
}

async function main(): Promise<void> {
  const merged = await loadExternalLists();
  if (merged.disposable || merged.free) {
    console.log(
      `[lists] merged ${merged.disposable} disposable and ${merged.free} free domains from data/`
    );
  }

  createApp().listen(config.port, () => {
    console.log(`Email verifier listening on http://localhost:${config.port}`);
    console.log(
      `SMTP stage: ${config.smtpEnabled ? 'enabled' : 'disabled'} | ` +
        `HELO ${config.smtpHeloHost} | MAIL FROM ${config.smtpFromEmail}`
    );
    if (config.smtpEnabled && config.smtpHeloHost === 'localhost') {
      console.warn(
        '[warn] SMTP_HELO_HOST is still "localhost". Set it to a real hostname ' +
          'you control, or mail servers will reject or throttle the probes.'
      );
    }
  });
}

// Only auto-start when run directly, so tests can import createApp().
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
