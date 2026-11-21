import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIENTS_DIR, REPO_ROOT, loadClientsFromDisk, loadEnvFiles } from '../server/local-dev.mjs';
import { generateChatReply } from '../core/openai-client.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const useMock = args.includes('--mock');
const clientArg = args.find((a) => a.startsWith('--client='));
const clientId = clientArg ? clientArg.split('=')[1] : 'ndlela';

loadEnvFiles(REPO_ROOT);
const env = {
  ...process.env,
  ...(useMock ? { CHATBOT_MOCK: '1' } : {})
};

if (!useMock && !String(env.OPENAI_API_KEY || '').trim()) {
  console.error('Error: OPENAI_API_KEY is not set. Add it to chatbot/.env or pass --mock.');
  process.exit(1);
}

const clients = await loadClientsFromDisk(CLIENTS_DIR);
const clientEntry = clients[clientId];
if (!clientEntry) {
  console.error(`Error: Client pack "${clientId}" not found.`);
  process.exit(1);
}

const casesPath = path.join(__dirname, `${clientId}-cases.json`);
const cases = JSON.parse(await fs.readFile(casesPath, 'utf8'));

let passed = 0;
const failures = [];

for (const testCase of cases) {
  const issues = [];
  let result;

  try {
    result = await generateChatReply({
      messages: testCase.messages,
      clientConfig: clientEntry.config,
      knowledgeMarkdown: clientEntry.knowledge,
      env
    });
  } catch (err) {
    issues.push(`Request error: ${err.message}`);
  }

  if (result) {
    if (testCase.expectedLanguage && result.language !== testCase.expectedLanguage) {
      issues.push(`Expected language "${testCase.expectedLanguage}", got "${result.language}"`);
    }

    if (typeof testCase.maxChars === 'number' && result.reply.length > testCase.maxChars) {
      issues.push(`Reply length ${result.reply.length} exceeded maxChars ${testCase.maxChars}`);
    }

    if (testCase.exactReply !== undefined && result.reply.trim() !== testCase.exactReply) {
      issues.push(`Expected exact reply "${testCase.exactReply}", got "${result.reply.trim()}"`);
    }

    if (Array.isArray(testCase.mustNotIncludeAny) && testCase.mustNotIncludeAny.length > 0) {
      const lowerReply = result.reply.toLowerCase();
      for (const forbidden of testCase.mustNotIncludeAny) {
        if (lowerReply.includes(forbidden.toLowerCase())) {
          issues.push(`Reply included forbidden term: ${forbidden}`);
        }
      }
    }

    if (Array.isArray(testCase.mustIncludeAny) && testCase.mustIncludeAny.length > 0) {
      const lowerReply = result.reply.toLowerCase();
      const matched = testCase.mustIncludeAny.some((needle) =>
        lowerReply.includes(needle.toLowerCase())
      );
      if (!matched) {
        issues.push(`Reply missing any expected term: ${testCase.mustIncludeAny.join(', ')}`);
      }
    }

    if (testCase.mustNotMatchRegex) {
      const rx = new RegExp(testCase.mustNotMatchRegex, 'i');
      if (rx.test(result.reply)) {
        issues.push(`Reply matched forbidden pattern: ${testCase.mustNotMatchRegex}`);
      }
    }

    if (typeof testCase.expectHandoff === 'boolean') {
      const hasHandoff = Boolean(result.handoff);
      if (hasHandoff !== testCase.expectHandoff) {
        issues.push(`Expected handoff=${testCase.expectHandoff}, got ${hasHandoff}`);
      }
    }

    if (Array.isArray(testCase.handoffMustInclude) && result.handoff) {
      const haystack = `${result.handoff.summaryText}\n${result.handoff.whatsappUrl}`.toLowerCase();
      for (const needle of testCase.handoffMustInclude) {
        if (!haystack.includes(needle.toLowerCase())) {
          issues.push(`Handoff missing "${needle}"`);
        }
      }
      if (!result.handoff.whatsappUrl.startsWith('https://wa.me/351910058371?text=')) {
        issues.push('Invalid WhatsApp deep link URL');
      }
    }
  }

  if (issues.length === 0) {
    passed += 1;
    console.log(`PASS  ${testCase.id}`);
  } else {
    failures.push({ id: testCase.id, issues, reply: result?.reply || '' });
    console.log(`FAIL  ${testCase.id} -> ${issues.join('; ')}`);
  }
}

console.log(`\nEval summary (${useMock ? 'mock' : 'live'}): ${passed}/${cases.length} passed`);
if (failures.length > 0) {
  process.exit(1);
}
