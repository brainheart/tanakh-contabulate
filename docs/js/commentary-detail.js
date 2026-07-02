// Commentary detail modal — lazy-loads generated per-book comment records.

(function () {
  'use strict';

  let playsById = new Map();
  let playsList = [];
  let commentaryConfig = null;
  let escapeHTML = window.escapeHTML || (s => String(s ?? ''));
  let commentatorByKey = new Map();
  let bookOrder = new Map();
  let bookEnglishNames = new Map();

  const bookCache = new Map();
  const textCache = new Map();
  // Sefaria hosts multi-book works (e.g. "Siftei Chakhamim") as complex texts
  // whose refs need a book node ("Siftei Chakhamim, Genesis"). Remember which
  // ref shape worked per (source, book) so later fetches skip the failed probe.
  const sourceRefModes = new Map();

  const MAX_TEXT_FETCHES = 6;
  let activeTextFetches = 0;
  const textFetchQueue = [];

  const COLUMNS = [
    { key: 'ref', label: 'Verse', sortable: true, defaultDir: 'asc' },
    { key: 'commentator', label: 'Commentator', sortable: true, defaultDir: 'asc' },
    { key: 'work', label: 'Work', sortable: true, defaultDir: 'asc' },
    { key: 'comment', label: 'Comment', sortable: false },
    { key: 'link', label: 'Source', sortable: false }
  ];

  const state = {
    comments: [],
    sorted: false,
    title: '',
    meta: '',
    page: 1,
    pageSize: 50,
    sortKey: 'ref',
    sortDir: 'asc',
    renderToken: 0
  };
  let els = null;

  function getDetailPathTemplate() {
    const metadata = commentaryConfig && commentaryConfig.metadata;
    return (metadata && metadata.detail_path_template) || 'commentary/{book}.json';
  }

  function isCommentaryDetailCell(columnKey) {
    return columnKey === 'commentary_interest'
      || (typeof columnKey === 'string'
        && columnKey.startsWith('commentary_')
        && columnKey !== 'commentary_per_verse');
  }

  function getCommentatorKey(columnKey) {
    if (!columnKey || columnKey === 'commentary_interest') return '';
    return String(columnKey).replace(/^commentary_/, '');
  }

  function parseCanonicalId(value) {
    const parts = String(value || '').split('.');
    if (parts.length < 3) return null;
    const chapter = Number.parseInt(parts[1], 10);
    const verse = Number.parseInt(parts[2], 10);
    if (!parts[0] || !Number.isFinite(chapter) || !Number.isFinite(verse)) return null;
    return { book: parts[0], chapter, verse };
  }

  function bookForRow(row) {
    if (!row) return '';
    const parsed = parseCanonicalId(row.id || row.canonical_id);
    if (parsed) return parsed.book;
    const idParts = String(row.id || '').split('.');
    if (idParts.length === 2 && idParts[0] && /^\d+$/.test(idParts[1])) {
      return idParts[0];
    }
    if (row.play_abbr) return String(row.play_abbr);
    // Location strings look like "01.01.Gen" or "01.01.Gen.001"; the book
    // abbreviation is the only non-numeric part.
    const locAbbr = String(row.location || '').split('.').find(part => part && !/^\d+$/.test(part));
    if (locAbbr) return locAbbr;
    const play = playsById && typeof playsById.get === 'function' ? playsById.get(row.play_id) : null;
    return play && play.abbr ? String(play.abbr) : '';
  }

  function playTitleForRow(row, book) {
    if (!row) return book || '';
    if (row.play_title) return String(row.play_title);
    if (row.title) return String(row.title);
    const play = playsById && typeof playsById.get === 'function' ? playsById.get(row.play_id) : null;
    return play && play.title ? String(play.title) : (book || '');
  }

  // Infer the scope from the row's shape rather than the granularity select —
  // the app can show book rows while the select still says Verse (default view).
  function scopeForRow(row) {
    if (!row) return null;

    const parsed = parseCanonicalId(row.id || row.canonical_id);
    if (parsed) {
      return {
        genre: '',
        book: parsed.book,
        chapter: parsed.chapter,
        verse: parsed.verse,
        label: `${playTitleForRow(row, parsed.book)} ${parsed.chapter}:${parsed.verse}`
      };
    }

    const book = bookForRow(row);
    if (book) {
      const chapter = Number.parseInt(row.act, 10);
      if (Number.isFinite(chapter)) {
        return {
          genre: '',
          book,
          chapter,
          verse: null,
          label: `${playTitleForRow(row, book)} ${chapter}`
        };
      }
      return { genre: '', book, chapter: null, verse: null, label: playTitleForRow(row, book) };
    }

    if (row.genre) {
      const genre = String(row.genre);
      return { genre, book: '', chapter: null, verse: null, label: genre };
    }

    return null;
  }

  function buildCommentaryDetailLink(value, row, granularity, columnKey) {
    const count = Number(value) || 0;
    const scope = scopeForRow(row);
    if (!count || !scope) {
      const span = document.createElement('span');
      span.textContent = value == null ? '' : String(value);
      return span;
    }

    const commentatorKey = getCommentatorKey(columnKey);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'commentary-count-link';
    btn.textContent = String(value);
    if (scope.genre) btn.dataset.genre = scope.genre;
    if (scope.book) btn.dataset.book = scope.book;
    if (scope.chapter != null) btn.dataset.chapter = String(scope.chapter);
    if (scope.verse != null) btn.dataset.verse = String(scope.verse);
    btn.dataset.count = String(count);
    btn.dataset.scopeLabel = scope.label;
    btn.dataset.commentatorKey = commentatorKey;
    if (commentatorKey && commentatorByKey.has(commentatorKey)) {
      btn.dataset.commentatorLabel = commentatorByKey.get(commentatorKey).label;
    }
    btn.title = commentatorKey
      ? `Show ${btn.dataset.commentatorLabel || commentatorKey} comments`
      : 'Show commentary comments';
    return btn;
  }

  function ensureModal() {
    if (els) return els;
    const overlay = document.createElement('div');
    overlay.className = 'commentary-detail-overlay';
    const headerCells = COLUMNS.map((col) => {
      const cls = col.sortable ? ' class="commentary-detail-sortable"' : ' class="commentary-detail-unsortable"';
      return `<th data-key="${col.key}"${cls} ${col.sortable ? 'title="Click to sort"' : ''}>${escapeHTML(col.label)}</th>`;
    }).join('');
    overlay.innerHTML = `
      <div class="commentary-detail-modal" role="dialog" aria-modal="true" aria-label="Commentary comments">
        <div class="commentary-detail-head">
          <button type="button" class="commentary-detail-close" aria-label="Close">×</button>
          <h3 id="commentaryDetailTitle"></h3>
          <div class="commentary-detail-meta" id="commentaryDetailMeta"></div>
        </div>
        <div class="commentary-detail-body">
          <div class="commentary-detail-loading" id="commentaryDetailLoading">Loading comments...</div>
          <table class="commentary-detail-table is-hidden" id="commentaryDetailTable">
            <thead><tr>${headerCells}</tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="commentary-detail-pagination pagination is-hidden" id="commentaryDetailPagination">
          <button type="button" id="commentaryDetailFirst">First</button>
          <button type="button" id="commentaryDetailPrev">Prev</button>
          <span class="page-info" id="commentaryDetailPageInfo">Page 1 of 1</span>
          <button type="button" id="commentaryDetailNext">Next</button>
          <button type="button" id="commentaryDetailLast">Last</button>
          <label>
            Rows per page:
            <select id="commentaryDetailPageSize">
              <option value="25">25</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
              <option value="250">250</option>
            </select>
          </label>
          <span class="page-info" id="commentaryDetailTotalInfo"></span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    els = {
      overlay,
      body: overlay.querySelector('.commentary-detail-body'),
      title: overlay.querySelector('#commentaryDetailTitle'),
      meta: overlay.querySelector('#commentaryDetailMeta'),
      loading: overlay.querySelector('#commentaryDetailLoading'),
      table: overlay.querySelector('#commentaryDetailTable'),
      tbody: overlay.querySelector('#commentaryDetailTable tbody'),
      headRow: overlay.querySelector('#commentaryDetailTable thead tr'),
      pagination: overlay.querySelector('#commentaryDetailPagination'),
      first: overlay.querySelector('#commentaryDetailFirst'),
      prev: overlay.querySelector('#commentaryDetailPrev'),
      next: overlay.querySelector('#commentaryDetailNext'),
      last: overlay.querySelector('#commentaryDetailLast'),
      pageInfo: overlay.querySelector('#commentaryDetailPageInfo'),
      totalInfo: overlay.querySelector('#commentaryDetailTotalInfo'),
      pageSize: overlay.querySelector('#commentaryDetailPageSize')
    };

    overlay.querySelector('.commentary-detail-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    els.headRow.addEventListener('click', (e) => {
      const th = e.target && typeof e.target.closest === 'function' ? e.target.closest('th') : null;
      if (!th || !els.headRow.contains(th)) return;
      const col = COLUMNS.find(c => c.key === th.dataset.key);
      if (!col || !col.sortable) return;
      if (state.sortKey === col.key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = col.key;
        state.sortDir = col.defaultDir || 'asc';
      }
      state.sorted = false;
      state.page = 1;
      renderComments();
    });
    const goToPage = (page) => {
      const totalPages = window.getTotalPages(state.comments.length, state.pageSize);
      const next = Math.max(1, Math.min(page, totalPages));
      if (next === state.page) return;
      state.page = next;
      renderComments();
    };
    els.first.addEventListener('click', () => goToPage(1));
    els.prev.addEventListener('click', () => goToPage(state.page - 1));
    els.next.addEventListener('click', () => goToPage(state.page + 1));
    els.last.addEventListener('click', () => goToPage(Number.MAX_SAFE_INTEGER));
    els.pageSize.addEventListener('change', (e) => {
      state.pageSize = Number.parseInt(e.target.value, 10) || 50;
      state.page = 1;
      renderComments();
    });

    return els;
  }

  function closeModal() {
    if (els) els.overlay.classList.remove('open');
    state.renderToken++;
    textFetchQueue.length = 0;
  }

  function setLoading(message) {
    const modal = ensureModal();
    modal.loading.textContent = message || 'Loading comments...';
    modal.loading.classList.remove('is-hidden');
    modal.table.classList.add('is-hidden');
    modal.tbody.innerHTML = '';
    modal.pagination.classList.add('is-hidden');
  }

  async function loadBook(book) {
    if (bookCache.has(book)) return bookCache.get(book);
    const path = getDetailPathTemplate().replace('{book}', encodeURIComponent(book));
    const promise = fetch(path).then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
      return res.json();
    });
    bookCache.set(book, promise);
    return promise;
  }

  function booksForScope(scope) {
    if (scope.genre) {
      return playsList
        .filter(play => String(play.genre || '') === scope.genre && play.abbr)
        .map(play => String(play.abbr));
    }
    return scope.book ? [scope.book] : [];
  }

  function sectionsToRefText(sections) {
    const nums = Array.isArray(sections) ? sections.filter(n => Number.isFinite(Number(n))) : [];
    return nums.join(':');
  }

  function sefariaPathFromTitle(title) {
    return encodeURIComponent(String(title || '').replace(/\s+/g, '_'));
  }

  function sourcePath(source) {
    return (source && source.sefaria_path) || sefariaPathFromTitle(source && source.title);
  }

  function buildSefariaUrl(source, sections) {
    if (!source) return '';
    const suffix = (Array.isArray(sections) && sections.length) ? `.${sections.join('.')}` : '';
    return `https://www.sefaria.org/${sourcePath(source)}${suffix}?lang=bi`;
  }

  function stripHTML(text) {
    return String(text || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function decodeEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(text || '');
    return textarea.value;
  }

  function cleanApiText(text) {
    return decodeEntities(stripHTML(text));
  }

  function pickApiText(payload, source) {
    if (!payload || typeof payload !== 'object') return '';
    const wantsHebrew = String(source && source.language || '').toLowerCase() === 'hebrew';
    const primary = wantsHebrew ? payload.he : payload.text;
    const fallback = wantsHebrew ? payload.text : payload.he;
    const value = primary || fallback || '';
    if (Array.isArray(value)) return cleanApiText(value.flat(Infinity).filter(Boolean).join(' '));
    return cleanApiText(value);
  }

  function sourceModeKey(comment) {
    const source = comment.source || {};
    return `${source.source_url || source.title || ''}::${comment.book}`;
  }

  // Sefaria names split books with Roman numerals ("II Samuel"), while the
  // plays data may say "Samuel 1" or "1 Samuel" — generate all spellings.
  function bookNameVariants(book) {
    const english = bookEnglishNames.get(book) || '';
    if (!english) return [];
    const variants = [english];
    const leading = /^([12]) (.+)$/.exec(english);
    if (leading) variants.push(`${leading[1] === '1' ? 'I' : 'II'} ${leading[2]}`);
    const trailing = /^(.+?) ([12])$/.exec(english);
    if (trailing) variants.push(`${trailing[2] === '1' ? 'I' : 'II'} ${trailing[1]}`);
    return variants;
  }

  function candidatePaths(comment) {
    const source = comment.source || {};
    const base = sourcePath(source);
    const nodeNames = bookNameVariants(comment.book);
    const nodePaths = nodeNames.map(name => `${base},_${name.replace(/\s+/g, '_')}`);
    const titleLower = String(source.title || '').toLowerCase();
    const titleHasBook = nodeNames.some(name => titleLower.includes(name.toLowerCase()));
    const ordered = titleHasBook ? [base, ...nodePaths] : [...nodePaths, base];
    const learned = sourceRefModes.get(sourceModeKey(comment));
    if (learned) {
      const idx = ordered.indexOf(learned);
      if (idx > 0) ordered.splice(idx, 1);
      if (idx !== 0) ordered.unshift(learned);
    }
    return [...new Set(ordered.filter(Boolean))];
  }

  function fetchSegment(path, sections) {
    const url = `https://www.sefaria.org/api/texts/${path}.${sections.join('.')}?context=0&commentary=0&pad=0`;
    return fetch(url)
      .then(res => (res.ok ? res.json() : null))
      .then(payload => (payload && !payload.error ? payload : null))
      .catch(() => null);
  }

  function resolveComment(comment) {
    const source = comment.source || {};
    if (comment.text) {
      return Promise.resolve({ text: comment.text, url: buildSefariaUrl(source, comment.sections) });
    }
    const sections = Array.isArray(comment.sections) ? comment.sections : [];
    if (!sections.length) return Promise.resolve(null);
    const cacheKey = `${sourceModeKey(comment)}::${sections.join('.')}`;
    if (!textCache.has(cacheKey)) {
      textCache.set(cacheKey, (async () => {
        for (const path of candidatePaths(comment)) {
          const payload = await fetchSegment(path, sections);
          if (!payload) continue;
          sourceRefModes.set(sourceModeKey(comment), path);
          const ref = typeof payload.ref === 'string' ? payload.ref : '';
          // "Abarbanel on Torah, Genesis 1:1:2" → "Abarbanel_on_Torah,_Genesis.1.1.2"
          const refPath = ref
            .replace(/ (\d+(?::\d+)*)$/, (m, nums) => `.${nums.replace(/:/g, '.')}`)
            .replace(/ /g, '_');
          return {
            text: pickApiText(payload, source),
            url: refPath
              ? `https://www.sefaria.org/${encodeURI(refPath)}?lang=bi`
              : buildSefariaUrl(source, sections)
          };
        }
        return null;
      })());
    }
    return textCache.get(cacheKey);
  }

  function pumpTextQueue() {
    while (activeTextFetches < MAX_TEXT_FETCHES && textFetchQueue.length) {
      const task = textFetchQueue.shift();
      if (task.token !== state.renderToken || !task.el.isConnected) continue;
      activeTextFetches += 1;
      task.run().catch(() => {}).finally(() => {
        activeTextFetches -= 1;
        pumpTextQueue();
      });
    }
  }

  function applyPreviewText(el, text) {
    el.classList.remove('commentary-preview-loading');
    el.textContent = text;
    if (typeof window.applyDirectionalText === 'function') {
      window.applyDirectionalText(el, { mixed: true });
    } else if (window.containsHebrew && window.containsHebrew(text)) {
      el.classList.add('hebrew-mixed');
    }
    if (el.scrollHeight > el.clientHeight + 1) {
      el.classList.add('is-expandable');
      el.title = 'Click to expand';
    }
  }

  function markPreviewUnavailable(el) {
    el.classList.remove('commentary-preview-loading');
    el.classList.add('commentary-preview-unavailable');
    el.textContent = 'Preview unavailable — open the source link for the full comment.';
  }

  function loadCommentTextInto(comment, previewEl, linkEl) {
    if (comment.text) {
      applyPreviewText(previewEl, comment.text);
      return;
    }
    previewEl.classList.add('commentary-preview-loading');
    previewEl.textContent = 'Loading…';
    textFetchQueue.push({
      token: state.renderToken,
      el: previewEl,
      run: () => resolveComment(comment).then((resolved) => {
        if (!previewEl.isConnected) return;
        if (!resolved || !resolved.text) {
          markPreviewUnavailable(previewEl);
          if (linkEl) {
            // The guessed segment ref did not resolve; link to the work's
            // table of contents instead of a dead deep link.
            linkEl.href = resolved && resolved.url
              ? resolved.url
              : `https://www.sefaria.org/${sourcePath(comment.source)}?lang=bi`;
          }
          return;
        }
        applyPreviewText(previewEl, resolved.text);
        if (resolved.url && linkEl) linkEl.href = resolved.url;
      })
    });
    pumpTextQueue();
  }

  function normalizeRecord(record) {
    if (Array.isArray(record)) {
      return {
        sourceIndex: Number(record[0]),
        sections: Array.isArray(record[1]) ? record[1] : [],
        text: record.length > 2 ? String(record[2] || '') : ''
      };
    }
    return {
      sourceIndex: Number(record && record.s),
      sections: Array.isArray(record && record.r) ? record.r : [],
      text: record && record.text ? String(record.text) : ''
    };
  }

  function collectComments(bookDataList, scope, commentatorKey) {
    const comments = [];
    bookDataList.forEach((bookData) => {
      if (!bookData) return;
      const sources = Array.isArray(bookData.sources) ? bookData.sources : [];
      const verses = bookData.verses && typeof bookData.verses === 'object' ? bookData.verses : {};
      Object.keys(verses).forEach((canonicalId) => {
        const parsed = parseCanonicalId(canonicalId);
        if (!parsed) return;
        if (scope.book && parsed.book !== scope.book) return;
        if (scope.chapter != null && parsed.chapter !== scope.chapter) return;
        if (scope.verse != null && parsed.verse !== scope.verse) return;
        const records = Array.isArray(verses[canonicalId]) ? verses[canonicalId] : [];
        records.forEach((record) => {
          const normalized = normalizeRecord(record);
          const source = sources[normalized.sourceIndex];
          if (!source) return;
          if (commentatorKey && source.key !== commentatorKey) return;
          comments.push({
            canonicalId,
            book: parsed.book,
            chapter: parsed.chapter,
            verse: parsed.verse,
            bookIdx: bookOrder.has(parsed.book) ? bookOrder.get(parsed.book) : 999,
            commentatorLower: String(source.commentator || '').toLowerCase(),
            workLower: String(source.title || '').toLowerCase(),
            source,
            sections: normalized.sections,
            text: normalized.text
          });
        });
      });
    });
    return comments;
  }

  function compareSections(a, b) {
    const al = Array.isArray(a) ? a : [];
    const bl = Array.isArray(b) ? b : [];
    const len = Math.max(al.length, bl.length);
    for (let i = 0; i < len; i++) {
      const av = Number(al[i]) || 0;
      const bv = Number(bl[i]) || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  function compareRefs(a, b) {
    return (a.bookIdx - b.bookIdx)
      || (a.chapter - b.chapter)
      || (a.verse - b.verse)
      || (a.workLower < b.workLower ? -1 : a.workLower > b.workLower ? 1 : 0)
      || compareSections(a.sections, b.sections);
  }

  function compareText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function sortComments() {
    if (state.sorted) return;
    const dir = state.sortDir === 'desc' ? -1 : 1;
    let cmp = compareRefs;
    if (state.sortKey === 'commentator') {
      cmp = (a, b) => compareText(a.commentatorLower, b.commentatorLower) || compareRefs(a, b);
    } else if (state.sortKey === 'work') {
      cmp = (a, b) => compareText(a.workLower, b.workLower) || compareRefs(a, b);
    }
    state.comments.sort((a, b) => dir * cmp(a, b));
    state.sorted = true;
  }

  function updateSortIndicators() {
    if (!els) return;
    els.headRow.querySelectorAll('th').forEach((th) => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.key === state.sortKey) {
        th.classList.add(state.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    });
  }

  function renderComments() {
    const modal = ensureModal();
    modal.title.textContent = state.title;
    modal.meta.textContent = state.meta;
    modal.loading.classList.add('is-hidden');
    modal.tbody.innerHTML = '';
    state.renderToken++;
    textFetchQueue.length = 0;

    if (!state.comments.length) {
      modal.loading.textContent = 'No commentary details are available for this count.';
      modal.loading.classList.remove('is-hidden');
      modal.table.classList.add('is-hidden');
      modal.pagination.classList.add('is-hidden');
      return;
    }

    sortComments();
    updateSortIndicators();
    modal.table.classList.remove('is-hidden');

    const totalPages = window.getTotalPages(state.comments.length, state.pageSize);
    state.page = Math.max(1, Math.min(state.page, totalPages));
    const rows = window.paginateArray(state.comments, state.page, state.pageSize);
    const fragment = document.createDocumentFragment();
    const pendingTextLoads = [];

    rows.forEach((comment) => {
      const tr = document.createElement('tr');

      const tdRef = document.createElement('td');
      tdRef.className = 'commentary-ref-cell';
      tdRef.textContent = `${comment.book} ${comment.chapter}:${comment.verse}`;
      tr.appendChild(tdRef);

      const tdCommentator = document.createElement('td');
      tdCommentator.className = 'commentary-commentator-cell';
      tdCommentator.textContent = comment.source.commentator || 'Commentary';
      tr.appendChild(tdCommentator);

      const tdWork = document.createElement('td');
      tdWork.className = 'commentary-work-cell';
      tdWork.textContent = comment.source.title || '';
      const refText = sectionsToRefText(comment.sections);
      if (refText) {
        const refSpan = document.createElement('span');
        refSpan.className = 'commentary-work-ref';
        refSpan.textContent = ` ${refText}`;
        tdWork.appendChild(refSpan);
      }
      tr.appendChild(tdWork);

      const tdComment = document.createElement('td');
      tdComment.className = 'commentary-comment-cell';
      const preview = document.createElement('div');
      preview.className = 'commentary-preview commentary-preview-clamp';
      preview.addEventListener('click', () => {
        if (!preview.classList.contains('is-expandable')) return;
        preview.classList.toggle('commentary-preview-clamp');
      });
      tdComment.appendChild(preview);
      tr.appendChild(tdComment);

      const tdLink = document.createElement('td');
      tdLink.className = 'commentary-link-cell';
      const a = document.createElement('a');
      a.href = buildSefariaUrl(comment.source, comment.sections);
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Sefaria ↗';
      tdLink.appendChild(a);
      tr.appendChild(tdLink);

      fragment.appendChild(tr);
      pendingTextLoads.push([comment, preview, a]);
    });

    modal.tbody.appendChild(fragment);
    modal.body.scrollTop = 0;
    // Queue text loads only after the rows are attached — the queue skips
    // elements that are no longer connected to the document.
    pendingTextLoads.forEach(([comment, preview, a]) => loadCommentTextInto(comment, preview, a));
    modal.pageInfo.textContent = `Page ${state.page} of ${totalPages}`;
    modal.totalInfo.textContent = `(${state.comments.length.toLocaleString('en-US')} comments)`;
    modal.first.disabled = state.page === 1;
    modal.prev.disabled = state.page === 1;
    modal.next.disabled = state.page === totalPages;
    modal.last.disabled = state.page === totalPages;
    modal.pageSize.value = String(state.pageSize);
    modal.pagination.classList.toggle('is-hidden', state.comments.length <= 25);
  }

  function describeComments(comments, commentatorLabel, expected, failedBooks) {
    const parts = [`${comments.length.toLocaleString('en-US')} comments`];
    const works = new Set(comments.map(c => c.source.title || ''));
    if (works.size > 1) parts.push(`${works.size.toLocaleString('en-US')} works`);
    if (commentatorLabel) parts.push(commentatorLabel);
    if (expected && expected !== comments.length) {
      parts.push(`count column shows ${expected.toLocaleString('en-US')}`);
    }
    if (failedBooks && failedBooks.length) {
      parts.push(`details unavailable for ${failedBooks.join(', ')}`);
    }
    return parts.join(' · ');
  }

  async function openFromTrigger(trigger) {
    const scope = {
      genre: trigger.dataset.genre || '',
      book: trigger.dataset.book || '',
      chapter: trigger.dataset.chapter ? Number.parseInt(trigger.dataset.chapter, 10) : null,
      verse: trigger.dataset.verse ? Number.parseInt(trigger.dataset.verse, 10) : null,
      label: trigger.dataset.scopeLabel || trigger.dataset.book || trigger.dataset.genre || ''
    };
    const books = booksForScope(scope);
    if (!books.length) return;

    const commentatorKey = trigger.dataset.commentatorKey || '';
    const commentatorLabel = trigger.dataset.commentatorLabel || (commentatorByKey.get(commentatorKey) || {}).label || '';
    const modal = ensureModal();
    modal.overlay.classList.add('open');
    state.title = commentatorLabel
      ? `${commentatorLabel} Comments for ${scope.label}`
      : `Commentary for ${scope.label}`;
    state.meta = 'Loading...';
    state.comments = [];
    state.sorted = false;
    state.page = 1;
    state.sortKey = 'ref';
    state.sortDir = 'asc';
    modal.title.textContent = state.title;
    modal.meta.textContent = state.meta;
    setLoading(books.length > 1 ? `Loading comments from ${books.length} books...` : 'Loading comments...');

    try {
      const bookDataList = await Promise.all(
        books.map(book => loadBook(book).catch(() => null))
      );
      const failedBooks = books.filter((book, i) => !bookDataList[i]);
      if (failedBooks.length === books.length) {
        throw new Error('Unable to load commentary details.');
      }
      const comments = collectComments(bookDataList, scope, commentatorKey);
      state.comments = comments;
      state.sorted = false;
      const expected = Number(trigger.dataset.count) || comments.length;
      state.meta = describeComments(comments, commentatorLabel, expected, failedBooks);
      renderComments();
    } catch (e) {
      state.meta = '';
      modal.title.textContent = state.title;
      modal.meta.textContent = '';
      modal.loading.classList.add('is-hidden');
      modal.table.classList.add('is-hidden');
      modal.loading.textContent = '';
      modal.tbody.innerHTML = '';
      modal.loading.innerHTML = `<span class="warning">${escapeHTML(e.message || 'Unable to load commentary details.')}</span>`;
      modal.loading.classList.remove('is-hidden');
      modal.pagination.classList.add('is-hidden');
    }
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target && typeof e.target.closest === 'function'
      ? e.target.closest('.commentary-count-link')
      : null;
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    openFromTrigger(trigger);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els && els.overlay.classList.contains('open')) closeModal();
  });

  function englishNameFromTitle(title) {
    const match = /\(([^()]+)\)\s*$/.exec(String(title || ''));
    return match ? match[1].trim() : '';
  }

  window.initCommentaryDetail = function (deps) {
    deps = deps || {};
    playsById = deps.playsById || new Map();
    playsList = Array.isArray(deps.plays) ? deps.plays : [];
    commentaryConfig = deps.commentaryInterestConfig || null;
    escapeHTML = deps.escapeHTML || window.escapeHTML || escapeHTML;
    bookOrder = new Map();
    bookEnglishNames = new Map();
    playsList.forEach((play, index) => {
      const abbr = play && play.abbr ? String(play.abbr) : '';
      if (!abbr) return;
      bookOrder.set(abbr, index);
      const english = englishNameFromTitle(play.title);
      if (english) bookEnglishNames.set(abbr, english);
    });
    const commentators = commentaryConfig
      && commentaryConfig.metadata
      && Array.isArray(commentaryConfig.metadata.commentators)
      ? commentaryConfig.metadata.commentators
      : [];
    commentatorByKey = new Map(commentators.map(item => [
      String(item.key || ''),
      {
        label: String(item.label || item.name || item.key || ''),
        name: String(item.name || item.label || item.key || '')
      }
    ]).filter(([key]) => key));
  };

  window.isCommentaryDetailCell = isCommentaryDetailCell;
  window.buildCommentaryDetailLink = buildCommentaryDetailLink;
})();
