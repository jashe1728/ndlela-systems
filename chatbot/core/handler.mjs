import { detectLanguage } from './prompt.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { ChatbotError, generateChatReply } from './openai-client.mjs';

export { detectLanguage };

const MAX_BODY_BYTES = 16_384;
const defaultLimiters = new Map();

function getDefaultLimiter(ratePerMinute) {
  const limit = Number.isFinite(Number(ratePerMinute)) && Number(ratePerMinute) > 0 ? Math.floor(Number(ratePerMinute)) : 20;
  if (!defaultLimiters.has(limit)) {
    defaultLimiters.set(limit, createRateLimiter({ maxRequests: limit, windowMs: 60_000 }));
  }
  return defaultLimiters.get(limit);
}

function isLocalOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

function resolveCorsHeaders(request, env) {
  const origin = (request.headers.get('origin') || '').trim();
  const allowedList = String(env?.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const allowLocalhost = String(env?.ALLOW_LOCALHOST ?? 'true') !== 'false';

  if (!origin) {
    return { allowed: true, headers: {} };
  }

  const wildcard = allowedList.includes('*');
  const exactMatch = allowedList.includes(origin);
  const localMatch = allowLocalhost && isLocalOrigin(origin);

  if (!wildcard && !exactMatch && !localMatch) {
    return { allowed: false, headers: { Vary: 'Origin' } };
  }

  return {
    allowed: true,
    headers: {
      'Access-Control-Allow-Origin': wildcard ? '*' : origin,
      Vary: 'Origin'
    }
  };
}

function jsonResponse(payload, status, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

function getClientIp(request, { trustForwardedFor = true } = {}) {
  const cfIp = (request.headers.get('cf-connecting-ip') || '').trim();
  if (cfIp) return cfIp;
  if (trustForwardedFor) {
    const forwarded = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return 'unknown';
}

/**
 * Web-standard request handler shared by Node local dev server and Cloudflare Worker.
 */
export async function handleChatRequest(
  request,
  env = {},
  {
    clients = {},
    rateLimiter,
    fetchImpl = fetch,
    trustForwardedFor = true,
    disableWebhook = false
  } = {}
) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const cors = resolveCorsHeaders(request, env);

  if (!cors.allowed) {
    return jsonResponse({ error: 'origin_not_allowed' }, 403, cors.headers);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors.headers,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  if (pathname === '/api/health') {
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, cors.headers);
    }
    return jsonResponse(
      {
        ok: true,
        clients: Object.keys(clients),
        configured: Boolean(String(env?.OPENAI_API_KEY || '').trim()),
        mock: String(env?.CHATBOT_MOCK || '') === '1'
      },
      200,
      cors.headers
    );
  }

  if (pathname !== '/api/chat' && pathname !== '/') {
    return jsonResponse({ error: 'not_found' }, 404, cors.headers);
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, cors.headers);
  }

  const limiter = rateLimiter || getDefaultLimiter(env?.RATE_LIMIT_PER_MIN);
  const rateCheck = await limiter.check(getClientIp(request, { trustForwardedFor }));
  if (rateCheck?.unavailable) {
    return jsonResponse({ error: 'rate_limiter_unavailable' }, 503, cors.headers);
  }
  if (!rateCheck.allowed) {
    return jsonResponse(
      {
        error: 'rate_limited',
        retryAfterSeconds: rateCheck.retryAfterSeconds
      },
      429,
      {
        ...cors.headers,
        'Retry-After': String(rateCheck.retryAfterSeconds)
      }
    );
  }

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large' }, 413, cors.headers);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400, cors.headers);
  }

  const byteLength = new TextEncoder().encode(rawBody).length;
  if (byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large' }, 413, cors.headers);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, cors.headers);
  }

  const requestedClientId =
    typeof body?.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : 'ndlela';
  if (!Object.hasOwn(clients, requestedClientId)) {
    return jsonResponse({ error: 'unknown_client' }, 400, cors.headers);
  }

  const clientEntry = clients[requestedClientId];
  const clientConfig = clientEntry.config;
  const knowledgeMarkdown = clientEntry.knowledge;

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return jsonResponse({ error: 'messages_required' }, 400, cors.headers);
  }

  const maxHistory = Number(clientConfig?.limits?.maxHistoryMessages || 12);
  const maxUserChars = Number(clientConfig?.limits?.maxUserMessageChars || 800);

  const normalizedMessages = [];
  for (const item of body.messages) {
    if (!item || typeof item !== 'object') {
      return jsonResponse({ error: 'invalid_message' }, 400, cors.headers);
    }
    if (item.role !== 'user' && item.role !== 'assistant') {
      return jsonResponse({ error: 'invalid_message_role' }, 400, cors.headers);
    }
    if (typeof item.content !== 'string') {
      return jsonResponse({ error: 'invalid_message_content' }, 400, cors.headers);
    }
    const trimmed = item.content.trim();
    if (!trimmed) {
      return jsonResponse({ error: 'empty_message' }, 400, cors.headers);
    }
    if (item.role === 'user' && trimmed.length > maxUserChars) {
      return jsonResponse(
        { error: 'message_too_long', maxChars: maxUserChars },
        400,
        cors.headers
      );
    }
    normalizedMessages.push({ role: item.role, content: trimmed });
  }

  const trimmedHistory = normalizedMessages.slice(-maxHistory);
  const lastMessage = trimmedHistory[trimmedHistory.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    return jsonResponse({ error: 'last_message_must_be_user' }, 400, cors.headers);
  }

  try {
    const result = await generateChatReply({
      messages: trimmedHistory,
      clientConfig,
      knowledgeMarkdown,
      env,
      fetchImpl
    });

    const webhookUrl = disableWebhook ? '' : String(env?.LEAD_WEBHOOK_URL || '').trim();
    if (result.handoff && webhookUrl) {
      try {
        await fetchImpl(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: requestedClientId,
            timestamp: new Date().toISOString(),
            handoff: result.handoff
          }),
          signal: AbortSignal.timeout(3000)
        });
      } catch {
        // Non-fatal: webhook failures must never block chat delivery
      }
    }

    return jsonResponse(
      {
        reply: result.reply,
        language: result.language,
        handoff: result.handoff || null,
        mode: result.mode,
        model: result.model
      },
      200,
      cors.headers
    );
  } catch (error) {
    if (error instanceof ChatbotError) {
      return jsonResponse({ error: error.code }, error.status, cors.headers);
    }
    return jsonResponse({ error: 'internal_error' }, 500, cors.headers);
  }
}
