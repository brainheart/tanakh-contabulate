// Utility functions — pure helpers with no state dependencies

(function () {
  'use strict';

  const HEBREW_POINT_RE = /[\u0591-\u05BD\u05BF-\u05C7]/g;
  const HEBREW_TOKEN_RE = /[\u05D0-\u05EA]+(?:[\u05F3\u05F4'"]?[\u05D0-\u05EA]+)*/g;
  const HEBREW_CHAR_RE = /[\u0590-\u05FF]/;
  const HEBREW_LETTER_RE = /[\u05D0-\u05EA]/;

  function normalizeHebrew(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(HEBREW_POINT_RE, '')
      .normalize('NFC')
      .replace(/\//g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeTerm(term) {
    return normalizeHebrew(term);
  }

  function parseNumeric(text) {
    if (text == null) return NaN;
    const raw = String(text).trim();
    if (!raw) return NaN;
    const s = raw.replace(/,/g, '');
    const re = /^-?(?:\d+(?:\.\d+)?|\.\d+)%?$/;
    if (!re.test(s)) return NaN;
    const num = parseFloat(s.replace('%', ''));
    return Number.isFinite(num) ? num : NaN;
  }

  function pickTextColorForBg(rgbStr) {
    const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(rgbStr);
    if (!m) return '#1a1a1a';
    const r = parseInt(m[1], 10);
    const g = parseInt(m[2], 10);
    const b = parseInt(m[3], 10);
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness < 170 ? '#ffffff' : '#1a1a1a';
  }

  function quantiles(arr, qs) {
    if (!arr.length) return qs.map(() => NaN);
    const a = [...arr].sort((x, y) => x - y);
    const n = a.length;
    return qs.map(q => {
      if (n === 1) return a[0];
      const pos = (n - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      return a[base] + (a[Math.min(base + 1, n - 1)] - a[base]) * rest;
    });
  }

  function normName(s) {
    return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  }

  function fmtPct(num) {
    return (num * 100).toFixed(3) + '%';
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      '\'': '&#39;'
    }[c]));
  }

  function buildNormalizedIndexMap(source) {
    const normalizedChars = [];
    const indexMap = [];
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (/\s/.test(ch)) {
        if (normalizedChars.length && normalizedChars[normalizedChars.length - 1] !== ' ') {
          normalizedChars.push(' ');
          indexMap.push(i);
        }
        continue;
      }
      const normalized = normalizeHebrew(ch);
      if (!normalized) continue;
      for (const normChar of normalized) {
        normalizedChars.push(normChar);
        indexMap.push(i);
      }
    }
    while (normalizedChars.length && normalizedChars[normalizedChars.length - 1] === ' ') {
      normalizedChars.pop();
      indexMap.pop();
    }
    return {
      normalized: normalizedChars.join(''),
      indexMap
    };
  }

  function highlightHTML(text, re) {
    if (!re) return escapeHTML(text);
    const source = String(text || '');
    const indexed = buildNormalizedIndexMap(source);
    if (!indexed.normalized) return escapeHTML(source);

    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const runRe = new RegExp(re.source, flags);
    const ranges = [];
    let m;
    while ((m = runRe.exec(indexed.normalized))) {
      const startNorm = m.index;
      const endNorm = startNorm + (m[0] ? m[0].length : 0);
      if (endNorm <= startNorm) {
        runRe.lastIndex++;
        continue;
      }
      const start = indexed.indexMap[startNorm];
      const end = indexed.indexMap[endNorm - 1] + 1;
      if (start == null || end == null) continue;
      ranges.push([start, end]);
    }

    if (!ranges.length) return escapeHTML(source);
    ranges.sort((a, b) => a[0] - b[0]);

    const merged = [];
    for (const range of ranges) {
      const prev = merged[merged.length - 1];
      if (!prev || range[0] > prev[1]) merged.push(range.slice());
      else prev[1] = Math.max(prev[1], range[1]);
    }

    let out = '';
    let last = 0;
    for (const [start, end] of merged) {
      out += escapeHTML(source.slice(last, start));
      out += '<span class="hit">' + escapeHTML(source.slice(start, end)) + '</span>';
      last = end;
    }
    out += escapeHTML(source.slice(last));
    return out;
  }

  function toCsvValue(val) {
    const s = String(val ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map(r => r.map(toCsvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function stripTags(text) {
    return String(text || '').replace(/<[^>]*>/g, '').trim();
  }

  function countRegexMatches(text, re) {
    if (!re) return 0;
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const r = new RegExp(re.source, flags);
    const normalized = normalizeHebrew(text);
    let count = 0;
    let m;
    while ((m = r.exec(normalized))) {
      if (m[0].length === 0) {
        r.lastIndex++;
        continue;
      }
      count++;
    }
    return count;
  }

  function tokenizeLineText(text) {
    return normalizeHebrew(text).match(HEBREW_TOKEN_RE) || [];
  }

  function getLineTokens(line) {
    if (!line) return [];
    if (!line._tokensCache) {
      line._tokensCache = tokenizeLineText(line.text);
    }
    return line._tokensCache;
  }

  function getLineNgrams(line, n) {
    if (!line) return [];
    if (!line._ngramsCache) line._ngramsCache = {};
    if (!line._ngramsCache[n]) {
      const toks = getLineTokens(line);
      const out = [];
      for (let i = 0; i <= toks.length - n; i++) {
        out.push(toks.slice(i, i + n).join(' '));
      }
      line._ngramsCache[n] = out;
    }
    return line._ngramsCache[n];
  }

  function escapeRegexText(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildHighlightRegexFromNgrams(ngrams) {
    if (!Array.isArray(ngrams) || ngrams.length === 0) return null;
    const parts = [];
    for (const ng of ngrams) {
      const tokens = normalizeHebrew(ng).split(' ').filter(Boolean).map(escapeRegexText);
      if (tokens.length === 0) continue;
      parts.push(tokens.join('\\s+'));
    }
    if (parts.length === 0) return null;
    return new RegExp(parts.join('|'), 'gi');
  }

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function paginateArray(arr, page, pageSize) {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return arr.slice(start, end);
  }

  function getTotalPages(totalRows, pageSize) {
    return Math.max(1, Math.ceil(totalRows / pageSize));
  }

  function setElementHidden(el, hidden) {
    if (!el || !el.classList) return;
    el.classList.toggle('is-hidden', !!hidden);
  }

  function showElement(el) {
    setElementHidden(el, false);
  }

  function hideElement(el) {
    setElementHidden(el, true);
  }

  function containsHebrew(text) {
    return HEBREW_CHAR_RE.test(String(text || ''));
  }

  function isPureHebrewText(text) {
    const stripped = String(text || '').replace(/[\s()0-9:.,;"'!?[\]{}-]/g, '');
    return !!stripped && !/[A-Za-z]/.test(stripped) && HEBREW_LETTER_RE.test(stripped);
  }

  function applyDirectionalText(el, options = {}) {
    if (!el) return;
    const text = el.textContent || '';
    if (!containsHebrew(text)) return;
    if (options.mixed || !isPureHebrewText(text)) {
      el.classList.add('hebrew-mixed');
      return;
    }
    el.classList.add('hebrew');
  }

  function applyHebrewClasses(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('td, th, .play-detail-link, .play-detail-meta, .play-detail-value').forEach(el => {
      const mixed = el.classList.contains('book-cell') || el.classList.contains('book-link');
      applyDirectionalText(el, { mixed });
    });
  }

  window.normalizeHebrew = normalizeHebrew;
  window.normalizeTerm = normalizeTerm;
  window.parseNumeric = parseNumeric;
  window.pickTextColorForBg = pickTextColorForBg;
  window.quantiles = quantiles;
  window.normName = normName;
  window.fmtPct = fmtPct;
  window.escapeHTML = escapeHTML;
  window.highlightHTML = highlightHTML;
  window.toCsvValue = toCsvValue;
  window.downloadCsv = downloadCsv;
  window.stripTags = stripTags;
  window.countRegexMatches = countRegexMatches;
  window.tokenizeLineText = tokenizeLineText;
  window.getLineTokens = getLineTokens;
  window.getLineNgrams = getLineNgrams;
  window.escapeRegexText = escapeRegexText;
  window.buildHighlightRegexFromNgrams = buildHighlightRegexFromNgrams;
  window.debounce = debounce;
  window.paginateArray = paginateArray;
  window.getTotalPages = getTotalPages;
  window.setElementHidden = setElementHidden;
  window.showElement = showElement;
  window.hideElement = hideElement;
  window.containsHebrew = containsHebrew;
  window.applyDirectionalText = applyDirectionalText;
  window.applyHebrewClasses = applyHebrewClasses;
})();
