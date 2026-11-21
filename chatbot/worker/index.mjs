import { handleChatRequest } from '../core/handler.mjs';
import { createRateLimiter } from '../core/rate-limit.mjs';
import { CLIENTS } from './clients.generated.mjs';

let cachedLimiter = null;
let cachedMaxRequests = null;

function getIsolateRateLimiter(env) {
  const parsed = Number(env?.RATE_LIMIT_PER_MIN || 20);
  const maxRequests = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20;
  if (!cachedLimiter || cachedMaxRequests !== maxRequests) {
    cachedLimiter = createRateLimiter({ maxRequests, windowMs: 60_000 });
    cachedMaxRequests = maxRequests;
  }
  return cachedLimiter;
}

function getWorkerRateLimiter(env) {
  const binding = env?.CHAT_RATE_LIMITER;
  if (!binding || typeof binding.limit !== 'function') {
    if (String(env?.CHATBOT_MOCK || '') === '1') {
      return getIsolateRateLimiter(env);
    }
    return {
      async check() {
        return { allowed: false, unavailable: true, retryAfterSeconds: 0 };
      }
    };
  }

  return {
    async check(ip) {
      const key = ip && ip !== 'unknown' ? ip : 'unknown-ip';
      try {
        const { success } = await binding.limit({ key });
        if (!success) {
          return { allowed: false, retryAfterSeconds: 60 };
        }
        return { allowed: true, retryAfterSeconds: 0 };
      } catch {
        // Fail closed in production Worker if the rate-limit binding errors
        return { allowed: false, unavailable: true, retryAfterSeconds: 0 };
      }
    }
  };
}

export default {
  async fetch(request, env) {
    return handleChatRequest(request, env, {
      clients: CLIENTS,
      rateLimiter: getWorkerRateLimiter(env),
      trustForwardedFor: false,
      disableWebhook: true
    });
  }
};
