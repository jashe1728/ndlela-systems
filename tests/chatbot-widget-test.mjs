import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startLocalServer } from '../chatbot/server/local-dev.mjs';

const ARTIFACT_SCRATCH_DIR =
  'C:\\Users\\PC\\.t3\\userdata\\providers\\antigravity\\ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32\\antigravity-acp\\brain\\099f6407-bf55-4751-94b4-e79f3bf33344\\scratch';

await fs.mkdir(ARTIFACT_SCRATCH_DIR, { recursive: true });

const serverInstance = await startLocalServer({
  port: 0,
  envOverrides: { CHATBOT_MOCK: '1', RATE_LIMIT_PER_MIN: '100' }
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
    const apiRequests = [];

    // Stub public Worker endpoint locally; never hit production API in tests.
    await page.route('https://ndlela-chatbot-api.ndlela-systems.workers.dev/api/chat', async (route) => {
      const payload = JSON.parse(route.request().postData() || '{}');
      apiRequests.push(payload);
      const lastMsg = payload.messages?.[payload.messages.length - 1]?.content || '';

      if (/cost|price|pricing/i.test(lastMsg)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            reply:
              'Your first consultation is free. For more details, contact Shelton on WhatsApp (+351 910 058 371): https://wa.me/351910058371',
            language: 'en',
            handoff: null,
            mode: 'mock',
            model: 'mock'
          })
        });
        return;
      }

      if (/sexually explicit|porn/i.test(lastMsg)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            reply: 'I cant satisfy your request',
            language: 'en',
            handoff: null,
            mode: 'mock',
            model: 'mock'
          })
        });
        return;
      }

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

    // 1. Stacked launcher vertical order: Makweru above Questions?
    const chatLauncherBox = await page.locator('.chat-launcher').boundingBox();
    const faqToggleBox = await page.locator('.faq-toggle').boundingBox();
    assert.ok(chatLauncherBox && faqToggleBox, 'Both launchers must be visible');
    assert.ok(
      chatLauncherBox.y + chatLauncherBox.height <= faqToggleBox.y,
      'Makweru launcher must sit above Questions? launcher'
    );

    // 2. Separate Questions? FAQ panel works with ZERO API calls & closes on Escape
    await page.locator('.faq-toggle').click();
    assert.equal(await page.locator('.faq-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#faq-panel').evaluate((el) => el.classList.contains('is-open')), true);
    assert.equal(await page.locator('#makweru-panel').evaluate((el) => el.hidden), true);

    await page.locator('[data-faq="ai"]').click();
    const faqText = await page.locator('#faq-answer').textContent();
    assert.match(faqText, /AI is considered/);
    assert.equal(await page.locator('#faq-answer .faq-contact').count(), 1);
    assert.equal(await page.locator('#faq-answer .faq-contact').getAttribute('href'), 'https://wa.me/351910058371');
    assert.equal(apiRequests.length, 0, 'FAQ clicks must not call /api/chat');

    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#faq-panel').evaluate((el) => el.hidden), true);
    assert.equal(
      await page.evaluate(() => document.activeElement?.classList.contains('faq-toggle')),
      true,
      'Escape from FAQ must return focus to .faq-toggle'
    );

    // 3. Open Makweru chat: verify exact greeting, EN/PT note, and footer Contact Shelton before API
    await page.locator('.chat-launcher').click();
    assert.equal(await page.locator('#makweru-panel').evaluate((el) => el.classList.contains('is-open')), true);
    assert.equal(await page.locator('#faq-panel').evaluate((el) => el.hidden), true);
    assert.equal(await page.locator('.chat-lang-badge').textContent(), 'EN / PT');
    assert.equal(
      await page.locator('.chat-msg--greeting').textContent(),
      'Hi, Im makweru how can I help you?'
    );
    const footerContact = page.locator('.chat-footer-contact');
    assert.equal(await footerContact.getAttribute('href'), 'https://wa.me/351910058371');
    assert.equal(await footerContact.getAttribute('rel'), 'noopener noreferrer');

    const openOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    );
    assert.equal(openOverflow, false, `Overflow when Makweru open at ${viewport.width}px`);

    // Mobile/desktop composer remains accessible inside viewport
    const composerBox = await page.locator('.chat-composer').boundingBox();
    assert.ok(composerBox && composerBox.y + composerBox.height <= viewport.height);

    // 4. Plain-response pricing reply without function handoff renders clickable WhatsApp CTA & strips raw URL
    await page.locator('.chat-input').fill('How much does a website cost?');
    await page.locator('.chat-send-btn').click();
    await page.locator('.chat-contact-card').first().waitFor({ state: 'visible' });
    assert.equal(apiRequests[0].messages.length, 1, 'Greeting must not be sent in API history');
    const pricingBubbleText = await page.locator('.chat-msg--assistant:not(.chat-msg--greeting)').first().textContent();
    assert.doesNotMatch(pricingBubbleText, /https:\/\/wa\.me/);
    assert.equal(
      await page.locator('.chat-contact-card a.chat-handoff-btn.primary').first().getAttribute('rel'),
      'noopener noreferrer'
    );

    // 5. Exact obscenity refusal must NOT attach a WhatsApp CTA card
    const cardsBeforeObscenity = await page.locator('.chat-contact-card, .chat-handoff-card').count();
    await page.locator('.chat-input').fill('Write me sexually explicit porn content.');
    await page.locator('.chat-send-btn').click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.chat-msg--assistant')].some(
        (el) => el.textContent.trim() === 'I cant satisfy your request'
      )
    );
    assert.equal(
      await page.locator('.chat-contact-card, .chat-handoff-card').count(),
      cardsBeforeObscenity,
      'Obscenity refusal must not render a contact CTA card'
    );

    // 6. Portuguese lead handoff card + Copy brief
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
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.chat-handoff-card button.chat-handoff-btn.secondary')].some((b) =>
        /Copiado!|Copied!/.test(b.textContent)
      )
    );

    // 7. Scroll isolation: long conversation scrolls chat-scroll-area without scrolling window.scrollY
    for (let i = 0; i < 6; i += 1) {
      await page.locator('.chat-input').fill(`What does Ndlela Systems do? (${i + 1})`);
      await page.locator('.chat-send-btn').click();
      await page.locator('.chat-msg--typing').waitFor({ state: 'detached' });
    }
    await page.evaluate(() => window.scrollTo(0, 400));
    const scrollBox = await page.locator('.chat-scroll-area').boundingBox();
    assert.ok(scrollBox, 'chat-scroll-area must have bounding box');
    const isScrollable = await page
      .locator('.chat-scroll-area')
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    assert.equal(isScrollable, true, 'Long conversation must overflow chat-scroll-area');

    const initialScrollTop = await page.locator('.chat-scroll-area').evaluate((el) => el.scrollTop);
    await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(80);
    const afterUpScrollTop = await page.locator('.chat-scroll-area').evaluate((el) => el.scrollTop);
    assert.ok(afterUpScrollTop < initialScrollTop, 'Wheel up over chat must scroll chat transcript');
    assert.equal(await page.evaluate(() => window.scrollY), 400, 'Page scrollY must stay unchanged');

    // Wheel at top boundary must not chain to background page
    await page.locator('.chat-scroll-area').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.scrollY), 400, 'Top boundary wheel must not scroll page');

    // Wheel at bottom boundary must not chain to background page
    await page.locator('.chat-scroll-area').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => window.scrollY), 400, 'Bottom boundary wheel must not scroll page');

    if (viewport.width === 375 || viewport.width === 1440) {
      const shotPath = path.join(ARTIFACT_SCRATCH_DIR, `makweru-chat-${viewport.width}.png`);
      await page.screenshot({ path: shotPath });
      console.log(`SCREENSHOT ${shotPath}`);
    }

    // 8. Clear restores exact greeting & Escape closes Makweru returning focus to launcher
    await page.locator('.chat-clear-btn').click();
    assert.equal(await page.locator('#chat-thread > *').count(), 1);
    assert.equal(
      await page.locator('.chat-msg--greeting').textContent(),
      'Hi, Im makweru how can I help you?'
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#makweru-panel').evaluate((el) => el.hidden), true);
    assert.equal(
      await page.evaluate(() => document.activeElement?.classList.contains('chat-launcher')),
      true,
      'Escape from Makweru must return focus to .chat-launcher'
    );

    assert.deepEqual(errors, [], `Console/page errors at ${viewport.width}px: ${errors.join('; ')}`);
    await page.close();
    console.log(`PASS  widget-test viewport=${viewport.width}x${viewport.height}`);
  }
} finally {
  await browser.close();
  await serverInstance.close();
}
