// The reading aids for people without the corpus language: the English lookup
// and the gloss and dictionary-form columns of the word views. The module is
// shared by the non-English instances; the facts in CFG belong to this one.
const { test, expect } = require('@playwright/test');
const glossary = require('../docs/data/glossary.json');
const tokens = require('../docs/data/tokens.json');

const CFG = {
  label: 'Find a Hebrew word by its English meaning:',
  query: 'peace',
  first: { lemma: 'שָׁלוֹם', meaning: 'completeness; safe, well, happy', meta: 'noun · 237× in 21 forms', hits: 298 },
  second: { lemma: 'שָׁלַם', meaning: 'be in covenant of peace; be safe, be, make' },
  form: { query: 'king', lemma: 'מֶ֫לֶךְ', text: 'המלך' },
  reverse: { typed: 'בְּרֵאשִׁית', lemma: 'רֵאשִׁית', meaning: 'beginning; first, firstfruit' },
  long: 'say',
  wordRow: { word: 'בראשית', gloss: 'beginning; first, firstfruit', lemma: 'רֵאשִׁית' },
  phraseRow: { gran: 'bigram', gloss: /·/ },
  glossFilter: 'peace',
  lang: 'he',
  roots: { query: 'peace', hits: 849 }, // every word filed under the root sh-l-m
};

const total = word => (tokens[word] || []).reduce((sum, [, n]) => sum + n, 0);
const nfc = text => String(text).normalize('NFC');
// Pointed literals typed here may order their marks differently from the data.
const lemma = text => glossary.lemmas.find(e => nfc(e.lemma) === nfc(text));

async function ready(page, url = '/') {
  await page.goto(url);
  await page.waitForFunction(() => window.__contabulateReady === true);
  await expect(page.locator('#results tbody tr').first()).toBeVisible();
}

async function hitTotal(page) {
  // The pager is hidden when the result fits on one page.
  if (await page.locator('#segmentsPageSize').isVisible()) await page.selectOption('#segmentsPageSize', '250');
  const counts = await page.locator('td[data-key="t0_count"]').allTextContents();
  return counts.map(t => Number(t.replace(/,/g, ''))).reduce((a, b) => a + b, 0);
}

test('an English word finds dictionary forms and inserts all their spellings', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  await expect(page.locator('#lexicon')).toBeVisible();
  await expect(page.locator('#lexicon label')).toHaveText(CFG.label);
  await page.fill('#lexiconInput', CFG.query);
  const first = page.locator('.lexicon-item').first();
  await expect(first.locator('.lexicon-lemma')).toHaveText(lemma(CFG.first.lemma).lemma);
  await expect(first.locator('.lexicon-lemma')).toHaveAttribute('lang', CFG.lang);
  await expect(first.locator('.lexicon-meaning')).toHaveText(CFG.first.meaning);
  await expect(first.locator('.lexicon-meta')).toContainText(CFG.first.meta);
  await expect(page.locator('.lexicon-item').nth(1).locator('.lexicon-lemma')).toHaveText(lemma(CFG.second.lemma).lemma);
  await expect(page.locator('.lexicon-item').nth(1).locator('.lexicon-meaning')).toHaveText(CFG.second.meaning);

  await first.locator('.lexicon-insert').click();
  await expect(page.locator('#lexiconResults')).toBeHidden();
  await expect(page.locator('#matchMode')).toHaveValue('regex');
  await expect(page.locator('#q')).toBeFocused();
  const pattern = await page.inputValue('#q');
  const matched = Object.keys(tokens).filter(w => new RegExp(pattern, 'iu').test(w));
  expect(matched.sort()).toEqual(lemma(CFG.first.lemma).forms.map(f => f[0]).sort());

  await page.click('#addColumnBtn');
  await expect(page.locator('th[data-key="t0_count"]')).toBeVisible();
  expect(await hitTotal(page)).toBe(matched.reduce((sum, w) => sum + total(w), 0));
  expect(await hitTotal(page)).toBe(CFG.first.hits);
  // The inserted term survives a reload as an ordinary deep link.
  await page.reload();
  await page.waitForFunction(() => window.__contabulateReady === true);
  await expect(page.locator('th[data-key="t0_count"]')).toBeVisible();
  expect(await hitTotal(page)).toBe(CFG.first.hits);
  expect(errors).toEqual([]);
});

test('a single written form can be inserted, and Enter takes the first suggestion', async ({ page }) => {
  await ready(page);
  await page.fill('#lexiconInput', CFG.form.query);
  const first = page.locator('.lexicon-item').first();
  await expect(first.locator('.lexicon-lemma')).toHaveText(lemma(CFG.form.lemma).lemma);
  await first.locator('.lexicon-form', { hasText: CFG.form.text }).first().click();
  await expect(page.locator('#matchMode')).toHaveValue('exact');
  await expect(page.locator('#q')).toHaveValue(CFG.form.text);
  await page.click('#addColumnBtn');
  await expect(page.locator('th[data-key="t0_count"]')).toBeVisible();
  expect(await hitTotal(page)).toBe(total(CFG.form.text));
  if (CFG.roots) {
    await page.fill('#lexiconInput', CFG.roots.query);
    // The list refreshes a moment after typing: wait for this query's answer.
    await expect(page.locator('.lexicon-item').first().locator('.lexicon-lemma')).toHaveText(lemma(CFG.first.lemma).lemma);
    await page.locator('.lexicon-item').first().locator('.lexicon-root').click();
    await expect(page.locator('#matchMode')).toHaveValue('regex');
    await page.click('#addColumnBtn');
    await expect(page.locator('th[data-key="t1_count"]')).toBeVisible();
    await page.locator('th[data-key="t0_count"] .term-col-remove').click();
    expect(await hitTotal(page)).toBe(CFG.roots.hits);
    await ready(page);
  } else {
    await page.fill('#lexiconInput', CFG.query);
    await expect(page.locator('.lexicon-item').first()).toBeVisible();
    await expect(page.locator('.lexicon-root')).toHaveCount(0); // shown only where the data has roots
  }

  await page.fill('#lexiconInput', CFG.query);
  await expect(page.locator('.lexicon-item').first().locator('.lexicon-lemma')).toHaveText(lemma(CFG.first.lemma).lemma);
  await page.press('#lexiconInput', 'Enter');
  const pattern = await page.inputValue('#q');
  expect(Object.keys(tokens).filter(w => new RegExp(pattern, 'iu').test(w)).sort())
    .toEqual(lemma(CFG.first.lemma).forms.map(f => f[0]).sort());
});

test('the lookup also explains a word of the text, and says so when it finds nothing', async ({ page }) => {
  await ready(page);
  await page.fill('#lexiconInput', CFG.reverse.typed);
  const explained = page.locator('.lexicon-item').first();
  await expect(explained.locator('.lexicon-lemma')).toHaveText(lemma(CFG.reverse.lemma).lemma);
  await expect(explained.locator('.lexicon-meaning')).toHaveText(CFG.reverse.meaning);
  await page.fill('#lexiconInput', 'zzzz');
  await expect(page.locator('#lexiconResults')).toContainText('No word in this text is glossed with that');
  await page.fill('#lexiconInput', '');
  await expect(page.locator('#lexiconResults')).toBeHidden();
  await page.fill('#lexiconInput', CFG.query);
  await expect(page.locator('.lexicon-item').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#lexiconResults')).toBeHidden();
});

test('every generated pattern matches exactly the written forms of its dictionary form', async ({ page }) => {
  await ready(page);
  const report = await page.evaluate(async () => {
    const [g, tokens] = await Promise.all([fetch('data/glossary.json').then(r => r.json()), fetch('data/tokens.json').then(r => r.json())]);
    const vocabulary = Object.keys(tokens);
    let inexact = 0;
    for (const entry of g.lemmas) {
      const forms = entry.forms.map(f => f[0]);
      const re = new RegExp(window.contabulateGlossary.buildFormsRegex(forms), 'iu');
      const hits = vocabulary.filter(w => re.test(w));
      if (hits.length !== forms.length || !forms.every(f => re.test(f))) inexact++;
    }
    return { lemmas: g.lemmas.length, inexact };
  });
  expect(report.lemmas).toBe(glossary.lemmas.length);
  expect(report.inexact).toBe(0);
});

test('a long inserted pattern keeps the header row low until expanded', async ({ page }) => {
  await ready(page);
  const plainHeight = (await page.locator('#results thead tr').boundingBox()).height;
  await page.fill('#lexiconInput', CFG.long);
  await page.locator('.lexicon-item').first().locator('.lexicon-insert').click();
  const pattern = await page.inputValue('#q');
  expect(pattern.length).toBeGreaterThan(100);
  await page.click('#addColumnBtn');
  const th = page.locator('th[data-key="t0_count"]');
  await expect(th).toBeVisible();
  const toggle = th.locator('.term-col-expand');
  await expect(th.locator('.th-label')).toHaveText(`# /${pattern}/`);
  expect((await th.getAttribute('title')).startsWith(`# /${pattern}/`)).toBeTruthy();
  await expect(toggle).toHaveText('more');
  const collapsed = (await page.locator('#results thead tr').boundingBox()).height;
  expect(collapsed).toBeLessThan(plainHeight + 30);
  await toggle.click();
  await expect(toggle).toHaveText('less');
  await expect(th).toHaveClass(/sorted-desc/); // expanding does not sort
  expect((await page.locator('#results thead tr').boundingBox()).height).toBeGreaterThan(collapsed + 20);
  await toggle.click();
  expect((await page.locator('#results thead tr').boundingBox()).height).toBeLessThan(plainHeight + 30);
});

test('word views show an English gloss and dictionary form', async ({ page }) => {
  await ready(page, '/?gran=word');
  const headers = await page.locator('#results thead th').allTextContents();
  for (const label of ['English (word by word)', 'Dictionary form']) {
    expect(headers.some(t => t.includes(label))).toBeTruthy();
  }
  expect(headers.some(t => t.includes('Root'))).toBe(!!CFG.roots);
  await ready(page, '/?gran=word&s_ft_ngram=' + encodeURIComponent(`^${CFG.wordRow.word}$`));
  const row = page.locator('#results tbody tr').first();
  await expect(row.locator('td[data-key="ngram"]')).toContainText(CFG.wordRow.word);
  await expect(row.locator('td[data-key="gloss"]')).toHaveText(CFG.wordRow.gloss);
  await expect(row.locator('td[data-key="lemma"]')).toHaveText(lemma(CFG.wordRow.lemma).lemma);
  await expect(row.locator('td[data-key="lemma"]')).toHaveAttribute('lang', CFG.lang);
  // The gloss column is a plain text column: it filters.
  await ready(page, '/?gran=word&s_ft_gloss=' + encodeURIComponent('\\b' + CFG.glossFilter));
  const glosses = await page.locator('td[data-key="gloss"]').allTextContents();
  expect(glosses.length).toBeGreaterThan(5);
  expect(glosses.every(t => new RegExp(CFG.glossFilter, 'i').test(t))).toBeTruthy();
  await ready(page, `/?gran=${CFG.phraseRow.gran}`);
  await expect(page.locator('#results tbody tr').first().locator('td[data-key="gloss"]')).toHaveText(CFG.phraseRow.gloss);
  await expect(page.locator('#results thead th[data-key="lemma"]')).toHaveCount(0);
});

test('the explorer works without the glossary file', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/data/glossary.json', route => route.fulfill({ status: 404, body: 'Not found' }));
  await ready(page, '/?gran=word');
  await expect(page.locator('#lexicon')).toBeHidden();
  await expect(page.locator('#results thead th[data-key="gloss"]')).toHaveCount(0);
  await expect(page.locator('#results thead th[data-key="ngram"]')).toHaveCount(1);
  await ready(page, '/?q=' + encodeURIComponent(CFG.form.text) + '&gran=line');
  await expect(page.locator('#results tbody .hit').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('the lookup fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.fill('#lexiconInput', CFG.query);
  await expect(page.locator('.lexicon-item').first()).toBeVisible();
  const bounds = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(bounds.page).toBeLessThanOrEqual(bounds.viewport + 1);
});
