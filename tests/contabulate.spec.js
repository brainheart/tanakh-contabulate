const { test, expect } = require('@playwright/test');

test('loads the Tanakh app and renders Hebrew content', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Contabulate: תנ״ך/);
  await page.waitForFunction(() => window.__contabulateReady === true);
  const baseHeaders = await page.locator('#results thead th').allTextContents();
  expect(baseHeaders.some((text) => text.includes('# comments'))).toBeTruthy();

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
  await expect(page.locator('#linesTableBody')).toContainText('אֱלֹהִ');
  await expect(page.locator('#linesResults td.line-text').first()).toHaveCSS('direction', 'rtl');
});
