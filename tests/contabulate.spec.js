const { test, expect } = require('@playwright/test');

test('loads the Tanakh app and renders Hebrew content', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Contabulate: תנ״ך/);
  await page.waitForFunction(() => window.__contabulateReady === true);
  const baseHeaders = await page.locator('#results thead th').allTextContents();
  expect(baseHeaders.some((text) => text.includes('# comments'))).toBeTruthy();
  const options = await page.locator('#gran option').evaluateAll((opts) =>
    opts.map((opt) => ({ value: opt.value, text: (opt.textContent || '').trim() }))
  );
  expect(options.some((opt) => opt.value === 'scene')).toBeFalsy();
  expect(options).toContainEqual({ value: 'line', text: 'Verse' });

  await page.locator('#segmentsTab details summary').click();
  const optionTexts = await page.locator('#commentatorColumnSelect option').allTextContents();
  expect(optionTexts.some((text) => text === 'Rashi (28,247)')).toBeTruthy();
  await page.locator('#commentatorColumnFilter').fill('rashi');
  await expect(page.locator('#commentatorColumnControls .commentator-filter-count')).toContainText('1 of');
  await page.locator('#addCommentatorColumn').click();
  const commentatorHeaders = await page.locator('#results thead th').allTextContents();
  expect(commentatorHeaders.some((text) => text.includes('Rashi'))).toBeTruthy();

  await page.evaluate(() => {
    const tabs = document.querySelector('.tabs');
    tabs.classList.remove('is-hidden');
    tabs.style.display = 'flex';
  });
  await page.locator('.tab-btn[data-tab="lines"]').click();
  await page.fill('#linesQuery', 'אלהים');
  await page.press('#linesQuery', 'Enter');

  await expect(page.locator('#linesTableBody tr')).toHaveCount(50);
  const linesHeaders = await page.locator('#linesResults thead th').allTextContents();
  expect(linesHeaders.some((text) => text.includes('# comments'))).toBeTruthy();
  expect(linesHeaders.some((text) => text.includes('Verse #'))).toBeTruthy();
  expect(linesHeaders.some((text) => text.includes('Verse'))).toBeTruthy();
  await expect(page.locator('#linesTableBody')).toContainText('אֱלֹהִ');
  await expect(page.locator('#linesResults td.line-text').first()).toHaveCSS('direction', 'rtl');
});

test('maps legacy verse URL granularities to text-backed Verse view', async ({ page }) => {
  await page.goto('/?q=%D7%90%D7%9C%D7%94%D7%99%D7%9D&nm=1&gran=line&mm=exact&sk=location&sd=asc&cs=1&zr=0&hl=1');
  await page.waitForFunction(() => window.__contabulateReady === true);
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(page.locator('#gran')).toHaveValue('line');
  let headers = await page.locator('#results thead th').allTextContents();
  expect(headers.some((text) => text.includes('Verse'))).toBeTruthy();

  await page.goto('/?q=%D7%90%D7%9C%D7%94%D7%99%D7%9D&nm=1&gran=scene&mm=exact&sk=location&sd=asc&cs=1&zr=0&hl=1');
  await page.waitForFunction(() => window.__contabulateReady === true);
  await page.waitForSelector('#results tbody tr', { timeout: 10000 });
  await expect(page.locator('#gran')).toHaveValue('line');
  headers = await page.locator('#results thead th').allTextContents();
  expect(headers.some((text) => text.includes('Verse'))).toBeTruthy();
});
