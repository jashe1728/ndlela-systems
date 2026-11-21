import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startLocalServer } from '../chatbot/server/local-dev.mjs';

const serverInstance = await startLocalServer({
  port: 0,
  envOverrides: { CHATBOT_MOCK: '1' }
});

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  headless: true
});

try {
  for (const viewport of [
    { width: 320, height: 844 },
    { width: 375, height: 844 },
    { width: 1440, height: 900 }
  ]) {
    const page = await browser.newPage({ viewport });
    // Exercise the shipped widget while keeping mock tests off the public API.
    await page.route('https://ndlela-chatbot-api.ndlela-systems.workers.dev/api/chat', async route => {
      const response = await route.fetch({ url: `${serverInstance.baseUrl}/api/chat` });
      await route.fulfill({ response });
    });
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${serverInstance.baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });

    const closedOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    assert.equal(closedOverflow, false, `Overflow when closed at ${viewport.width}px`);

    await page.locator('.faq-toggle').click();
    assert.equal(await page.locator('.faq-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#faq-panel').evaluate((el) => el.classList.contains('is-open')), true);

    const openOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    assert.equal(openOverflow, false, `Overflow when open at ${viewport.width}px`);

    // Backward-compatible quick FAQ chip
    const titleText = await page.locator('.chat-title-row h2').textContent();
    assert.match(titleText, /Makweru/);
    await page.locator('[data-faq="ai"]').click();
    const faqText = await page.locator('#faq-answer').textContent();
    assert.match(faqText, /AI is considered/);
    assert.equal(await page.locator('#faq-answer .faq-contact').count(), 1);
    const faqHref = await page.locator('#faq-answer .faq-contact').getAttribute('href');
    assert.equal(faqHref, 'https://wa.me/351910058371');

    // English live/mock chat turn
    await page.locator('.chat-input').fill('What does Ndlela Systems do?');
    await page.locator('.chat-send-btn').click();
    await page.locator('.chat-msg--assistant:not(.chat-msg--typing)').first().waitFor({ state: 'visible' });
    const firstReply = await page.locator('.chat-msg--assistant:not(.chat-msg--typing)').first().textContent();
    assert.match(firstReply, /Ndlela Systems/);

    // Portuguese lead handoff turn
    await page
      .locator('.chat-input')
      .fill('Olá, sou o João da Padaria Lisboa. Copiamos encomendas do WhatsApp para o Excel à mão e quero falar com o Shelton.');
    await page.locator('.chat-send-btn').click();
    await page.locator('.chat-handoff-card').first().waitFor({ state: 'visible' });

    const waHref = await page.locator('.chat-handoff-card a.chat-handoff-btn.primary').first().getAttribute('href');
    assert.ok(waHref && waHref.startsWith('https://wa.me/351910058371?text='));
    assert.match(decodeURIComponent(waHref), /Padaria Lisboa/);

    const copyBtn = page.locator('.chat-handoff-card button.chat-handoff-btn.secondary').first();
    await copyBtn.click();
    await page.waitForFunction(() => [...document.querySelectorAll('.chat-handoff-card button.chat-handoff-btn.secondary')].some(button => /Copiado!|Copied!/.test(button.textContent)));
    assert.match(await copyBtn.textContent(), /Copiado!|Copied!/);

    // Manual Workflow Review brief drawer
    await page.locator('.chat-brief-toggle').click();
    await page.locator('.chat-brief-form [name="visitorName"]').fill('Ana');
    await page.locator('.chat-brief-form [name="businessName"]').fill('Casa Sul');
    await page.locator('.chat-brief-form [name="bottleneck"]').fill('Copying orders from email to spreadsheets');
    await page.locator('.chat-brief-submit').click();
    assert.equal(await page.locator('.chat-handoff-card').count(), 2);

    // Clear & close
    await page.locator('.chat-clear-btn').click();
    assert.equal(await page.locator('#chat-thread > *').count(), 0);
    await page.locator('.chat-close-btn').click();
    assert.equal(await page.locator('.faq-toggle').getAttribute('aria-expanded'), 'false');

    assert.deepEqual(errors, [], `Console/page errors at ${viewport.width}px: ${errors.join('; ')}`);
    await page.close();
    console.log(`PASS  widget-test viewport=${viewport.width}x${viewport.height}`);
  }
} finally {
  await browser.close();
  await serverInstance.close();
}
