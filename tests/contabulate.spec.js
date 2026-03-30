const { test, expect } = require('@playwright/test');

test('loads the Tanakh app and renders Hebrew content', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Contabulate: תנ״ך/);
  await page.waitForFunction(() => window.__contabulateReady === true);

  await page.fill('#linesQuery', 'אלהים');
  await page.press('#linesQuery', 'Enter');

  await expect(page.locator('#linesTableBody tr')).toHaveCount(50);
  await expect(page.locator('#linesTableBody')).toContainText('אֱלֹהִ');
  await expect(page.locator('#linesResults td.line-text').first()).toHaveCSS('direction', 'rtl');
});
