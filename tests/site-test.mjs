import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  headless: true
});
const results = [];
for (const width of [375, 768, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'domcontentloaded' });
  const state = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent.trim(),
    sections: document.querySelectorAll('main section').length,
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    focusTarget: document.querySelector('a[href="#contact"]')?.getAttribute('href'),
    favicon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
    bridge: !!document.querySelector('.transition-bridge')
  }));
  await page.locator('.transition-bridge').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1300);
  const bridgeVisible = await page.locator('.transition-bridge').evaluate(element => element.classList.contains('is-visible'));
  results.push({ width, ...state, bridgeVisible, overflow: state.scrollWidth > state.viewportWidth, errors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
if (results.some(result => result.overflow || result.errors.length || result.h1 !== 'Build the way forward.' || result.favicon !== 'favicon.svg' || !result.bridge || !result.bridgeVisible)) {
  process.exit(1);
}
