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
    logoSrc: document.querySelector('.brand-logo')?.getAttribute('src'),
    logoLoaded: document.querySelector('.brand-logo')?.complete && document.querySelector('.brand-logo')?.naturalWidth > 0,
    portraitSrc: document.querySelector('.ceo-portrait')?.getAttribute('src'),
    portraitLoaded: document.querySelector('.ceo-portrait')?.complete && document.querySelector('.ceo-portrait')?.naturalWidth > 0,
    heroPosition: getComputedStyle(document.querySelector('.hero-grid')).position
  }));
  await page.evaluate(() => window.scrollTo(0, Math.max(window.innerHeight * .35, 1)));
  await page.waitForTimeout(150);
  const transitionProgress = await page.locator('.hero').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--hero-progress')) || 0);
  const transitionActive = width > 620 ? transitionProgress > 0 : state.heroPosition === 'static';
  await page.locator('#friction').scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  const interaction = await page.evaluate(() => ({
    railCount: document.querySelectorAll('.scroll-rail button').length,
    frictionActive: document.querySelector('#friction')?.classList.contains('is-active'),
    frictionRevealed: document.querySelector('#friction [data-reveal]')?.classList.contains('is-inview'),
    progressWidth: parseFloat(document.querySelector('.scroll-progress span')?.style.width || '0')
  }));
  await page.locator('#brand-tab-jade').click();
  const brandToggle = await page.evaluate(() => ({
    selected: document.querySelector('#brand-tab-jade')?.getAttribute('aria-selected'),
    activePanel: document.querySelector('.brand-panel.is-active')?.id,
    hiddenPanels: document.querySelectorAll('.brand-panel[hidden]').length
  }));
  results.push({ width, ...state, transitionProgress, transitionActive, ...interaction, ...brandToggle, overflow: state.scrollWidth > state.viewportWidth, errors });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
if (results.some(result => result.overflow || result.errors.length || result.h1 !== 'Build the way forward.' || result.favicon !== 'favicon.svg' || result.logoSrc !== 'assets/ndlela-systems-primary.png' || !result.logoLoaded || result.portraitSrc !== 'assets/shelton-fenhane.jpg' || !result.portraitLoaded || !result.transitionActive || result.sections !== 8 || result.railCount !== 8 || !result.frictionActive || !result.frictionRevealed || result.progressWidth <= 0 || result.selected !== 'true' || result.activePanel !== 'brand-panel-jade' || result.hiddenPanels !== 2)) {
  process.exit(1);
}
