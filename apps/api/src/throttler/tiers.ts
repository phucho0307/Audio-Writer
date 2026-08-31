const MINUTE = 60_000;

/**
 * Per-route limits, as overrides of the single global throttler.
 *
 * Named throttlers were the obvious shape for this and are a trap: every named
 * limiter runs on every route, so a route that names none still gets all of
 * them and the tightest one wins. Browsing was being cut off at six requests a
 * minute by the limit meant for AI generation. One limiter with per-route
 * overrides has no such failure mode.
 *
 * These are constants rather than env-driven because decorators are evaluated
 * when the module is imported, which is before ConfigModule has read .env -
 * reading process.env here would silently pick up nothing.
 */
export const AUTH_TIER = {
  default: {
    limit: 10,
    ttl: MINUTE,
    // Longer than the window: a burst against sign-in should cost the caller
    // more than the minute it took to make.
    blockDuration: 5 * MINUTE,
  },
};

export const COSTLY_TIER = {
  default: { limit: 6, ttl: MINUTE, blockDuration: 2 * MINUTE },
};
