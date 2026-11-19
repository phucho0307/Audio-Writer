import { createHmac, timingSafeEqual } from 'node:crypto';

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Whether a webhook request really came from SePay.
 *
 * HMAC-SHA256 when a secret is configured (SePay's recommendation): it signs
 * `{timestamp}.{raw body}` and sends `sha256=<hex>` with the timestamp, and
 * a timestamp more than five minutes off is refused so a captured request
 * cannot be replayed later. Otherwise the plain `Authorization: Apikey <key>`
 * header. With neither configured nothing is accepted: an open endpoint
 * would let anyone announce a payment.
 */
export function sepayAuthentic(opts: {
  secret: string;
  apiKey: string;
  rawBody: Buffer | undefined;
  headers: Record<string, string | string[] | undefined>;
  nowSec?: number;
}): boolean {
  const h = (name: string) => {
    const v = opts.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  if (opts.secret) {
    const sig = h('x-sepay-signature');
    const ts = h('x-sepay-timestamp');
    if (!sig || !ts || !opts.rawBody || !/^\d+$/.test(ts)) return false;
    const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(ts)) > 300) return false;
    const expected =
      'sha256=' +
      createHmac('sha256', opts.secret)
        .update(Buffer.concat([Buffer.from(`${ts}.`), opts.rawBody]))
        .digest('hex');
    return same(sig, expected);
  }

  if (opts.apiKey) {
    const auth = h('authorization') ?? '';
    return auth.startsWith('Apikey ') && same(auth.slice(7).trim(), opts.apiKey);
  }

  return false;
}
