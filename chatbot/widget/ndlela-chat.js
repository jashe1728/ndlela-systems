(function () {
  const GREETING_TEXT = 'Hi, Im makweru how can I help you?';

  const FAQ_ANSWERS = {
    what: 'Ndlela Systems helps people build businesses and helps existing businesses improve and achieve their goals through practical digital services—websites, manageable web apps, business systems, workflow organisation/automation, connecting existing tools, payment-process organisation, Excel/Sheets, and practical operational consultancy.',
    fit: 'Ndlela Systems is ideal for small and medium companies, individual entrepreneurs, and young or early-stage founders organising or starting their businesses.',
    work: 'Yes. We start by understanding your current workflow and tools, and help connect existing systems or organise processes in Excel/Sheets and practical business systems (without guaranteeing every integration upfront).',
    websites: 'Yes. We build websites and apps/web apps of manageable complexity alongside practical business systems. Approved public examples include OhhhTC, Delícias da Jade, and Asheerah Hair.',
    process: 'Your first consultation is free and exploratory. We discuss your business goals or bottlenecks and suggest practical next steps with no commitment.',
    ai: 'AI is considered only where it improves a real workflow. Ndlela does not treat AI as the starting point or assume it is the right answer.',
    timing: 'Project pricing and delivery timelines depend on scope and are not estimated automatically. For more details, contact Shelton on WhatsApp (+351 910 058 371).'
  };

  const DEFAULT_CONTACT = {
    whatsappNumber: '351910058371',
    whatsappDisplay: '+351 910 058 371',
    whatsappBaseUrl: 'https://wa.me/351910058371',
    linkedinUrl: 'https://www.linkedin.com/company/ndlelasystems/'
  };

  function detectClientLanguage(text) {
    if (!text) return 'en';
    const cleaned = text.replace(/\bndlela(?:\s+systems)?\b/gi, ' ');
    const hasPtAccent = /[áàâãéêíóôõúç]/i.test(cleaned);
    const ptMatches = (
      cleaned.match(
        /\b(ol[aá]|oi|obrigad[oa]|voc[eê]s?|voss[oa]|que|qual|quem|como|quanto|custa|pre[çc]o|empresa|neg[oó]cio|ferramentas|automa[çc][aã]o|fluxo|revis[aã]o|falar|quero|preciso|sou|copiamos|para|com|fundou)\b/gi
      ) || []
    ).length;
    const enMatches = (
      cleaned.match(
        /\b(the|and|with|for|you|your|what|who|how|does|can|we|our|my|need|want|help|work|tools|workflow|price|business|system|website|start)\b/gi
      ) || []
    ).length;
    if (ptMatches * 2 + (hasPtAccent ? 2 : 0) > enMatches * 2) return 'pt';
    return 'en';
  }

  function isSafeHttpsUrl(url, prefix) {
    return typeof url === 'string' && url.startsWith(prefix || 'https://');
  }

  function isExactObscenityRefusal(text) {
    return typeof text === 'string' && text.trim() === 'I cant satisfy your request';
  }

  function isOffTopicDecline(text) {
    if (typeof text !== 'string') return false;
    return /\b(only\s+handles?\s+questions\s+about|only\s+help\s+with\s+questions\s+about|dedico-me\s+apenas|dedica-se\s+exclusivamente)\b/i.test(
      text
    );
  }

  function shouldShowContactCta(replyText) {
    if (typeof replyText !== 'string' || !replyText.trim()) return false;
    if (isExactObscenityRefusal(replyText) || isOffTopicDecline(replyText)) return false;
    return /(\bfor\s+more\s+details\b|\bpara\s+mais\s+detalhes\b|\bcontact\s+shelton\b|\bcontacte\s+o\s+shelton\b|\bwhatsapp\b|\b351\s?910\s?058\s?371\b|wa\.me\/351910058371|\bfree\b.*\bconsultation\b|\bprimeira\s+consulta\b.*\bgratuita\b|\bworkflow\s+review\b|\brevis[aã]o\s+de\s+fluxo\b)/i.test(
      replyText
    );
  }

  function formatDisplayReplyText(replyText, hasCard) {
    if (typeof replyText !== 'string') return '';
    if (!hasCard) return replyText;
    return replyText
      .replace(/\[([^\]]+)\]\((https?:\/\/wa\.me\/351910058371[^)]*)\)/gi, '$1')
      .replace(/https?:\/\/wa\.me\/351910058371\S*/gi, '')
      .replace(/\(\s*\)/g, '')
      .replace(/:\s*(?=\n|$)/gm, '.')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+\./g, '.')
      .trim();
  }

  function attachWheelScrollGuard(scrollEl) {
    if (!scrollEl) return;
    scrollEl.addEventListener(
      'wheel',
      (event) => {
        const deltaY = event.deltaY;
        if (deltaY === 0) return;
        const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;
        if (maxScrollTop <= 0) {
          event.preventDefault();
          return;
        }
        const atTop = scrollEl.scrollTop <= 0 && deltaY < 0;
        const atBottom = scrollEl.scrollTop >= maxScrollTop - 1 && deltaY > 0;
        if (atTop || atBottom) {
          event.preventDefault();
        }
      },
      { passive: false }
    );
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback below
      }
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }

  function buildClientHandoff(fields, lang) {
    const isPt = lang === 'pt';
    const visitorName = (fields.visitorName || '').trim() || (isPt ? 'Não indicado' : 'Not provided');
    const businessName = (fields.businessName || '').trim() || (isPt ? 'Não indicado' : 'Not provided');
    const bottleneck = (fields.bottleneck || '').trim() || (isPt ? 'Revisão de Fluxo' : 'Workflow Review enquiry');
    const currentTools = (fields.currentTools || '').trim() || (isPt ? 'Não especificado' : 'Not specified');
    const desiredOutcome =
      (fields.desiredOutcome || '').trim() ||
      (isPt ? 'Revisão de Fluxo exploratória' : 'Exploratory Workflow Review');

    const summaryText = isPt
      ? [
          'Olá Shelton, vim pelo site da Ndlela Systems para conversar sobre uma Revisão de Fluxo:',
          `- Nome: ${visitorName}`,
          `- Empresa: ${businessName}`,
          `- Problema / gargalo: ${bottleneck}`,
          `- Ferramentas atuais: ${currentTools}`,
          `- Objetivo: ${desiredOutcome}`
        ].join('\n')
      : [
          "Hi Shelton, I'm reaching out from the Ndlela Systems website for a Workflow Review:",
          `- Name: ${visitorName}`,
          `- Business: ${businessName}`,
          `- Bottleneck: ${bottleneck}`,
          `- Current tools: ${currentTools}`,
          `- Desired outcome: ${desiredOutcome}`
        ].join('\n');

    return {
      language: isPt ? 'pt' : 'en',
      visitorName,
      businessName,
      bottleneck,
      currentTools,
      desiredOutcome,
      summaryText,
      whatsappUrl: `${DEFAULT_CONTACT.whatsappBaseUrl}?text=${encodeURIComponent(summaryText)}`,
      linkedinUrl: DEFAULT_CONTACT.linkedinUrl
    };
  }

  function initWidget(root) {
    if (!root || root.dataset.initialized === 'true') return null;
    root.dataset.initialized = 'true';

    const clientId = (root.dataset.client || 'ndlela').trim();
    const explicitApiUrl = (root.dataset.apiUrl || '').trim();
    const isLocalHost =
      window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
    const apiUrl = explicitApiUrl || (isLocalHost ? '/api/chat' : '');

    // Makweru AI chat elements
    const chatLauncherBtn = root.querySelector('.chat-launcher');
    const chatPanel = root.querySelector('#makweru-panel');
    const chatCloseBtn = root.querySelector('.chat-close-btn');
    const clearBtn = root.querySelector('.chat-clear-btn');
    const chatScrollArea = root.querySelector('.chat-scroll-area');
    const threadEl = root.querySelector('.chat-thread');
    const composerForm = root.querySelector('.chat-composer');
    const inputEl = root.querySelector('.chat-input');
    const sendBtn = root.querySelector('.chat-send-btn');
    const briefToggleBtn = root.querySelector('.chat-brief-toggle');
    const briefDrawer = root.querySelector('.chat-brief-drawer');
    const briefForm = root.querySelector('.chat-brief-form');
    const langBadge = root.querySelector('.chat-lang-badge');

    // Separate Questions? FAQ elements
    const faqToggleBtn = root.querySelector('.faq-toggle');
    const faqPanel = root.querySelector('#faq-panel');
    const faqCloseBtn = root.querySelector('.faq-close-btn');
    const faqScrollArea = root.querySelector('.faq-scroll-area');
    const faqAnswer = root.querySelector('#faq-answer');

    const history = [];
    let currentLang = 'en';
    let inFlight = false;

    attachWheelScrollGuard(chatScrollArea);
    attachWheelScrollGuard(faqScrollArea);

    function updateUiLanguage(lang) {
      currentLang = lang === 'pt' ? 'pt' : 'en';
      if (langBadge) {
        langBadge.textContent = currentLang === 'pt' ? 'PT / EN' : 'EN / PT';
      }
      if (inputEl) {
        inputEl.placeholder =
          currentLang === 'pt'
            ? 'Escreva ao Makweru (PT ou EN)...'
            : 'Ask Makweru in English or Portuguese...';
      }
      if (sendBtn && !inFlight) {
        sendBtn.textContent = currentLang === 'pt' ? 'Enviar' : 'Send';
      }
    }

    function setChatOpen(open) {
      if (!chatLauncherBtn || !chatPanel) return;
      if (open) setFaqOpen(false);
      chatLauncherBtn.setAttribute('aria-expanded', String(open));
      chatPanel.hidden = !open;
      chatPanel.classList.toggle('is-open', open);
    }

    function setFaqOpen(open) {
      if (!faqToggleBtn || !faqPanel) return;
      if (open) setChatOpen(false);
      faqToggleBtn.setAttribute('aria-expanded', String(open));
      faqPanel.hidden = !open;
      faqPanel.classList.toggle('is-open', open);
    }

    function scrollThreadToBottom() {
      if (chatScrollArea) {
        chatScrollArea.scrollTop = chatScrollArea.scrollHeight;
      }
    }

    function appendMessage(role, text, extraClass) {
      if (!threadEl) return null;
      const el = document.createElement('div');
      el.className = `chat-msg chat-msg--${role}${extraClass ? ` ${extraClass}` : ''}`;
      el.textContent = text;
      threadEl.appendChild(el);
      scrollThreadToBottom();
      return el;
    }

    function renderInitialGreeting() {
      if (!threadEl) return;
      appendMessage('assistant', GREETING_TEXT, 'chat-msg--greeting');
    }

    function appendContactCard(lang, userContext) {
      if (!threadEl) return;
      const isPt = lang === 'pt';
      const card = document.createElement('div');
      card.className = 'chat-contact-card';

      const title = document.createElement('div');
      title.className = 'chat-handoff-title';
      title.textContent = isPt
        ? 'Para mais detalhes, contacte o Shelton'
        : 'For more details, contact Shelton';
      card.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'chat-handoff-actions';

      const prefill = isPt
        ? `Olá Shelton, vim pelo site da Ndlela Systems (${DEFAULT_CONTACT.whatsappDisplay}): ${String(userContext || '').slice(0, 180)}`
        : `Hi Shelton, I'm reaching out from the Ndlela Systems website: ${String(userContext || '').slice(0, 180)}`;
      const waLink = document.createElement('a');
      waLink.className = 'chat-handoff-btn primary';
      waLink.href = `${DEFAULT_CONTACT.whatsappBaseUrl}?text=${encodeURIComponent(prefill)}`;
      waLink.target = '_blank';
      waLink.rel = 'noopener noreferrer';
      waLink.textContent = isPt
        ? `WhatsApp (${DEFAULT_CONTACT.whatsappDisplay}) ↗`
        : `WhatsApp (${DEFAULT_CONTACT.whatsappDisplay}) ↗`;
      actions.appendChild(waLink);

      const liLink = document.createElement('a');
      liLink.className = 'chat-handoff-link';
      liLink.href = DEFAULT_CONTACT.linkedinUrl;
      liLink.target = '_blank';
      liLink.rel = 'noopener noreferrer';
      liLink.textContent = 'LinkedIn ↗';
      actions.appendChild(liLink);

      card.appendChild(actions);
      threadEl.appendChild(card);
      scrollThreadToBottom();
    }

    function appendHandoffCard(handoff) {
      if (!threadEl || !handoff) return;
      const isPt = handoff.language === 'pt';
      const card = document.createElement('div');
      card.className = 'chat-handoff-card';

      const title = document.createElement('div');
      title.className = 'chat-handoff-title';
      title.textContent = isPt
        ? 'Resumo pronto para Revisão de Fluxo'
        : 'Workflow Review brief ready';
      card.appendChild(title);

      const list = document.createElement('ul');
      list.className = 'chat-handoff-list';
      const rows = [
        [isPt ? 'Nome' : 'Name', handoff.visitorName],
        [isPt ? 'Empresa' : 'Business', handoff.businessName],
        [isPt ? 'Gargalo' : 'Bottleneck', handoff.bottleneck],
        [isPt ? 'Ferramentas' : 'Tools', handoff.currentTools]
      ];
      rows.forEach(([label, val]) => {
        if (!val) return;
        const li = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = `${label}: `;
        li.appendChild(strong);
        li.appendChild(document.createTextNode(val));
        list.appendChild(li);
      });
      card.appendChild(list);

      const actions = document.createElement('div');
      actions.className = 'chat-handoff-actions';

      if (isSafeHttpsUrl(handoff.whatsappUrl, 'https://wa.me/')) {
        const waLink = document.createElement('a');
        waLink.className = 'chat-handoff-btn primary';
        waLink.href = handoff.whatsappUrl;
        waLink.target = '_blank';
        waLink.rel = 'noopener noreferrer';
        waLink.textContent = isPt ? 'Enviar por WhatsApp ↗' : 'Send via WhatsApp ↗';
        actions.appendChild(waLink);
      }

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'chat-handoff-btn secondary';
      copyBtn.textContent = isPt ? 'Copiar resumo' : 'Copy brief';
      copyBtn.addEventListener('click', async () => {
        await copyToClipboard(handoff.summaryText || '');
        copyBtn.textContent = isPt ? 'Copiado!' : 'Copied!';
        window.setTimeout(() => {
          copyBtn.textContent = isPt ? 'Copiar resumo' : 'Copy brief';
        }, 2000);
      });
      actions.appendChild(copyBtn);

      if (isSafeHttpsUrl(handoff.linkedinUrl, 'https://')) {
        const liLink = document.createElement('a');
        liLink.className = 'chat-handoff-link';
        liLink.href = handoff.linkedinUrl;
        liLink.target = '_blank';
        liLink.rel = 'noopener noreferrer';
        liLink.textContent = 'LinkedIn ↗';
        actions.appendChild(liLink);
      }

      card.appendChild(actions);
      threadEl.appendChild(card);
      scrollThreadToBottom();
    }

    function showQuickFaq(key) {
      if (!faqAnswer) return;
      const answer = FAQ_ANSWERS[key];
      if (!answer) return;
      faqAnswer.replaceChildren();
      faqAnswer.appendChild(document.createTextNode(answer));
      faqAnswer.appendChild(document.createElement('br'));
      const contactLink = document.createElement('a');
      contactLink.className = 'faq-contact';
      contactLink.href = DEFAULT_CONTACT.whatsappBaseUrl;
      contactLink.target = '_blank';
      contactLink.rel = 'noopener noreferrer';
      contactLink.textContent = 'For more details, contact Shelton on WhatsApp ↗';
      faqAnswer.appendChild(contactLink);
      faqAnswer.hidden = false;
      if (faqScrollArea) {
        faqScrollArea.scrollTop = faqScrollArea.scrollHeight;
      }
    }

    async function sendChatMessage(rawText) {
      const text = String(rawText || '').trim();
      if (!text || inFlight) return;

      const detected = detectClientLanguage(text);
      updateUiLanguage(detected);
      appendMessage('user', text);
      history.push({ role: 'user', content: text });
      if (history.length > 12) history.splice(0, history.length - 12);

      if (!apiUrl) {
        const offlineText =
          detected === 'pt'
            ? 'O chat de IA ao vivo está em preparação neste site estático. Pode enviar já a sua mensagem diretamente ao Shelton pelo WhatsApp abaixo.'
            : 'Live AI chat is currently in preview on this static page. You can send your question straight to Shelton via WhatsApp below.';
        appendMessage('assistant', offlineText);
        history.push({ role: 'assistant', content: offlineText });
        appendHandoffCard(buildClientHandoff({ bottleneck: text }, detected));
        return;
      }

      inFlight = true;
      if (sendBtn) sendBtn.disabled = true;
      if (inputEl) inputEl.disabled = true;
      const typingEl = appendMessage(
        'assistant',
        detected === 'pt' ? 'A escrever…' : 'Thinking…',
        'chat-msg--typing'
      );

      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            messages: history
          })
        });

        let data = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }

        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);

        if (!res.ok || !data || typeof data.reply !== 'string') {
          const isRateLimited = res.status === 429;
          const isNotConfigured = res.status === 503;
          let fallbackText;
          if (detected === 'pt') {
            fallbackText = isRateLimited
              ? 'Demasiados pedidos seguidos. Aguarde alguns segundos ou contacte o Shelton diretamente abaixo.'
              : isNotConfigured
                ? 'O assistente com IA ainda não está disponível neste ambiente local. Pode enviar o resumo ao Shelton por WhatsApp.'
                : 'Não foi possível ligar ao assistente agora. Pode contactar o Shelton diretamente abaixo.';
          } else {
            fallbackText = isRateLimited
              ? 'Too many requests in a short time. Please wait a moment or reach Shelton directly below.'
              : isNotConfigured
                ? 'Live AI is not configured in this local environment yet. You can reach Shelton via WhatsApp below.'
                : 'Unable to reach the assistant right now. You can message Shelton directly below.';
          }
          appendMessage('assistant', fallbackText);
          appendHandoffCard(buildClientHandoff({ bottleneck: text }, detected));
          return;
        }

        const replyLang = data.language === 'pt' ? 'pt' : 'en';
        updateUiLanguage(replyLang);

        const showHandoff = Boolean(data.handoff);
        const showCta = !showHandoff && shouldShowContactCta(data.reply);
        const displayText = formatDisplayReplyText(data.reply, showHandoff || showCta);

        appendMessage('assistant', displayText || data.reply);
        history.push({ role: 'assistant', content: data.reply });
        if (history.length > 12) history.splice(0, history.length - 12);

        if (showHandoff) {
          appendHandoffCard(data.handoff);
        } else if (showCta) {
          appendContactCard(replyLang, text);
        }
      } catch {
        if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
        const netErr =
          detected === 'pt'
            ? 'Ligação indisponível neste momento. Pode enviar a sua dúvida diretamente ao Shelton abaixo.'
            : 'Connection unavailable right now. You can send your question directly to Shelton below.';
        appendMessage('assistant', netErr);
        appendHandoffCard(buildClientHandoff({ bottleneck: text }, detected));
      } finally {
        inFlight = false;
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.textContent = currentLang === 'pt' ? 'Enviar' : 'Send';
        }
        if (inputEl) {
          inputEl.disabled = false;
          inputEl.focus();
        }
      }
    }

    renderInitialGreeting();

    chatLauncherBtn?.addEventListener('click', () => {
      const isExpanded = chatLauncherBtn.getAttribute('aria-expanded') === 'true';
      setChatOpen(!isExpanded);
      if (!isExpanded && inputEl) {
        inputEl.focus();
      }
    });

    chatCloseBtn?.addEventListener('click', () => {
      setChatOpen(false);
      chatLauncherBtn?.focus();
    });

    faqToggleBtn?.addEventListener('click', () => {
      const isExpanded = faqToggleBtn.getAttribute('aria-expanded') === 'true';
      setFaqOpen(!isExpanded);
    });

    faqCloseBtn?.addEventListener('click', () => {
      setFaqOpen(false);
      faqToggleBtn?.focus();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (chatPanel && !chatPanel.hidden) {
        setChatOpen(false);
        chatLauncherBtn?.focus();
      } else if (faqPanel && !faqPanel.hidden) {
        setFaqOpen(false);
        faqToggleBtn?.focus();
      }
    });

    clearBtn?.addEventListener('click', () => {
      history.length = 0;
      if (threadEl) threadEl.replaceChildren();
      renderInitialGreeting();
      updateUiLanguage('en');
    });

    root.querySelectorAll('[data-faq]').forEach((btn) => {
      btn.addEventListener('click', () => showQuickFaq(btn.dataset.faq));
    });

    composerForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!inputEl) return;
      const val = inputEl.value;
      if (!val.trim()) return;
      inputEl.value = '';
      void sendChatMessage(val);
    });

    inputEl?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        composerForm?.requestSubmit();
      }
    });

    briefToggleBtn?.addEventListener('click', () => {
      if (!briefDrawer) return;
      const willOpen = briefDrawer.hidden;
      briefDrawer.hidden = !willOpen;
      briefToggleBtn.setAttribute('aria-expanded', String(willOpen));
    });

    briefForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const nameInput = briefForm.querySelector('[name="visitorName"]');
      const businessInput = briefForm.querySelector('[name="businessName"]');
      const bottleneckInput = briefForm.querySelector('[name="bottleneck"]');
      const bottleneck = (bottleneckInput?.value || '').trim();
      if (!bottleneck) {
        bottleneckInput?.focus();
        return;
      }
      const detected = detectClientLanguage(`${nameInput?.value || ''} ${bottleneck}`);
      updateUiLanguage(detected);
      const handoff = buildClientHandoff(
        {
          visitorName: nameInput?.value || '',
          businessName: businessInput?.value || '',
          bottleneck
        },
        detected
      );
      appendHandoffCard(handoff);
      briefForm.reset();
      if (briefDrawer) briefDrawer.hidden = true;
      if (briefToggleBtn) briefToggleBtn.setAttribute('aria-expanded', 'false');
    });

    return { setChatOpen, setFaqOpen, showQuickFaq, sendChatMessage };
  }

  function initAll() {
    document.querySelectorAll('.assistant-dock, .faq-widget').forEach((node) => initWidget(node));
  }

  window.NdlelaChatWidget = { initWidget, initAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
