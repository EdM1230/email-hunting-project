# Mailscope — self-hosted email verification

A Hunter.io-style email verifier you run yourself. Paste an address (or a
whole list), and it tells you whether mail sent there will actually land —
before you burn it on an outreach campaign.

- **Web app** — single check, bulk list with CSV export, and an address finder
- **JSON API** — drop it into your CRM, enrichment pipeline or sequencer
- **CLI** — verify a file of leads from your terminal
- **Deploy anywhere** — a VPS, Docker, or Netlify (with one caveat, below)
- No third-party service. Your list never leaves your server.

---

## What it actually checks

Verification runs as a pipeline. Each stage can settle the verdict on its own,
so cheap checks run first and the expensive network stages only run when they
can still change the answer.

| # | Stage | What it answers | Cost |
|---|-------|-----------------|------|
| 1 | **Syntax** | Is this a valid RFC 5322 mailbox? Any obvious domain typo? | instant |
| 2 | **Domain intelligence** | Disposable burner? Free provider? Role inbox? Random-looking local part? | instant |
| 3 | **DNS** | Does the domain publish a mail server? Is it parked, or a null MX? | ~50ms |
| 4 | **SMTP probe** | Does this exact mailbox exist? Does the domain accept everything? | 1–8s |

### The SMTP stage

This is the only stage that can confirm a mailbox, and it is what separates a
real verifier from a regex. It opens an SMTP session with the domain's mail
exchanger and runs the delivery envelope — but stops before `DATA`:

```
    → EHLO probe.yourdomain.com
    → MAIL FROM:<verify@yourdomain.com>
    → RCPT TO:<target@example.com>
    ← 250 2.1.5 Recipient ok        ← the mailbox exists
    → QUIT                          ← no message is ever sent
```

The reply to `RCPT TO` is the answer. `250` means the mailbox exists, `550`
means it does not, `450` means the server deferred, and so on. **No email is
ever delivered** — the session is abandoned before any message body is sent.

To catch the case where a server accepts *every* address, the prober also
sends a second `RCPT TO` for a random local part. If that is accepted too,
the domain is accept-all and the per-mailbox result means nothing, so the
address is downgraded to `risky`.

---

## ⚠️ Read this before deploying: outbound port 25

**The SMTP stage needs outbound TCP port 25, and most hosts block it.** AWS,
GCP, Azure, Vercel, Heroku, Railway, Render, and virtually every serverless
platform block it by default to prevent spam. On a blocked host every probe
times out, and results degrade to `unknown` — the app keeps working, but it
can no longer confirm mailboxes.

Where it works:

| Host | Port 25 outbound |
|------|------------------|
| Hetzner, OVH, Scaleway, Contabo | ✅ usually open, or open on request |
| DigitalOcean, Linode / Akamai, Vultr | ⚠️ blocked by default, opened via a support ticket |
| AWS EC2 | ⚠️ blocked; requires a request form, and a reverse-DNS record |
| GCP, Azure | ❌ hard block on most tiers |
| Vercel, **Netlify**, Heroku, Render, Railway, Fly.io | ❌ blocked, no exception — see [Deploying to Netlify](#deploying-to-netlify) |

Check your host before you trust the results:

```bash
# On the target machine. "Connected" means you are good.
nc -zv -w 8 gmail-smtp-in.l.google.com 25
```

If port 25 is blocked and you cannot get it opened, run with
`SMTP_ENABLED=false`. The app then does syntax, DNS and reputation checks
only, is much faster, and honestly reports every mailbox as `unknown` rather
than pretending to know.

### Getting accurate results, not just working ones

Mail servers rate-limit and blocklist probers that look like spammers. To stay
accurate over time:

1. **Set `SMTP_HELO_HOST` to a real hostname you control**, and make sure the
   server's reverse DNS (PTR) matches it. A mismatch is the single fastest way
   to get throttled.
2. **Set `SMTP_FROM_EMAIL` to a real, monitored mailbox** on a domain with a
   valid SPF record.
3. **Leave the pacing alone.** `PER_HOST_DELAY_MS` serializes probes per mail
   server on purpose. Raising throughput gets you blocked, which corrupts
   every later result.
4. **Expect some providers to say nothing useful.** Yahoo and several large
   providers accept every `RCPT TO` regardless, and Microsoft 365 tenants are
   often accept-all. Those come back `risky`/`unknown`, which is the honest
   answer.

---

## Deploying to Netlify

The app ships Netlify-ready: `netlify.toml` publishes `public/` to the CDN and
runs the Express API as a function at `/api/*`.

```bash
npm install -g netlify-cli
netlify init      # link or create a site
netlify deploy --build --prod
```

Or connect the repository in the Netlify UI — the build settings are read from
`netlify.toml`, so there is nothing to fill in.

### What works on Netlify, and what does not

**Netlify Functions run on AWS Lambda, which blocks outbound port 25.** The
SMTP mailbox probe is the one stage that can confirm a mailbox exists, and it
cannot run there. This is a platform limit, not a configuration you can talk
your way around.

So a plain Netlify deploy detects itself as serverless and starts in
**DNS-only mode**: syntax, typo, disposable, role-account, MX, null-MX and
parked-domain checks all work, every mailbox comes back `unknown`, and the UI
says so in a banner rather than quietly serving useless verdicts.

| Feature | Plain Netlify | Netlify + upstream |
|---------|---------------|--------------------|
| Syntax, typo suggestions | ✅ | ✅ |
| Disposable / role / free-provider | ✅ | ✅ |
| MX, null-MX, parked domain | ✅ | ✅ |
| **Mailbox confirmed to exist** | ❌ `unknown` | ✅ |
| **Accept-all detection** | ❌ | ✅ |
| Address finder | ranked guesses | verified |

### Getting real verification on Netlify

Run this same app on a host that *does* have port 25 open (a €4 Hetzner box is
plenty) and point the Netlify deployment at it. Netlify serves the UI and API;
the upstream does the SMTP work.

```
  browser ──▶ Netlify (CDN + function) ──HTTPS──▶ your box, port 25 open ──▶ mail servers
                    UI, syntax, DNS                    SMTP probe
```

**1. On the box with port 25 open**, run the app with a key set:

```bash
API_KEY=pick-a-long-random-string \
SMTP_HELO_HOST=probe.yourdomain.com \
SMTP_FROM_EMAIL=verify@yourdomain.com \
npm start
```

Put it behind HTTPS (Caddy or nginx will do), and confirm it works:

```bash
curl -s https://probe.yourdomain.com/api/health   # expect "mode":"full"
```

**2. In the Netlify UI**, under Site settings → Environment variables:

| Variable | Value |
|----------|-------|
| `VERIFY_UPSTREAM_URL` | `https://probe.yourdomain.com` |
| `VERIFY_UPSTREAM_KEY` | the same `API_KEY` as above |

Redeploy. `/api/health` should now report `"mode":"upstream"` with
`"upstream":{"reachable":true}`, and the status pill reads *SMTP probe active
(upstream)*.

Only requests that actually reach the SMTP stage are forwarded — a malformed
address, a burner domain or a domain with no MX is settled on Netlify and
never costs a round trip. If the upstream is down, results degrade to
`unknown` with the reason attached; they are never fabricated.

### Serverless defaults

Detecting Netlify (or any Lambda runtime) changes two defaults:

| Setting | Self-hosted | Serverless | Why |
|---------|-------------|------------|-----|
| `SMTP_ENABLED` | `true` | `false` | Port 25 is blocked; probing would only burn execution time |
| `BULK_MAX_EMAILS` | `1000` | `100` | Functions are killed at 26s, so large lists must be chunked client-side |

Both are still overridable by setting the variable explicitly.

Two other consequences worth knowing:

- **The cache is per-container.** Results are memoized in memory, so a cold
  start begins with an empty cache. Nothing breaks; repeat lookups are just
  slower than on a long-lived server.
- **Per-host SMTP pacing does not span invocations.** Irrelevant while SMTP is
  off, and handled by the upstream when one is configured — which is another
  reason to route probing through a single upstream rather than trying to
  enable SMTP on Netlify.

### Protect your deployment

A public deployment is a free verification service for anyone who finds it. Set
`API_KEY` in the Netlify environment to require an `X-API-Key` header on every
`/api` request except `/api/health`. Note that the bundled web UI does not send
that header, so use it for API-only deployments, or put the site behind
Netlify's password protection or an access control add-on.

---

## Quick start

```bash
npm install
cp .env.example .env     # then edit SMTP_HELO_HOST and SMTP_FROM_EMAIL
npm run dev              # http://localhost:3000
```

For production:

```bash
npm run build
npm start
```

Requires Node.js 20 or newer. There is no database — results are memoized in
memory for 24 hours.

---

## Web app

Three tabs at `http://localhost:3000`:

- **Single** — one address, with the full signal breakdown and a "did you
  mean" hint for typos like `gmial.com`.
- **Bulk list** — paste or upload a list (CSV columns, `Name <addr>` exports
  and comma-separated lines all work). Results are deduplicated, summarized,
  sorted worst-first, and downloadable as CSV.
- **Find an address** — give a name and a company domain, and it tests the
  common corporate patterns in order of likelihood.

---

## API

All endpoints live under `/api`. Set `API_KEY` to require an `X-API-Key`
header on every request.

### `POST /api/verify`

```bash
curl -s localhost:3000/api/verify \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com"}'
```

```jsonc
{
  "email": "ada@example.com",
  "status": "deliverable",       // deliverable | risky | undeliverable | unknown
  "score": 95,                   // 0-100 confidence that mail will land
  "reason": "accepted_email",    // machine-readable verdict
  "message": "The mail server accepted this address.",
  "checks": {
    "syntax": true,
    "mxFound": true,
    "smtpConnected": true,
    "mailboxExists": true,       // null when the server would not say
    "catchAll": false,
    "disposable": false,
    "roleAccount": false,
    "freeProvider": false,
    "parkedDomain": false,
    "gibberish": false
  },
  "mx": [{ "exchange": "mx.example.com", "priority": 10 }],
  "smtpResponse": "250 2.1.5 Recipient ok",
  "durationMs": 812,
  "cached": false
}
```

`GET /api/verify?email=...` does the same thing, for quick shell checks. Add
`&skipSmtp=true` for a fast DNS-only answer, or `&fresh=true` to bypass the
cache.

### `POST /api/verify/bulk`

Takes a JSON array or one blob of pasted text, and returns per-address results
plus a summary. Addresses are deduplicated first.

```bash
curl -s localhost:3000/api/verify/bulk \
  -H 'Content-Type: application/json' \
  -d '{"emails":["ada@example.com","info@example.org"]}'
```

`POST /api/verify/bulk.csv` takes the same body and returns a CSV attachment.

### `POST /api/find`

```bash
curl -s localhost:3000/api/find \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Ada Lovelace","domain":"example.com"}'
```

Returns every candidate with its pattern and confidence, plus `best`. Check
the `confirmed` field: when it is `false`, nothing could be verified (the
domain is accept-all, or SMTP was unreachable) and the ranking reflects
pattern frequency alone.

### `GET /api/domain/:domain`

Mail configuration for a domain — MX records, null-MX and parking detection,
SPF and DMARC. Touches no mailbox.

### `GET /api/health`

Liveness, whether the SMTP stage is enabled, and cache size.

---

## CLI

```bash
npm run verify -- ada@example.com
npm run verify -- --file leads.csv --out results.csv
npm run verify -- --find "Ada Lovelace" --domain example.com
npm run verify -- --file leads.csv --no-smtp        # fast DNS-only pass
```

---

## Configuration

Every setting is an environment variable; see `.env.example`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port |
| `SMTP_ENABLED` | `true` | Turn the SMTP stage off where port 25 is blocked |
| `SMTP_HELO_HOST` | `localhost` | **Set this.** Hostname sent in `EHLO` |
| `SMTP_FROM_EMAIL` | `verify@localhost` | **Set this.** Envelope sender |
| `SMTP_PORT` | `25` | Port to probe |
| `SMTP_TIMEOUT_MS` | `8000` | Per-connection timeout |
| `SMTP_MAX_HOSTS` | `2` | Mail exchangers tried before giving up |
| `CATCH_ALL_DETECTION` | `true` | Probe a decoy address to detect accept-all |
| `PER_HOST_DELAY_MS` | `1200` | Pause between probes to one mail server |
| `BULK_CONCURRENCY` | `5` | Addresses verified in parallel |
| `BULK_MAX_EMAILS` | `1000` | Cap per bulk request |
| `CACHE_TTL_MS` | `86400000` | How long a result is memoized |
| `RATE_LIMIT_MAX` | `60` | Requests per window, per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `API_KEY` | *(unset)* | When set, `X-API-Key` is required |
| `VERIFY_UPSTREAM_URL` | *(unset)* | Delegate SMTP probing to another instance (see [Netlify](#deploying-to-netlify)) |
| `VERIFY_UPSTREAM_KEY` | *(unset)* | `X-API-Key` sent to that upstream |
| `VERIFY_UPSTREAM_TIMEOUT_MS` | `30000` / `20000` | Upstream timeout; lower default under serverless |

### Extending the domain lists

Drop newline-separated domains into these files and restart — they are merged
into the built-in sets at boot:

- `data/disposable.txt` — extra burner providers
- `data/free.txt` — extra free consumer providers

A comprehensive disposable list worth importing:
<https://github.com/disposable-email-domains/disposable-email-domains>

---

## How the score is calculated

The score answers one question: how likely is a message to this address to
reach a human?

It starts from the SMTP verdict — confirmed mailbox `95`, accept-all domain
`45`, deferred or blocked `40`, rejected `0` — and is then adjusted by the
heuristic signals: role account `-20`, random-looking local part `-15`,
parked domain `-25`, accept-all on a confirmed hit `-45`. A `deliverable`
result that falls below `70` after those adjustments is downgraded to `risky`,
so the status and the score never disagree.

| Status | Meaning | What to do |
|--------|---------|------------|
| `deliverable` | The mail server confirmed the mailbox | Send |
| `risky` | Resolves, but accept-all, role inbox, full or disposable | Send with care, expect lower engagement |
| `undeliverable` | Bad syntax, no mail server, or explicitly rejected | Remove from the list |
| `unknown` | Deferred, blocked, or SMTP disabled | Retry later before deciding |

---

## Tests

```bash
npm test        # 47 tests
npm run typecheck
```

The SMTP suite runs against a scriptable fake mail server
(`tests/helpers/fake-smtp.ts`), so the probe logic — accept, reject,
greylist, accept-all, policy block, full mailbox, multi-line replies, and
mail-exchanger failover — is covered without needing port 25. It also asserts
that the prober never sends `DATA`.

The Netlify suite invokes the real Lambda handler with simulated events,
covering both path shapes Netlify may send, the serverless defaults, and the
rate limiter that would otherwise throw when `req.ip` is undefined. The
upstream suite runs against a stand-in verifier and asserts that delegation
forwards the API key, skips the round trip for locally-settled addresses, and
degrades to `unknown` — never to a fabricated verdict — when the upstream is
unreachable, errors, or returns a malformed payload.

---

## Project layout

```
src/
  server.ts            Express app, security middleware, static hosting
  cli.ts               Terminal front end
  config.ts            Environment-backed settings
  routes/api.ts        HTTP endpoints and validation
  lib/
    verifier.ts        Pipeline orchestration and scoring
    smtp.ts            SMTP client, RCPT probing, per-host pacing
    dns.ts             MX resolution, null-MX and parking detection
    syntax.ts          RFC 5322 parsing, role and gibberish detection
    finder.ts          Address-pattern generation and ranking
    csv.ts             List extraction and CSV export
    cache.ts, pool.ts  TTL cache, bounded-concurrency runner
    upstream.ts        Delegation to an upstream verifier
  data/domains.ts      Disposable, free, role and typo datasets
netlify/functions/     Lambda entry point wrapping the Express app
netlify.toml           Netlify build, routing, bundling and headers
public/                Web UI (no build step, no framework)
tests/                 Unit, SMTP, Netlify and upstream tests
data/                  Optional user-supplied domain lists
```

---

## Please use this responsibly

Verification probes other people's mail servers. Verify lists you have a
legitimate reason to contact, respect the pacing defaults, and honour
unsubscribe requests. Cold outreach is also regulated — GDPR in the EU,
CAN-SPAM in the US, PECR in the UK — and a verified address is not consent.
