/** True while the user's paid premium has not run out. */
export function isPremium(user: { premiumUntil?: Date | null } | null | undefined): boolean {
  return Boolean(user?.premiumUntil && user.premiumUntil.getTime() > Date.now());
}

/**
 * Order codes: "NB" and six characters from an alphabet with no look-alikes
 * (no 0/O, 1/I/L), so a code read off a phone and typed into a bank app by
 * hand still matches. 31^6 is about 9 x 10^8, plenty for a unique column.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_PATTERN = /NB[2-9A-HJKMNP-Z]{6}/;

export function newOrderCode(random: (n: number) => Buffer): string {
  const bytes = random(6);
  let out = 'NB';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * Every string in a transfer description that could be an order code, best
 * guesses first. Banks upper-case the description, add the sender's name, and
 * some drop or insert spaces and dashes, so after the description as written
 * it is tried squeezed. A name that happens to contain "NB" can produce a
 * false candidate, which is why the caller checks each against real orders
 * rather than trusting the first.
 */
export function orderCodeCandidates(...texts: (string | null | undefined)[]): string[] {
  const found: string[] = [];
  const global = new RegExp(CODE_PATTERN.source, 'g');
  for (const t of texts) {
    if (!t) continue;
    const upper = t.toUpperCase();
    for (const variant of [upper, upper.replace(/[\s\-_.]/g, '')]) {
      for (const m of variant.matchAll(global)) if (!found.includes(m[0])) found.push(m[0]);
    }
  }
  return found;
}
