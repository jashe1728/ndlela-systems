/**
 * Create an in-memory sliding-window rate limiter keyed by client IP.
 */
export function createRateLimiter({ maxRequests = 20, windowMs = 60_000, maxKeys = 5000 } = {}) {
  const limit = Number.isFinite(Number(maxRequests)) && Number(maxRequests) > 0 ? Math.floor(Number(maxRequests)) : 20;
  const windowDuration = Number.isFinite(Number(windowMs)) && Number(windowMs) > 0 ? Math.floor(Number(windowMs)) : 60_000;
  const hits = new Map();

  function pruneOldestIfNeeded(now) {
    if (hits.size <= maxKeys) return;
    const cutoff = now - windowDuration;
    for (const [k, stamps] of hits.entries()) {
      if (!stamps.length || stamps[stamps.length - 1] <= cutoff) {
        hits.delete(k);
      }
      if (hits.size <= maxKeys) break;
    }
    if (hits.size > maxKeys) {
      const oldestKey = hits.keys().next().value;
      if (oldestKey !== undefined) hits.delete(oldestKey);
    }
  }

  return {
    check(rawKey, now = Date.now()) {
      const key = String(rawKey || 'local');
      const cutoff = now - windowDuration;
      const existing = hits.get(key) || [];
      const recent = existing.filter((ts) => ts > cutoff);

      if (recent.length >= limit) {
        hits.set(key, recent);
        const retryAfterMs = Math.max(1000, windowDuration - (now - recent[0]));
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
        };
      }

      recent.push(now);
      hits.set(key, recent);
      pruneOldestIfNeeded(now);

      return {
        allowed: true,
        remaining: Math.max(0, limit - recent.length),
        retryAfterSeconds: 0
      };
    }
  };
}
