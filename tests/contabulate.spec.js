const { test, expect } = require('@playwright/test');

test('loads the Tanakh app and renders Hebrew content', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Contabulate: תנ״ך/);
  await page.waitForFunction(() => window.__contabulateReady === true);
  const baseHeaders = await page.locator('#results thead th').allTextContents();
  expect(baseHeaders.some((text) => text.includes('# verses'))).toBeTruthy();
  expect(baseHeaders.some((text) => text.includes('# comments'))).toBeTruthy();
  expect(baseHeaders.some((text) => text.includes('Comments / verse'))).toBeTruthy();
  const options = await page.locator('#gran option').evaluateAll((opts) =>
    opts.map((opt) => ({ value: opt.value, text: (opt.textContent || '').trim() }))
  );
  expect(options.some((opt) => opt.value === 'scene')).toBeFalsy();
  expect(options).toContainEqual({ value: 'line', text: 'Verse' });

  // Column adding lives in the "+" header cell popover
  await page.locator('#results thead th.add-column-th').click();
  const popover = page.locator('.add-column-popover');
  await expect(popover).toBeVisible();
  await expect(popover.locator('.add-column-option', { hasText: 'Words/Sentence' })).toBeVisible();
  await popover.locator('.add-column-search').fill('rashi');
  const rashiOption = popover.locator('.add-column-option', { hasText: 'Rashi' });
  await expect(rashiOption).toHaveCount(1);
  await expect(rashiOption.locator('.count')).toHaveText('28,247');
  await rashiOption.click();
  await expect(popover.locator('.add-column-option.is-selected', { hasText: 'Rashi' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  const commentatorHeaders = await page.locator('#results thead th').allTextContents();
  expect(commentatorHeaders.some((text) => text.includes('Rashi'))).toBeTruthy();
  const commentButton = page.locator('#results tbody .commentary-count-link').first();
  await expect(commentButton).toBeVisible();
  await commentButton.click();
  await expect(page.locator('.commentary-detail-overlay.open')).toBeVisible();
  await expect(page.locator('#commentaryDetailTitle')).toContainText('Commentary');
  await expect(page.locator('.commentary-detail-table tbody tr').first()).toBeVisible();
  await expect(page.locator('.commentary-detail-table .commentary-link-cell a').first()).toHaveAttribute('href', /sefaria\.org/);
  await page.locator('.commentary-detail-close').click();

  // Book-level counts open the same modal with all of the book's comments
  await page.selectOption('#gran', 'play');
  const bookCommentButton = page.locator('#results tbody .commentary-count-link').first();
  await expect(bookCommentButton).toBeVisible();
  await bookCommentButton.click();
  await expect(page.locator('.commentary-detail-overlay.open')).toBeVisible();
  await expect(page.locator('.commentary-detail-table tbody tr').first()).toBeVisible();
  await expect(page.locator('#commentaryDetailPagination')).toBeVisible();
  await expect(page.locator('#commentaryDetailTotalInfo')).toContainText('comments');
  // Sorting by commentator re-orders without breaking pagination
  await page.locator('.commentary-detail-table th[data-key="commentator"]').click();
  await expect(page.locator('.commentary-detail-table th[data-key="commentator"]')).toHaveClass(/sorted-asc/);
  await page.locator('.commentary-detail-close').click();

  // Section-level counts aggregate every book in the section
  await page.selectOption('#gran', 'genre');
  const sectionCommentButton = page.locator('#results tbody .commentary-count-link').first();
  await expect(sectionCommentButton).toBeVisible();
  await sectionCommentButton.click();
  await expect(page.locator('.commentary-detail-overlay.open')).toBeVisible();
  await expect(page.locator('.commentary-detail-table tbody tr').first()).toBeVisible({ timeout: 20000 });
  await page.locator('.commentary-detail-close').click();
  await page.selectOption('#gran', 'line');

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
