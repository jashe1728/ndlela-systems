# Ndlela Systems Reusable AI Chatbot

A client-configurable bilingual (**PT / EN**) AI assistant architecture using **Ndlela Systems** as the reference sandbox, designed to run locally on Node 24 and deploy to **Cloudflare Workers**.

## Directory Structure

- `chatbot/clients/ndlela/` — Grounded `config.json` + `knowledge.md` for Ndlela Systems.
- `chatbot/clients/_template/` — Starter pack to clone for future client sites.
- `chatbot/core/` — Web-standard Fetch API engine (`prompt.mjs`, `lead-tools.mjs`, `rate-limit.mjs`, `openai-client.mjs`, `handler.mjs`) shared between Node and Cloudflare Workers.
- `chatbot/server/local-dev.mjs` — Local static + `/api/chat` dev server for Node 24.
- `chatbot/worker/` — Cloudflare Worker entry (`index.mjs`), `wrangler.toml`, and `bundle-clients.mjs`.
- `chatbot/widget/` — Drop-in vanilla JS/CSS widget (`ndlela-chat.js`, `ndlela-chat.css`).
- `chatbot/evals/` — 29 regression eval cases (`ndlela-cases.json`) and runner (`run-evals.mjs`).

## 1. Local Setup

1. Copy the environment template (never commit `chatbot/.env`):
   ```powershell
   Copy-Item chatbot\.env.example chatbot\.env
   ```
2. Add your `OPENAI_API_KEY` inside `chatbot\.env`.
3. Start the local dev server on `http://127.0.0.1:8123`:
   ```powershell
   node chatbot/server/local-dev.mjs
   ```
   To test the UI locally without spending OpenAI tokens, run with `CHATBOT_MOCK=1`:
   ```powershell
   $env:CHATBOT_MOCK="1"; node chatbot/server/local-dev.mjs
   ```

## 2. Running Tests & Evals

```powershell
# Core unit, security, rate-limit, and Worker handler tests
node --test tests/chatbot-unit-test.mjs

# 29-case offline eval suite (deterministic mock mode)
node chatbot/evals/run-evals.mjs --mock

# 29-case live OpenAI eval suite (requires OPENAI_API_KEY in chatbot/.env)
node chatbot/evals/run-evals.mjs

# Playwright chatbot widget tests across mobile + desktop viewports
node tests/chatbot-widget-test.mjs
```

> Note: On Windows PowerShell if `npm` script execution is restricted, use `npm.cmd run <script>` or `node ...` directly.

## 3. Cloning for a New Client Project

1. Duplicate `chatbot/clients/_template/` to `chatbot/clients/<client-id>/`.
2. Fill in `config.json` (`id`, `brandName`, `contact`, `guardrails`, `quickFaqs`) and `knowledge.md` (approved products, services, hours, pricing rules, boundaries).
3. Embed `chatbot/widget/ndlela-chat.css` and `chatbot/widget/ndlela-chat.js` on the client site with `<aside class="faq-widget" data-client="<client-id>" data-api-url="https://your-worker.workers.dev/api/chat">`.
4. Add `<client-id>-cases.json` under `chatbot/evals/` and run `node chatbot/evals/run-evals.mjs --client=<client-id>`.

## 4. Phase 2: Deploying the Cloudflare Worker (When Ready)

1. Review OpenAI billing, available balance and usage alerts before going live. Do not assume a project budget or alert is a hard spending cap. The Worker uses approximate per-IP rate limits (20 requests per minute per Cloudflare location), input/history/output limits and backend-only credentials, but these do not prevent all distributed cost abuse. Monitor usage and disable the Worker or revoke the key if necessary. The production rate limiter fails closed if its binding is unavailable.
2. Bundle client packs into `chatbot/worker/clients.generated.mjs`:
   ```powershell
   node chatbot/worker/bundle-clients.mjs
   ```
3. Store your OpenAI API key as an encrypted Cloudflare Worker secret:
   ```powershell
   cd chatbot\worker
   npx wrangler secret put OPENAI_API_KEY
   ```
   Production webhook forwarding is disabled. Handoff summaries and contact links are displayed for the visitor to send themselves; no lead is automatically sent.
4. Deploy the Worker:
   ```powershell
   npx wrangler deploy
   ```
5. Update `data-api-url` on `<aside class="faq-widget">` in `index.html` with your live Worker `/api/chat` URL (and ensure `ALLOWED_ORIGINS` in `chatbot/worker/wrangler.toml` matches your site origin).
