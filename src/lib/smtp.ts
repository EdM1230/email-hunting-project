import net from 'node:net';
import { config } from '../config.js';

export type MailboxProbe =
  | 'exists'
  | 'not_found'
  | 'mailbox_full'
  | 'greylisted'
  | 'blocked'
  | 'unknown';

export interface SmtpReply {
  code: number;
  text: string;
}

export interface SmtpProbeResult {
  /** We completed a TCP + SMTP greeting handshake with a mail exchanger. */
  connected: boolean;
  /** Verdict for the requested address. */
  mailbox: MailboxProbe;
  /** Verdict for a random address on the same domain, when tested. */
  catchAll: boolean | null;
  host: string | null;
  lastReply: string | null;
  error?: string;
}

/** Minimal line-oriented SMTP client - enough to run an envelope probe. */
class SmtpSession {
  private socket: net.Socket | null = null;
  private buffer = '';
  private pending: {
    resolve: (r: SmtpReply) => void;
    reject: (e: Error) => void;
  } | null = null;
  private closed = false;
  private closeError: Error | null = null;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number
  ) {}

  connect(): Promise<SmtpReply> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      this.socket = socket;
      socket.setEncoding('ascii');
      socket.setTimeout(this.timeoutMs);

      this.pending = { resolve, reject };

      socket.on('data', (chunk: string) => this.onData(chunk));
      socket.on('timeout', () => this.fail(new Error('SMTP timeout')));
      socket.on('error', (err: Error) => this.fail(err));
      socket.on('close', () => this.fail(new Error('SMTP connection closed')));
    });
  }

  /** Resolve the in-flight command once a complete reply has arrived. */
  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const raw = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      // "250-..." is a continuation; "250 ..." terminates the reply.
      if (/^\d{3}-/.test(raw)) continue;
      const match = /^(\d{3})[ ]?(.*)$/.exec(raw);
      if (!match) continue;
      const reply: SmtpReply = { code: Number(match[1]), text: raw };
      const waiter = this.pending;
      this.pending = null;
      waiter?.resolve(reply);
    }
  }

  private fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError = err;
    const waiter = this.pending;
    this.pending = null;
    this.socket?.destroy();
    waiter?.reject(err);
  }

  send(command: string): Promise<SmtpReply> {
    if (this.closed) {
      return Promise.reject(this.closeError ?? new Error('SMTP session closed'));
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.socket?.write(`${command}\r\n`, (err) => {
        if (err) this.fail(err);
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pending = null;
    try {
      this.socket?.write('QUIT\r\n');
    } catch {
      // The peer may already be gone; nothing to salvage.
    }
    this.socket?.destroy();
  }
}

/** Map an SMTP reply to `RCPT TO` into a mailbox verdict. */
function classifyRcpt(reply: SmtpReply): MailboxProbe {
  const { code, text } = reply;
  const lower = text.toLowerCase();

  if (code >= 200 && code < 300) return 'exists';
  if (code === 251) return 'exists'; // Will forward to a non-local address.

  if (code === 552 || /quota|mailbox (is )?full|over quota/.test(lower)) {
    return 'mailbox_full';
  }
  if (code === 450 || code === 451 || code === 421) {
    // 4xx is temporary. Greylisting and rate limits both land here.
    if (/greylist|grey list|try again|temporar|deferred|rate limit|too many/.test(lower)) {
      return 'greylisted';
    }
    if (/blocked|blacklist|denied|spamhaus|reputation|policy/.test(lower)) {
      return 'blocked';
    }
    return 'greylisted';
  }
  if (code === 550 || code === 551 || code === 553) {
    // Not every 5xx is "no such user" - providers reject probes here too.
    if (/blocked|blacklist|denied|reputation|spam|policy|not allowed|banned|authenticat/.test(lower)) {
      return 'blocked';
    }
    return 'not_found';
  }
  if (code === 554) {
    if (/no such user|unknown user|does not exist|unrouteable|recipient rejected/.test(lower)) {
      return 'not_found';
    }
    return 'blocked';
  }
  if (code >= 500) return 'not_found';
  return 'unknown';
}

function randomLocalPart(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `nonexistent-${out}`;
}

/**
 * Serialize probes per mail exchanger and space them out. Hammering a single
 * host in parallel is the fastest way to earn a rate-limit or a blocklisting,
 * which poisons every later result.
 */
const hostQueues = new Map<string, Promise<unknown>>();

function withHostQueue<T>(host: string, task: () => Promise<T>): Promise<T> {
  const previous = hostQueues.get(host) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const result = await task();
      if (config.perHostDelayMs > 0) {
        await new Promise((r) => setTimeout(r, config.perHostDelayMs));
      }
      return result;
    });
  hostQueues.set(host, run);
  void run.catch(() => undefined).finally(() => {
    if (hostQueues.get(host) === run) hostQueues.delete(host);
  });
  return run;
}

async function probeHost(
  host: string,
  port: number,
  email: string,
  detectCatchAll: boolean
): Promise<SmtpProbeResult> {
  const session = new SmtpSession(host, port, config.smtpTimeoutMs);
  const result: SmtpProbeResult = {
    connected: false,
    mailbox: 'unknown',
    catchAll: null,
    host,
    lastReply: null,
  };

  try {
    const greeting = await session.connect();
    result.lastReply = greeting.text;
    if (greeting.code !== 220) {
      result.error = `Unexpected greeting: ${greeting.text}`;
      result.mailbox = greeting.code >= 500 ? 'blocked' : 'unknown';
      return result;
    }
    result.connected = true;

    let hello = await session.send(`EHLO ${config.smtpHeloHost}`);
    if (hello.code !== 250) {
      hello = await session.send(`HELO ${config.smtpHeloHost}`); // Pre-ESMTP server.
    }
    result.lastReply = hello.text;
    if (hello.code !== 250) {
      result.error = `HELO rejected: ${hello.text}`;
      result.mailbox = 'blocked';
      return result;
    }

    const from = await session.send(`MAIL FROM:<${config.smtpFromEmail}>`);
    result.lastReply = from.text;
    if (from.code !== 250) {
      result.error = `MAIL FROM rejected: ${from.text}`;
      result.mailbox = 'blocked';
      return result;
    }

    const rcpt = await session.send(`RCPT TO:<${email}>`);
    result.lastReply = rcpt.text;
    result.mailbox = classifyRcpt(rcpt);

    // Only worth asking about accept-all when the real address was accepted.
    if (detectCatchAll && result.mailbox === 'exists') {
      const domain = email.slice(email.lastIndexOf('@') + 1);
      const decoy = await session.send(`RCPT TO:<${randomLocalPart()}@${domain}>`);
      result.catchAll = classifyRcpt(decoy) === 'exists';
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  } finally {
    session.close();
  }
}

export interface ProbeOptions {
  /** Also probe a random local part to detect an accept-all domain. */
  detectCatchAll?: boolean;
  /** Override the SMTP port. Defaults to `config.smtpPort`. */
  port?: number;
}

/**
 * Run an SMTP envelope probe against a domain's mail exchangers.
 *
 * We stop at the first host that returns a definitive answer and fall through
 * to the next on connection errors, since the top-priority MX is sometimes
 * unreachable while a backup answers fine.
 */
export async function probeMailbox(
  email: string,
  exchanges: string[],
  options: ProbeOptions = {}
): Promise<SmtpProbeResult> {
  const port = options.port ?? config.smtpPort;
  const detectCatchAll = options.detectCatchAll ?? config.catchAllDetection;
  const hosts = exchanges.slice(0, Math.max(1, config.smtpMaxHosts));

  let last: SmtpProbeResult = {
    connected: false,
    mailbox: 'unknown',
    catchAll: null,
    host: null,
    lastReply: null,
    error: 'No mail exchanger available',
  };

  for (const host of hosts) {
    last = await withHostQueue(`${host}:${port}`, () =>
      probeHost(host, port, email, detectCatchAll)
    );
    if (last.connected && last.mailbox !== 'unknown') return last;
  }
  return last;
}
