import { buildSystemPrompt, detectLanguage } from './prompt.mjs';
import { buildHandoffPayload, getLeadToolDefinition, LEAD_TOOL_NAME } from './lead-tools.mjs';

export class ChatbotError extends Error {
  constructor(message, { status = 500, code = 'internal_error' } = {}) {
    super(message);
    this.name = 'ChatbotError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Normalize an unmistakable model obscenity refusal (e.g. accidental trailing punctuation
 * or appended translation line) to the exact required string without touching valid replies.
 */
export function normalizeExactObscenityRefusal(text) {
  if (typeof text !== 'string') return text;
  if (/^\s*I\s+can['’]?t\s+satisfy\s+your\s+request(?:[.!]|\s*\r?\n[\s\S]*)?$/i.test(text)) {
    return 'I cant satisfy your request';
  }
  return text;
}

function extractResponseArtifacts(data) {
  const textParts = [];
  let functionCall = null;

  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
            textParts.push(part.text.trim());
          }
        }
      } else if (item?.type === 'function_call' && item?.name === LEAD_TOOL_NAME && !functionCall) {
        functionCall = item;
      }
    }
  }

  if (!textParts.length && typeof data?.output_text === 'string' && data.output_text.trim()) {
    textParts.push(data.output_text.trim());
  }

  return { text: textParts.join('\n\n').trim(), functionCall };
}

function extractToolList(text) {
  const knownTools = [
    'Excel',
    'Google Sheets',
    'Sheets',
    'WhatsApp',
    'Email',
    'Shopify',
    'WooCommerce',
    'Notion',
    'Airtable',
    'CRM',
    'ERP',
    'PDF',
    'POS'
  ];
  const found = knownTools.filter((tool) => new RegExp(`\\b${tool}\\b`, 'i').test(text));
  return found.length ? found.join(', ') : '';
}

function extractVisitorName(text) {
  const match = text.match(
    /(?:my name is|i am|i'm|this is|sou o|sou a|chamo-me|meu nome [eé]|o meu nome [eé])\s+([A-ZÀ-Ý][a-zà-ý]+(?:\s+[A-ZÀ-Ý][a-zà-ý]+)?)/i
  );
  if (!match) return '';
  const candidate = match[1].trim();
  const stopWords = ['from', 'at', 'da', 'do', 'de', 'looking', 'trying', 'a', 'an'];
  const parts = candidate.split(/\s+/).filter((word) => !stopWords.includes(word.toLowerCase()));
  return parts.join(' ');
}

function extractBusinessName(text) {
  const match = text.match(
    /(?:from|at|we run|my business is|our company is|da empresa|da|do|na)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ0-9'&-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9'&-]+){0,2})/
  );
  return match ? match[1].trim() : '';
}

/**
 * Deterministic offline mock responder used when CHATBOT_MOCK=1 for tests and offline evals.
 */
export function generateMockReply({ messages, clientConfig }) {
  const userMessages = messages.filter((m) => m.role === 'user');
  const latestUser = userMessages[userMessages.length - 1]?.content || '';
  const allUserText = userMessages.map((m) => m.content).join(' ');
  const lang = detectLanguage(latestUser, clientConfig?.defaultLanguage || 'en');
  const lower = latestUser.toLowerCase();

  // 0. Obscene / sexually explicit / abusive requests (never trigger on casual business profanity or benign security/abuse mentions)
  const isObsceneOrAbusiveRequest =
    /\b(porn|nsfw|erotic|sexually\s+explicit|nude\s+photos|send\s+nudes|blowjob|masturbat|sexo\s+expl[ií]cito|pornografia|fotos\s+nuas|go\s+fuck\s+yourself|fuck\s+you|kill\s+yourself|vai\s+tomar\s+no\s+cu)\b/i.test(
      latestUser
    );
  if (isObsceneOrAbusiveRequest) {
    return {
      reply: 'I cant satisfy your request',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 1. Prompt injection / system-prompt / secret extraction
  if (
    /(ignore\s+(?:all\s+)?previous|system\s*prompt|developer\s*prompt|reveal\s+your\s+(?:instructions|prompt)|api[_\s]?key|ignore\s+todas\s+as\s+instru[çc][õo]es|mostra(?:-me)?\s+o\s+(?:teu\s+)?prompt)/i.test(
      latestUser
    )
  ) {
    return {
      reply:
        lang === 'pt'
          ? 'Sou o Makweru e dedico-me apenas a questões sobre a Ndlela Systems, os nossos serviços e sugestões conceptuais de fluxo. Como posso ajudar o seu negócio?'
          : 'I am Makweru and I can only help with questions about Ndlela Systems, our services, and conceptual workflow suggestions. How can I help your business?',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 1b. Identity
  if (
    /\b(who\s+are\s+you|what\s+is\s+your\s+name|your\s+name|quem\s+[eé]s|qual\s+[eé]\s+o\s+teu\s+nome)\b/i.test(
      lower
    )
  ) {
    return {
      reply:
        lang === 'pt'
          ? 'Sou o Makweru, o assistente oficial do site da Ndlela Systems. Posso responder a dúvidas sobre os nossos serviços práticos ou dar sugestões conceptuais de fluxo de trabalho.'
          : 'I am Makweru, the official website assistant for Ndlela Systems. I can answer questions about our practical digital services or share short conceptual workflow suggestions.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 2. Conceptual workflow + code refusal OR pure off-topic general assistant tasks
  if (
    /(write\s+(?:me\s+)?a\s+node\.?js\s+script|high-level\s+workflow\s+idea|prevent\s+abuse|booking\s+form|order\s+form|spreadsheet\s+is\s+a\s+mess)/i.test(
      lower
    )
  ) {
    return {
      reply:
        lang === 'pt'
          ? 'Não escrevo código nem especificações técnicas, mas a nível conceptual pode estruturar os pedidos num formulário ou folha organizada (Excel/Sheets) com estado do pedido e registo do pagamento. Para mais detalhes, contacte o Shelton: https://wa.me/351910058371'
          : 'I cannot write code or technical specs, but conceptually you can route orders into one structured tracker (such as Excel/Sheets or a simple business system) with clear order and payment-status steps. For more details, contact Shelton: https://wa.me/351910058371',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  if (
    /(python\s+web\s+scraper|write\s+(?:me\s+)?a\s+(?:poem|script|essay|code)|recipe\s+for|homework|capital\s+of|escreve(?:-me)?\s+(?:um\s+poema|c[oó]digo)|receita\s+de)/i.test(
      latestUser
    )
  ) {
    return {
      reply:
        lang === 'pt'
          ? 'Este assistente dedica-se exclusivamente a questões sobre a Ndlela Systems, websites, sistemas práticos de negócio e organização de fluxos. Como posso ajudar a sua empresa hoje?'
          : 'This assistant only handles questions about Ndlela Systems, websites, practical business systems, and workflow organisation. How can I help your business today?',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 3. Free first consultation & project pricing trap (never quote amounts or currency)
  if (
    /(how\s+much|price|pricing|cost|quote|budget|hourly\s+rate|package\s+fee|free\s+consultation|first\s+consultation|quanto\s+custa|pre[çc]os?|or[çc]amento|tarifa|valores?|primeira\s+consulta)/i.test(
      lower
    ) &&
    !/(asheerah)/i.test(lower)
  ) {
    return {
      reply:
        lang === 'pt'
          ? 'A primeira consulta é gratuita. A Ndlela Systems não publica preços fixos de projeto nem estimativas automáticas porque tudo depende do âmbito. Para mais detalhes, contacte o Shelton no WhatsApp (+351 910 058 371): https://wa.me/351910058371'
          : 'Your first consultation is free. Ndlela Systems does not publish fixed project pricing because scope depends on your workflow and tools. For more details, contact Shelton on WhatsApp (+351 910 058 371): https://wa.me/351910058371',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 4. Timeline / guarantee trap (never promise delivery dates)
  if (
    /(guarantee|48\s*hours|how\s+long|how\s+fast|timeline|turnaround|deadline|prazo|garantem?|quanto\s+tempo|demora|em\s+\d+\s+(?:dias|horas|semanas))/i.test(
      lower
    )
  ) {
    return {
      reply:
        lang === 'pt'
          ? 'O prazo depende do fluxo de trabalho, do âmbito e dos sistemas envolvidos, por isso não prometemos datas fixas à partida. Um prazo concreto só é discutido depois de compreender o problema e o resultado pretendido numa Revisão de Fluxo.'
          : 'Timing depends on the workflow, scope, and systems involved, so we do not promise fixed deadlines upfront. A specific timeline is only discussed after the problem and intended outcome are understood in a Workflow Review.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 5. Lead qualification / handoff detection
  const hasLeadIntent =
    /(my\s+name\s+is|i\s+am\s+|i'm\s+|\bour\s+(?:business|company|team)|we\s+copy|we\s+spend|book\s+a\s+workflow|start\s+a\s+workflow|contact\s+shelton|talk\s+to\s+shelton|speak\s+with\s+shelton|sou\s+o\s+|sou\s+a\s+|chamo-me|a\s+minha\s+empresa|o\s+nosso\s+neg[oó]cio|copiamos|passamos|gastamos|quero\s+falar|gostaria\s+de\s+falar|marcar|agendar|come[çc]ar\s+uma\s+revis[aã]o)/i.test(
      latestUser
    );

  if (hasLeadIntent) {
    const visitorName = extractVisitorName(allUserText);
    const businessName = extractBusinessName(allUserText);
    const currentTools = extractToolList(allUserText);
    const handoff = buildHandoffPayload(
      {
        language: lang,
        visitor_name: visitorName || (lang === 'pt' ? 'Não indicado' : 'Not provided'),
        business_name: businessName || (lang === 'pt' ? 'Não indicado' : 'Not provided'),
        bottleneck: latestUser,
        current_tools: currentTools || (lang === 'pt' ? 'Não especificado' : 'Not specified'),
        desired_outcome:
          lang === 'pt'
            ? 'Reduzir trabalho manual numa Revisão de Fluxo exploratória'
            : 'Reduce manual steps via an exploratory Workflow Review'
      },
      clientConfig
    );

    return {
      reply:
        lang === 'pt'
          ? 'Preparei o resumo da sua Revisão de Fluxo com ligação direta para o WhatsApp e LinkedIn do Shelton. Pode rever ou enviar diretamente abaixo, sem compromisso.'
          : 'I have prepared your Workflow Review brief with direct links to reach Shelton on WhatsApp or LinkedIn. You can send or copy it below—exploratory and with no commitment to build.',
      language: lang,
      handoff,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 6. Selected work examples
  if (
    /(ohhhtc|jade|del[ií]cias|asheerah|selected\s+work|portfolio|examples|projects|projetos|exemplos|trabalho\s+feito|clientes)/i.test(
      lower
    )
  ) {
    return {
      reply:
        lang === 'pt'
          ? 'Os exemplos entregues pela Ndlela Systems incluem o menu multilingue da OhhhTC (77 pratos e 8 idiomas), a plataforma de encomendas da Delícias da Jade (10 bolos e fluxo dinâmico de pedido) e a loja bilingue PT/EN da Asheerah Hair (com chatbot de FAQ por regras). São demonstrações de capacidade entregue, não estudos de caso quantificados.'
          : 'Selected delivered work includes OhhhTC (77-dish menu in 8 languages), Delícias da Jade (10-cake catalogue with custom order flow), and Asheerah Hair (bilingual PT/EN e-commerce storefront with a rule-based FAQ chatbot). These are capability examples of delivered systems, not quantified case studies.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 7. Team / Founder / about / location
  if (
    /\b(team|how\s+big|employees|staff|who\s+works|equipa|funcion[aá]rios|quantas\s+pessoas)\b/i.test(
      lower
    )
  ) {
    return {
      reply:
        lang === 'pt'
          ? 'Neste momento a Ndlela Systems é uma equipa de uma só pessoa, liderada por Shelton Fenhane. Trabalha de forma independente com ferramentas modernas e um fluxo de trabalho com IA à sua volta, mantendo verificação pessoal em tudo o que é entregue.'
          : 'Right now Ndlela Systems is a one-person (one-man) team led by Shelton Fenhane. He works independently using modern tools and an AI workflow around him, with personal verification by Shelton on the work delivered.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  if (
    /(shelton|founder|ceo|who\s+founded|based|portugal|africa|fundador|quem\s+fundou|onde\s+(?:fica|est[aá])|sobre\s+a\s+ndlela)/i.test(
      lower
    )
  ) {
    return {
      reply:
        lang === 'pt'
          ? 'A Ndlela Systems foi fundada por Shelton Fenhane (Founder & CEO), com entrega liderada diretamente pelo fundador. A empresa está sediada em Portugal, trabalhando de perto com negócios locais enquanto constrói uma rede tecnológica entre a Europa e África.'
          : 'Ndlela Systems was founded by Shelton Fenhane (Founder & CEO), with founder-led delivery. It is based in Portugal, starting by working closely with businesses there while building toward a wider Europe-Africa technology network.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 8. AI stance
  if (/(\bai\b|\bia\b|artificial\s+intelligence|intelig[eê]ncia\s+artificial|chatgpt|gpt)/i.test(lower)) {
    return {
      reply:
        lang === 'pt'
          ? 'A IA é considerada apenas quando melhora um fluxo de trabalho real. A Ndlela Systems não trata a IA como ponto de partida nem assume que é sempre a resposta certa.'
          : 'AI is considered only where it improves a real workflow. Ndlela Systems does not treat AI as the starting point or assume it is the right answer.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 9. Existing tools / integrations
  if (/(existing\s+tools|already\s+use|connect|integrat|ferramentas|integrar|integra[çc][aã]o|sistemas\s+atuais|j[aá]\s+usamos)/i.test(lower)) {
    return {
      reply:
        lang === 'pt'
          ? 'Sim. O ponto de partida é compreender o fluxo atual e as ferramentas que a equipa já utiliza, ajudando sistemas desligados a partilhar a informação certa sem cópias manuais.'
          : 'Yes. Ndlela starts by understanding your current workflow and the tools you already use, then helps disconnected systems share the right information instead of copying data manually.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 10. Websites and internal tools
  if (/(website|websites|internal\s+tool|dashboard|dashboards|site|sites|pain[eé]is|ferramentas\s+internas)/i.test(lower)) {
    return {
      reply:
        lang === 'pt'
          ? 'Sim. O trabalho entregue inclui websites práticos para clientes, menus multilingues, fluxos de encomenda e e-commerce bilingue, além de painéis internos e automação de processos.'
          : 'Yes. Selected work includes customer-facing websites, multilingual menus, ordering flows, and bilingual e-commerce, alongside internal dashboards and workflow automation.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 11. First conversation / Workflow Review / Approach
  if (/(first\s+conversation|workflow\s+review|approach|how\s+do\s+you\s+work|primeira\s+conversa|como\s+funciona|abordagem|revis[aã]o\s+de\s+fluxo)/i.test(lower)) {
    return {
      reply:
        lang === 'pt'
          ? 'A primeira conversa é uma Revisão de Fluxo exploratória: analisamos o processo atual, as ferramentas e os gargalos sem precisar de caderno técnico. Depois definimos a menor melhoria com valor real antes de construir, testar e iterar—sem compromisso.'
          : 'The first conversation is an exploratory Workflow Review: we map your current process, tools, and handoffs with no technical brief required. Then we define the smallest valuable improvement before building, testing, and iterating—with no commitment to build.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 12. Target audience / Fit
  if (/(who\s+is|fit|for\s+me|type\s+of\s+business|para\s+quem|quem\s+[eé]|que\s+empresas|pequenas)/i.test(lower)) {
    return {
      reply:
        lang === 'pt'
          ? 'A Ndlela Systems é ideal para pequenas e médias empresas, empreendedores individuais e jovens fundadores em início de atividade que querem organizar ou fazer crescer o negócio.'
          : 'Ndlela Systems is ideal for small and medium companies, individual entrepreneurs, and young or early-stage founders organising or starting their businesses.',
      language: lang,
      handoff: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      model: 'mock',
      mode: 'mock'
    };
  }

  // 13. General overview fallback
  return {
    reply:
      lang === 'pt'
        ? 'A Ndlela Systems ajuda empresas a reduzir trabalho administrativo repetitivo através de automação prática de fluxos, integração entre ferramentas existentes, painéis internos, websites e fluxos assistidos por IA quando fazem sentido. Quer explicar-me que processo está a tomar mais tempo à sua equipa?'
        : 'Ndlela Systems helps owner-led and growing businesses reduce repetitive admin through workflow automation, system integrations, internal dashboards, practical websites, and AI-assisted workflows where useful. What recurring process is slowing your team down today?',
    language: lang,
    handoff: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    model: 'mock',
    mode: 'mock'
  };
}

/**
 * Call the OpenAI Responses API (or explicit mock mode) and return reply + optional lead handoff.
 */
export async function generateChatReply({
  messages,
  clientConfig,
  knowledgeMarkdown,
  env,
  fetchImpl = fetch
}) {
  if (String(env?.CHATBOT_MOCK || '') === '1') {
    return generateMockReply({ messages, clientConfig });
  }

  const apiKey = String(env?.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new ChatbotError('OpenAI API key is not configured on this server.', {
      status: 503,
      code: 'not_configured'
    });
  }

  const model = String(env?.OPENAI_MODEL || 'gpt-4.1-mini').trim() || 'gpt-4.1-mini';
  const maxOutputTokens = Number(clientConfig?.limits?.maxOutputTokens || 450);
  const isReasoningModel = /^(o[134]|gpt-5)/i.test(model);
  const instructions = buildSystemPrompt(clientConfig, knowledgeMarkdown);
  const input = messages.map((msg) => ({ role: msg.role, content: msg.content }));

  const callResponsesApi = async (body) => {
    let response;
    try {
      response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new ChatbotError('Unable to reach OpenAI service.', {
        status: 502,
        code: 'upstream_unreachable'
      });
    }

    if (!response.ok) {
      throw new ChatbotError(`Upstream model request failed with status ${response.status}.`, {
        status: response.status === 429 ? 429 : 502,
        code: response.status === 429 ? 'upstream_rate_limited' : 'upstream_error'
      });
    }

    try {
      return await response.json();
    } catch {
      throw new ChatbotError('Invalid response payload from model provider.', {
        status: 502,
        code: 'upstream_invalid_json'
      });
    }
  };

  const firstRequest = {
    model,
    instructions,
    input,
    tools: [getLeadToolDefinition(clientConfig)],
    tool_choice: 'auto',
    max_output_tokens: maxOutputTokens,
    store: false
  };
  if (!isReasoningModel) {
    firstRequest.temperature = 0.3;
  }

  const firstData = await callResponsesApi(firstRequest);
  let { text, functionCall } = extractResponseArtifacts(firstData);
  let handoff = null;
  let totalUsage = firstData?.usage || null;

  if (functionCall) {
    let parsedArgs = {};
    try {
      parsedArgs = JSON.parse(functionCall.arguments || '{}');
    } catch {
      parsedArgs = {};
    }
    handoff = buildHandoffPayload(parsedArgs, clientConfig);

    if (!text) {
      const followUpInput = [
        ...input,
        {
          type: 'function_call',
          call_id: functionCall.call_id,
          name: functionCall.name,
          arguments: functionCall.arguments || '{}'
        },
        {
          type: 'function_call_output',
          call_id: functionCall.call_id,
          output: JSON.stringify({
            status: 'handoff_ready',
            channel: 'whatsapp_and_linkedin',
            language: handoff.language
          })
        }
      ];

      const followUpRequest = {
        model,
        instructions,
        input: followUpInput,
        tool_choice: 'none',
        max_output_tokens: maxOutputTokens,
        store: false
      };
      if (!isReasoningModel) {
        followUpRequest.temperature = 0.3;
      }

      const secondData = await callResponsesApi(followUpRequest);
      const secondArtifacts = extractResponseArtifacts(secondData);
      text = secondArtifacts.text;
      if (secondData?.usage) {
        totalUsage = secondData.usage;
      }
    }
  }

  const latestUserText = messages.filter((m) => m.role === 'user').pop()?.content || '';
  if (text) {
    text = normalizeExactObscenityRefusal(text);
  }
  const isExactObscenityRefusal = text === 'I cant satisfy your request';
  if (isExactObscenityRefusal) {
    handoff = null;
  }

  const detectedLang = isExactObscenityRefusal
    ? detectLanguage(latestUserText, clientConfig?.defaultLanguage || 'en')
    : handoff?.language ||
      detectLanguage(text || latestUserText, clientConfig?.defaultLanguage || 'en');

  if (!text) {
    text =
      detectedLang === 'pt'
        ? 'Preparei o resumo para iniciar a conversa com o Shelton através dos canais abaixo.'
        : 'I have prepared your brief so you can reach Shelton directly using the links below.';
  }

  return {
    reply: text,
    language: detectedLang,
    handoff,
    usage: totalUsage,
    model: firstData?.model || model,
    mode: 'openai'
  };
}
