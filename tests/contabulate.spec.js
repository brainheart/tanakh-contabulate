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

  // Word & phrase columns: add a term column at Verse granularity
  await page.fill('#q', 'אלהים');
  await page.locator('#addColumnBtn').click();
  await page.waitForSelector('#results tbody tr');
  const termHeaders = await page.locator('#results thead th').allTextContents();
  expect(termHeaders.some((text) => text.includes('אלהים'))).toBeTruthy();
  expect(termHeaders.some((text) => text.includes('Verse'))).toBeTruthy();
  await expect(page.locator('#results tbody')).toContainText('אֱלֹהִ');
});

test('count cells drill down through the granularities', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__contabulateReady === true);

  // Books → the 50 chapters of Genesis
  await page.locator('#results tbody tr').first().locator('button.drill-link').first().click();
  await expect(page.locator('#gran')).toHaveValue('act');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(50 total rows)');
  await expect(page.locator('#segmentsFiltersInfo')).toContainText('1 active filter');

  // Chapters → the 31 verses of Genesis 1
  await page.locator('#results tbody tr').first().locator('button.drill-link').first().click();
  await expect(page.locator('#gran')).toHaveValue('line');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(31 total rows)', { timeout: 15000 });

  // Sections gain a # chapters column and drill to the Book view
  await page.selectOption('#gran', 'genre');
  await expect(page.locator('#results thead th[data-key="num_chapters"]')).toHaveCount(1);
  await page.locator('#results tbody tr', { hasText: 'תורה' }).first().locator('button.drill-link').first().click();
  await expect(page.locator('#gran')).toHaveValue('play');
  await expect(page.locator('#results tbody tr')).toHaveCount(5);

  // The words/bigrams/trigrams count opens the words & phrases modal
  await page.locator('#results tbody tr').first().locator('.play-detail-link.drill-link').click();
  await expect(page.locator('.play-detail-overlay.open')).toBeVisible();
  await expect(page.locator('.play-detail-kicker')).toContainText('Words & phrases');
  await page.locator('.play-detail-close').click();
});

test('address bar tracks state and browser Back walks the drill trail', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__contabulateReady === true);
  await expect(page.locator('#results tbody tr')).toHaveCount(39);

  // Drill books → chapters → verses
  await page.locator('#results tbody tr').first().locator('button.drill-link').first().click();
  await expect(page.locator('#gran')).toHaveValue('act');
  await page.waitForFunction(() => location.search.includes('gran=act'));
  await page.locator('#results tbody tr').first().locator('button.drill-link').first().click();
  await expect(page.locator('#gran')).toHaveValue('line');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(31 total rows)', { timeout: 15000 });

  // Back un-drills, step by step
  await page.goBack();
  await expect(page.locator('#gran')).toHaveValue('act');
  await expect(page.locator('#segmentsTotalInfo')).toContainText('(50 total rows)');
  await page.goBack();
  await expect(page.locator('#gran')).toHaveValue('play');
  await expect(page.locator('#results tbody tr')).toHaveCount(39);

  // Opening the commentary modal pushes history; Back closes it
  await page.locator('#results tbody .commentary-count-link').first().click();
  await expect(page.locator('.commentary-detail-overlay.open')).toBeVisible();
  await page.waitForFunction(() => location.search.includes('cm='));
  await page.goBack();
  await expect(page.locator('.commentary-detail-overlay.open')).toBeHidden();
});

test('book ngram modal lists configured names and supports editing', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__contabulateReady === true);
  await page.locator('#results .play-detail-link', { hasText: 'Ruth' }).click();
  await page.waitForSelector('#playDetailTable:not(.is-hidden)', { timeout: 30000 });

  await expect(page.locator('.excluded-terms-details summary')).toContainText('Filtering 50 terms');
  await page.locator('.excluded-terms-details summary').click();
  await expect(page.locator('.excluded-term-chip', { hasText: 'בעז' }).first()).toBeVisible();

  // Exclude the top n-gram from the row button; it disappears and persists
  const firstNgram = (await page.locator('#playDetailTableBody tr td:nth-child(2) span').first().textContent()).trim();
  await page.locator('#playDetailTableBody .ngram-exclude-btn').first().click();
  const topAfter = await page.locator('#playDetailTableBody tr td:nth-child(2) span').allTextContents();
  expect(topAfter.map(t => t.trim())).not.toContain(firstNgram);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tanakhNameFilterOverrides')));
  expect(stored.Ruth.added).toContain(firstNgram);

  // Reset restores the built-in list
  await page.locator('.excluded-terms-reset').click();
  await expect(page.locator('.excluded-terms-details summary')).toContainText('Filtering 50 terms');
  await page.locator('.play-detail-close').click();
});

test('opens the commentary modal from a cm deep link', async ({ page }) => {
  await page.goto('/?cm=Gen.1.1~rashi');
  await page.waitForFunction(() => window.__contabulateReady === true);
  await expect(page.locator('.commentary-detail-overlay.open')).toBeVisible();
  await expect(page.locator('#commentaryDetailTitle')).toContainText('Rashi');
  await expect(page.locator('.commentary-detail-table tbody tr').first()).toBeVisible();
  await page.locator('.commentary-detail-close').click();
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
