/**
 * Settings that are conveniences on a laptop and open doors on a server.
 *
 * AUTH_DEV_USER signs every visitor in as the seeded dev account, with no
 * password; DEV_ENDPOINTS hands out paid credits for free. Both ship as
 * "true" in .env.example, so a production .env copied from it and not edited
 * line by line would start with them on - and nothing would look wrong.
 * Refusing to start is the one check that cannot be forgotten.
 *
 * Returns what is wrong, in words for whoever reads the server log; empty
 * when it is safe (or when this is not production at all).
 */
export function unsafeProductionSettings(env: (key: string) => string | undefined): string[] {
  if (env('NODE_ENV') !== 'production') return [];
  const on = (key: string) => (env(key) ?? '').trim().toLowerCase() === 'true';

  const problems: string[] = [];
  if (on('AUTH_DEV_USER')) {
    problems.push('AUTH_DEV_USER=true signs every visitor in as the dev account. Set it to false.');
  }
  if (on('DEV_ENDPOINTS')) {
    problems.push('DEV_ENDPOINTS=true lets anyone grant themselves paid credits. Set it to false.');
  }
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'BYOK_ENCRYPTION_KEY']) {
    const value = (env(key) ?? '').trim();
    if (value === '' || /change-me/i.test(value)) {
      problems.push(`${key} is unset or still the example value. Generate a real one.`);
    }
  }
  return problems;
}
