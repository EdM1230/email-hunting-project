import { Resolver } from 'node:dns/promises';
import type { MxRecord } from '../types.js';
import { PARKED_DOMAIN_MX } from '../data/domains.js';

const resolver = new Resolver({ timeout: 5000, tries: 2 });

export interface DomainInfo {
  domain: string;
  /** Mail exchangers, best priority first. */
  mx: MxRecord[];
  /** Domain resolves at all (MX, A or AAAA). */
  resolves: boolean;
  /** MX points at a known domain-parking service. */
  parked: boolean;
  /** MX is absent but an A record exists - RFC 5321 implicit MX. */
  implicitMx: boolean;
  /** RFC 7505 null MX: the domain explicitly accepts no mail at all. */
  nullMx: boolean;
}

const cache = new Map<string, { value: DomainInfo; expires: number }>();
const DNS_TTL_MS = 10 * 60 * 1000;

function isParked(mx: MxRecord[]): boolean {
  return mx.some((r) =>
    PARKED_DOMAIN_MX.some((p) => r.exchange.toLowerCase().endsWith(p))
  );
}

/** Resolve mail routing for a domain, with a short in-process cache. */
export async function resolveDomain(domain: string): Promise<DomainInfo> {
  const key = domain.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const info: DomainInfo = {
    domain: key,
    mx: [],
    resolves: false,
    parked: false,
    implicitMx: false,
    nullMx: false,
  };

  try {
    const records = await resolver.resolveMx(key);
    const usable = records.filter((r) => r.exchange && r.exchange !== '.');
    // A lone "." exchange is the RFC 7505 null MX: the domain publishes, on
    // purpose, that it receives no mail. That is a definitive answer, so we
    // must not fall back to the implicit-MX A record below.
    info.nullMx = records.length > 0 && usable.length === 0;
    info.mx = usable
      .map((r) => ({ exchange: r.exchange.toLowerCase(), priority: r.priority }))
      .sort((a, b) => a.priority - b.priority);
    // A null MX still means the domain exists and answered authoritatively.
    info.resolves = info.mx.length > 0 || info.nullMx;
    info.parked = isParked(info.mx);
  } catch {
    // No MX: fall through to the implicit-MX check below.
  }

  if (info.mx.length === 0 && !info.nullMx) {
    for (const lookup of ['resolve4', 'resolve6'] as const) {
      try {
        const addrs = await resolver[lookup](key);
        if (addrs.length > 0) {
          info.resolves = true;
          info.implicitMx = true;
          info.mx = [{ exchange: key, priority: 0 }];
          break;
        }
      } catch {
        // Try the next record type.
      }
    }
  }

  if (cache.size > 5000) cache.clear();
  cache.set(key, { value: info, expires: Date.now() + DNS_TTL_MS });
  return info;
}

/** Best-effort SPF/DMARC read - useful context, never used to fail an address. */
export async function resolveMailPolicy(domain: string): Promise<{
  spf: string | null;
  dmarc: string | null;
}> {
  const spf = await resolver
    .resolveTxt(domain)
    .then((r) => r.map((c) => c.join('')).find((t) => t.toLowerCase().startsWith('v=spf1')) ?? null)
    .catch(() => null);

  const dmarc = await resolver
    .resolveTxt(`_dmarc.${domain}`)
    .then((r) => r.map((c) => c.join('')).find((t) => t.toLowerCase().startsWith('v=dmarc1')) ?? null)
    .catch(() => null);

  return { spf, dmarc };
}
