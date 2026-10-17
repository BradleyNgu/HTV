/**
 * LinkedIn Jobs DOM scraper + apply-button pacing overlay.
 * Supports /jobs/search/* (split pane) and /jobs/view/* (standalone).
 * Does not require clicking "Show more" — uses textContent + meta/JSON-LD.
 */

(function () {
  'use strict';

  const TITLE_NOISE =
    /^(?:(?:add this job|join or sign in|sign in|join now|use ai|match score|tailor your resume|see who|similar jobs).*|(?:linkedin|home|jobs|notifications|messaging|network|search|me|more|for business|advertise))$/i;

  const TITLE_SELECTORS = [
    '.job-details-jobs-unified-top-card__job-title h1 a',
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title a',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title h1 a',
    '.jobs-unified-top-card__job-title h1',
    '.jobs-unified-top-card__job-title a',
    '.jobs-unified-top-card__job-title',
    'h1.t-24 a',
    'h1.t-24',
    '.jobs-details-top-card__job-title',
    '[data-test-job-title]',
    'h1.top-card-layout__title',
    '.top-card-layout__entity-info h1',
    'h1.topcard__title',
    '.topcard__title',
  ];

  const COMPANY_SELECTORS = [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    '.job-details-jobs-unified-top-card__primary-description-without-tagline a[href*="/company/"]',
    '.job-details-jobs-unified-top-card__primary-description-container a[href*="/company/"]',
    'a.job-details-jobs-unified-top-card__company-name',
    '.jobs-details-top-card__company-url',
    '[data-test-company-name]',
    'a.topcard__org-name-link',
    '.topcard__org-name-link',
    'a[data-tracking-control-name="public_jobs_topcard-org-name"]',
    '.top-card-layout__entity-info a[href*="/company/"]',
    'a[href*="/company/"][data-tracking-control-name*="topcard"]',
  ];

  const DESCRIPTION_SELECTORS = [
    '.jobs-description__content .jobs-box__html-content',
    '.jobs-box__html-content',
    '#job-details .jobs-box__html-content',
    '#job-details',
    '.jobs-description-content__text--stretch',
    '.jobs-description-content__text',
    '.jobs-description__content',
    'article.jobs-description__container',
    '.jobs-description',
    '.show-more-less-html__markup',
    'div.show-more-less-html__markup',
    '.description__text .show-more-less-html__markup',
    '.description__text--rich',
    '.description__text',
    'section.description',
    '.core-section-container__content',
  ];

  // Class-based hints for older layouts. The new layout uses hashed classes, so
  // apply buttons are ALSO recognised by their visible text / aria-label.
  const APPLY_CLASS_SELECTORS = ['.jobs-apply-button', '#jobs-apply-button-id', '.jobs-s-apply button'];
  const CONTROL_SELECTOR = 'button, a, [role="button"]';

  let lastUrl = location.href;
  let pacingAtCap = false;

  /** Prefer textContent so collapsed "Show more" markup is still readable. */
  function textOf(el, { visibleOnly = false } = {}) {
    if (!el) return '';
    const raw = visibleOnly ? el.innerText : el.textContent;
    return (raw || '').replace(/\s+/g, ' ').trim();
  }

  function isNoiseTitle(t) {
    if (!t || t.length < 3) return true;
    if (TITLE_NOISE.test(t)) return true;
    if (/match score|tailor your resume|sign in to/i.test(t)) return true;
    return false;
  }

  function cleanTitle(raw) {
    if (!raw) return '';
    return raw.replace(/\s+with verification$/i, '').trim();
  }

  function cleanCompany(raw) {
    if (!raw) return '';
    let c = raw
      .replace(/\s*[·•|].*$/, '')
      .replace(/\s+\d+\s*(followers|employees|applicants).*$/i, '')
      .replace(/\s+Reposted.*$/i, '')
      .trim();

    // "SageSure Jersey City, NJ" → "SageSure"
    const loc = c.match(
      /^(.*?)\s+([A-Z][a-zA-Z.\s]+,\s*[A-Z]{2}(?:\s*[·•].*)?)$/
    );
    if (loc && loc[1] && loc[1].length < 80) c = loc[1].trim();

    return c;
  }

  function parseHiringTitle(raw) {
    const s = (raw || '').trim();
    if (!s) return null;
    // "SageSure hiring Software Engineer Intern in Jersey City, NJ | LinkedIn"
    let m = s.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+?)?\s*\|\s*LinkedIn$/i);
    if (m) return { company: m[1].trim(), title: m[2].trim() };
    m = s.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
    if (m) return { company: m[1].trim(), title: m[2].trim() };
    return null;
  }

  function parseMetaFallbacks() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';
    const docTitle = document.title || '';
    const hiring = parseHiringTitle(ogTitle) || parseHiringTitle(docTitle);
    return {
      title: hiring?.title || '',
      company: hiring?.company || '',
      description: (ogDesc || '').trim(),
    };
  }

  function parseJsonLdJob() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent || '');
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const graph = item['@graph'] || [item];
          for (const node of graph) {
            const type = node['@type'];
            const isJob =
              type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
            if (!isJob) continue;
            const org = node.hiringOrganization;
            return {
              title: (node.title || '').trim(),
              company: (typeof org === 'string' ? org : org?.name || '').trim(),
              description: stripHtml(node.description || ''),
            };
          }
        }
      } catch {
        /* skip */
      }
    }
    return null;
  }

  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return textOf(tmp);
  }

  /** LinkedIn sometimes embeds job JSON in inline scripts / code tags. */
  function parseEmbeddedJobJson() {
    const blobs = [];
    document.querySelectorAll('code[id], script:not([src])').forEach((el) => {
      const t = el.textContent || '';
      if (t.length > 200 && /jobPosting|JobPosting|companyName|jobDescription/i.test(t)) {
        blobs.push(t);
      }
    });

    for (const blob of blobs) {
      // Try to find a JobPosting-like object
      const titleMatch = blob.match(/"title"\s*:\s*"((?:\\.|[^"\\]){3,200})"/);
      const companyMatch =
        blob.match(/"companyName"\s*:\s*"((?:\\.|[^"\\])+)"/) ||
        blob.match(/"name"\s*:\s*"((?:\\.|[^"\\])+)"\s*,\s*"logo"/) ||
        blob.match(/"hiringOrganization"[^}]*"name"\s*:\s*"((?:\\.|[^"\\])+)"/);
      const descMatch =
        blob.match(/"description"\s*:\s*"((?:\\.|[^"\\]){80,})"/) ||
        blob.match(/"jobDescription"\s*:\s*"((?:\\.|[^"\\]){80,})"/);

      const unesc = (s) => {
        if (!s) return '';
        try {
          return JSON.parse(`"${s}"`);
        } catch {
          return s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/<[^>]+>/g, ' ');
        }
      };

      const title = unesc(titleMatch?.[1]);
      const company = unesc(companyMatch?.[1]);
      let description = unesc(descMatch?.[1]);
      if (description.includes('<')) description = stripHtml(description);

      if (title && !isNoiseTitle(title)) {
        return {
          title: cleanTitle(title),
          company: cleanCompany(company),
          description: description.replace(/\s+/g, ' ').trim(),
        };
      }
    }
    return null;
  }

  function queryFirstGoodTitle() {
    for (const sel of TITLE_SELECTORS) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (const el of nodes) {
          const t = cleanTitle(textOf(el));
          if (t && !isNoiseTitle(t)) return t;
        }
      } catch {
        /* skip */
      }
    }
    return '';
  }

  function queryFirstCompany() {
    // Prefer explicit company links
    const companyLinks = document.querySelectorAll(
      'a[href*="/company/"], a[href*="/school/"]'
    );
    for (const a of companyLinks) {
      // Skip nav / footer noise
      const href = a.getAttribute('href') || '';
      if (/\/company\/linkedin/i.test(href)) continue;
      const inTopCard = a.closest(
        [
          '.job-details-jobs-unified-top-card',
          '.jobs-unified-top-card',
          '.top-card-layout',
          '.topcard',
          '.jobs-details-top-card',
          '.job-view-layout',
        ].join(',')
      );
      const t = cleanCompany(textOf(a));
      if (t && t.length > 1 && t.length < 80 && inTopCard) return t;
    }

    for (const sel of COMPANY_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        const t = cleanCompany(textOf(el));
        if (t && !TITLE_NOISE.test(t)) return t;
      } catch {
        /* skip */
      }
    }
    return '';
  }

  function collectDescription() {
    let best = '';
    for (const sel of DESCRIPTION_SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          // Clone and strip scripts / show-more buttons for cleaner text
          const clone = el.cloneNode(true);
          clone
            .querySelectorAll(
              'button, script, style, .show-more-less-html__button, .artdeco-button'
            )
            .forEach((n) => n.remove());
          const t = textOf(clone);
          if (t.length > best.length) best = t;
        });
      } catch {
        /* skip */
      }
    }

    // Filter sign-in CTA blobs
    if (best && /join or sign in to find your next job/i.test(best) && best.length < 400) {
      return '';
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Layout-independent extraction (LinkedIn's new UI uses hashed class names).
  // Anchors on stable visible text: "About the job" and the
  // "Location · 1 month ago · N applicants" meta line under the title.
  // ---------------------------------------------------------------------------

  const DESC_START = /about the job/i;
  const DESC_END_MARKERS = [
    /set alert for similar jobs/i,
    /about the company/i,
    /unlock hiring insights/i,
    /meet the hiring team/i,
    /people you can reach out to/i,
    /\bmore jobs\b/i,
    /\u2026\s*more\b/i,
    /\.\.\.\s*more\b/i,
    /show more\s*show less/i,
  ];
  const META_LINE = /\u00b7|\u2022/;
  const META_HINT = /(\bago\b|applicant|clicked apply|reposted|promoted|actively (hiring|reviewing)|be an early applicant)/i;

  function pageLines() {
    const root = document.querySelector('main') || document.body;
    const raw = root?.innerText || document.body?.innerText || '';
    return raw
      .split(/\n+/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function dedupeRepeated(str) {
    const s = (str || '').trim();
    if (s.length > 6 && s.length % 2 === 0) {
      const half = s.slice(0, s.length / 2).trim();
      if (half && s === `${half}${half}`) return half;
    }
    const m = s.match(/^(.{3,}?)\s+\1$/);
    return m ? m[1] : s;
  }

  function descriptionFromText() {
    const root = document.querySelector('main') || document.body;
    const full = root?.innerText || '';
    if (!full) return '';

    // Use the LAST "About the job" before any "About the company" (job pane).
    const startMatch = full.match(DESC_START);
    if (!startMatch) return '';
    const startIdx = startMatch.index + startMatch[0].length;
    const rest = full.slice(startIdx);

    let endIdx = rest.length;
    for (const rx of DESC_END_MARKERS) {
      const m = rest.match(rx);
      // Ignore early hits so tiny preambles don't truncate us
      if (m && m.index > 150 && m.index < endIdx) endIdx = m.index;
    }
    return rest.slice(0, endIdx).replace(/\s+/g, ' ').trim();
  }

  function descriptionFromAnchor() {
    // Find the heading element and climb to the smallest ancestor with real content
    const candidates = document.querySelectorAll('h1,h2,h3,h4,h5,p,span,div,strong');
    for (const el of candidates) {
      if (el.children.length > 2) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^about the job$/i.test(t)) continue;

      let node = el;
      for (let i = 0; i < 8 && node.parentElement; i += 1) {
        node = node.parentElement;
        const txt = textOf(node);
        if (/about the company|set alert for similar jobs/i.test(txt) && i > 1) break;
        if (txt.length > 400) {
          return txt.replace(/^about the job\s*/i, '').trim();
        }
      }
    }
    return '';
  }

  function titleCompanyFromText() {
    const lines = pageLines();
    if (!lines.length) return { title: '', company: '' };

    // Locate "About the job" and look backwards for the meta line
    let aboutIdx = lines.findIndex((l) => /^about the job$/i.test(l));
    if (aboutIdx < 0) aboutIdx = lines.length;

    let metaIdx = -1;
    for (let i = aboutIdx - 1; i >= 0; i -= 1) {
      if (META_LINE.test(lines[i]) && META_HINT.test(lines[i])) {
        metaIdx = i;
        break;
      }
    }
    if (metaIdx < 1) return { title: '', company: '' };

    // Walk upward skipping badge-y lines to find title, then company
    const skip = /^(apply|save|easy apply|hybrid|remote|on-site|full-time|part-time|contract|internship|promoted)$/i;
    const pick = (from) => {
      for (let i = from; i >= 0 && i > from - 6; i -= 1) {
        const l = lines[i];
        if (!l || skip.test(l) || isNoiseTitle(l) || META_LINE.test(l) && META_HINT.test(l)) continue;
        return { value: l, index: i };
      }
      return null;
    };

    const t = pick(metaIdx - 1);
    if (!t) return { title: '', company: '' };
    const c = pick(t.index - 1);

    return {
      title: cleanTitle(dedupeRepeated(t.value)),
      company: c ? cleanCompany(dedupeRepeated(c.value)) : '',
    };
  }

  function companyFromLogoAlt() {
    const imgs = document.querySelectorAll('img[alt]');
    for (const img of imgs) {
      const m = (img.getAttribute('alt') || '').match(/^company logo for,?\s*(.+?)\.?$/i);
      if (m && m[1]) return cleanCompany(m[1]);
    }
    return '';
  }

  function parseDocumentTitle() {
    // "(1) Software Engineer Intern | Hewlett Packard Enterprise | LinkedIn"
    const raw = (document.title || '').replace(/^\(\d+\)\s*/, '').trim();
    const hiring = parseHiringTitle(raw);
    if (hiring) return hiring;

    const parts = raw.split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length && /^linkedin$/i.test(parts[parts.length - 1])) parts.pop();
    if (parts.length >= 2 && !isNoiseTitle(parts[0])) {
      return { title: parts[0], company: parts[1] };
    }
    return null;
  }

  function scrapeJob() {
    const jsonLd = parseJsonLdJob();
    const embedded = parseEmbeddedJobJson();
    const meta = parseMetaFallbacks();
    const docTitle = parseDocumentTitle();
    const textTC = titleCompanyFromText();
    const sources = { title: '', company: '', description: '' };

    let title = '';
    let company = '';
    let description = '';

    const setIf = (field, value, label) => {
      if (!value) return;
      if (field === 'title') {
        if (!title && !isNoiseTitle(value)) {
          title = cleanTitle(value);
          sources.title = label;
        }
      } else if (field === 'company') {
        if (!company) {
          company = cleanCompany(value);
          if (company) sources.company = label;
        }
      } else if (field === 'description') {
        if (value.length > 80 && value.length > description.length) {
          description = value;
          sources.description = label;
        }
      }
    };

    // 1) Structured data
    [['json-ld', jsonLd], ['embedded', embedded], ['meta', meta]].forEach(([label, s]) => {
      if (!s) return;
      setIf('title', s.title, label);
      setIf('company', s.company, label);
      setIf('description', s.description, label);
    });

    // 2) Known class-based DOM (older layouts)
    setIf('title', queryFirstGoodTitle(), 'dom');
    setIf('company', queryFirstCompany(), 'dom');
    setIf('description', collectDescription(), 'dom');

    // 3) Layout-independent text heuristics (new LinkedIn UI)
    setIf('title', textTC.title, 'text');
    setIf('company', textTC.company, 'text');
    setIf('description', descriptionFromAnchor(), 'anchor');
    setIf('description', descriptionFromText(), 'text');

    // 4) Tab title / logo alt as last resorts
    if (docTitle) {
      setIf('title', docTitle.title, 'doc-title');
      setIf('company', docTitle.company, 'doc-title');
    }
    setIf('company', companyFromLogoAlt(), 'logo-alt');

    // Prefer the longest sane description between anchor/text/dom
    const textDesc = descriptionFromText();
    if (textDesc.length > description.length * 1.15 && textDesc.length < 40000) {
      description = textDesc;
      sources.description = 'text';
    }

    description = description
      .replace(/\s*Show more\s*Show less\s*$/i, '')
      .replace(/\s*See more\s*See less\s*$/i, '')
      .replace(/\s*(\u2026|\.\.\.)\s*more\s*$/i, '')
      .trim();

    const url = location.href.split('?')[0];
    const missing = [];
    if (!title) missing.push('title');
    if (!company) missing.push('company');
    if (!description || description.length < 80) missing.push('description');

    return {
      title,
      company,
      description,
      url,
      scrapedAt: new Date().toISOString(),
      ok: missing.length === 0,
      missing,
      sources,
      diagnostics: {
        isTopFrame: window === window.top,
        hasAboutTheJob: /about the job/i.test(document.body?.innerText || ''),
        docTitle: document.title,
        bodyChars: (document.body?.innerText || '').length,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Apply / submit detection — drives automatic pacing
  // ---------------------------------------------------------------------------

  function controlLabel(el) {
    return (el?.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
  }

  function controlText(el) {
    return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** The "Apply" / "Easy Apply" button on a job — not "Applied", "Apply filters", etc. */
  function isApplyControl(el) {
    if (!el || el.closest?.('#sjsc-pacing-banner, #sjsc-toast')) return false;
    const text = controlText(el);
    const label = controlLabel(el);
    if (/\bapplied\b/i.test(text) || /\bapplied\b/i.test(label)) return false;
    if (/^(easy )?apply( now)?$/i.test(text)) return true;
    if (/^(easy apply|apply on company website|apply to\b)/i.test(label)) return true;
    return APPLY_CLASS_SELECTORS.some((sel) => {
      try {
        return el.matches(sel);
      } catch {
        return false;
      }
    });
  }

  function isEasyApply(el) {
    return /easy apply/i.test(`${controlText(el)} ${controlLabel(el)}`);
  }

  /** Final "Submit application" button inside the Easy Apply dialog. */
  function isSubmitControl(el) {
    return /^submit application$/i.test(controlLabel(el)) || /^submit application$/i.test(controlText(el));
  }

  function findApplyControls() {
    const found = new Set();
    document.querySelectorAll(CONTROL_SELECTOR).forEach((el) => {
      if (isApplyControl(el)) found.add(el);
    });
    return [...found];
  }

  function submitControlExists() {
    return [...document.querySelectorAll(CONTROL_SELECTOR)].some(isSubmitControl);
  }

  /** Stable per-job key: LinkedIn job id from /jobs/view/<id> or ?currentJobId=<id>. */
  function currentJobKey() {
    try {
      const url = new URL(location.href);
      const id =
        url.searchParams.get('currentJobId') ||
        (url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/) || [])[1];
      if (id) return `li-${id}`;
      return `url-${url.pathname}`;
    } catch {
      return `url-${location.pathname}`;
    }
  }

  function showToast(message) {
    let toast = document.getElementById('sjsc-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sjsc-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('visible'), 4500);
  }

  async function recordApplication(method) {
    const job = scrapeJob();
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'RECORD_APPLICATION',
        jobKey: currentJobKey(),
        title: job.title,
        company: job.company,
        url: job.url,
        method,
      });
      if (!res?.ok) return;
      setApplyDisabled(Boolean(res.atCap));
      showToast(
        res.duplicate
          ? 'Already counted toward today\u2019s pace.'
          : `Counted toward today\u2019s pace: ${res.appsSubmittedToday} of ${res.dailyAppCap}.`
      );
    } catch {
      /* extension reloaded mid-click — nothing to record */
    }
  }

  // Easy Apply is counted only once the application actually goes through, so
  // opening the dialog (or abandoning it) never uses up a slot.
  const SENT_TEXT = /application sent|your application was sent|application submitted/i;
  const FORM_ERROR_TEXT = /\brequired\b|please enter|please make a selection|enter a valid|must be/i;
  let submissionWatch = null;

  function watchEasyApplySubmission() {
    if (submissionWatch) clearInterval(submissionWatch.timer);
    const watch = { startedAt: Date.now(), timer: null };
    submissionWatch = watch;

    const finish = (shouldRecord) => {
      clearInterval(watch.timer);
      if (submissionWatch === watch) submissionWatch = null;
      if (shouldRecord) recordApplication('easy');
    };

    watch.timer = setInterval(() => {
      const elapsed = Date.now() - watch.startedAt;
      const dialogText = document.querySelector('[role="dialog"]')?.innerText || '';
      const pageText = document.body?.innerText || '';

      if (SENT_TEXT.test(dialogText) || SENT_TEXT.test(pageText)) return finish(true);

      // Fallback if LinkedIn changes the confirmation wording: the Submit button
      // is gone and the form is not showing a validation error.
      if (elapsed > 1500 && !submitControlExists() && !FORM_ERROR_TEXT.test(dialogText)) {
        return finish(true);
      }
      if (elapsed > 15000) finish(false);
    }, 500);
  }

  function setApplyDisabled(disabled) {
    pacingAtCap = disabled;
    const buttons = findApplyControls();

    buttons.forEach((btn) => {
      if (disabled) {
        btn.classList.add('sjsc-apply-disabled');
        btn.setAttribute('aria-disabled', 'true');
        btn.dataset.sjscBlocked = '1';
        if (!btn.dataset.sjscOriginalTitle) {
          btn.dataset.sjscOriginalTitle = btn.getAttribute('title') || '';
        }
        btn.setAttribute('title', 'Daily application cap reached — paced by Job Search Copilot');
      } else {
        btn.classList.remove('sjsc-apply-disabled');
        btn.removeAttribute('aria-disabled');
        delete btn.dataset.sjscBlocked;
        if (btn.dataset.sjscOriginalTitle !== undefined) {
          if (btn.dataset.sjscOriginalTitle) {
            btn.setAttribute('title', btn.dataset.sjscOriginalTitle);
          } else {
            btn.removeAttribute('title');
          }
          delete btn.dataset.sjscOriginalTitle;
        }
      }
    });

    ensureOverlay(disabled);
  }

  function ensureOverlay(show) {
    let banner = document.getElementById('sjsc-pacing-banner');
    if (!show) {
      banner?.remove();
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sjsc-pacing-banner';
      banner.innerHTML =
        '<strong>Daily cap reached</strong> — Easy Apply is paused so you can apply sustainably. Open the Copilot side panel to adjust pacing.';
      document.body.appendChild(banner);
    }
  }

  async function syncPacing() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_PACING_STATE' });
      if (res?.ok) setApplyDisabled(Boolean(res.atCap));
    } catch {
      /* ignore */
    }
  }

  document.addEventListener(
    'click',
    (e) => {
      const control = e.target?.closest?.(CONTROL_SELECTOR);
      if (!control) return;

      if (isApplyControl(control)) {
        if (pacingAtCap) {
          e.preventDefault();
          e.stopPropagation();
          ensureOverlay(true);
          return;
        }
        // Apply on the company's site can't be observed, so count the click.
        // Easy Apply is counted when the application is actually submitted.
        if (!isEasyApply(control)) recordApplication('external');
        return;
      }

      if (isSubmitControl(control)) watchEasyApplySubmission();
    },
    true
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SCRAPE_JOB') {
      try {
        sendResponse(scrapeJob());
      } catch (err) {
        sendResponse({
          ok: false,
          missing: ['title', 'company', 'description'],
          title: '',
          company: '',
          description: '',
          url: location.href,
          error: err?.message || 'Scrape error',
        });
      }
      return false;
    }
    if (message?.type === 'PACING_UPDATED') {
      setApplyDisabled(Boolean(message.atCap));
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(syncPacing, 600);
    }
  });
  urlObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Re-lock Apply buttons after LinkedIn re-renders them. Debounced because
  // scanning every control on each of LinkedIn's constant DOM mutations is costly.
  let relockTimer = null;
  if (document.body) {
    new MutationObserver(() => {
      if (!pacingAtCap || relockTimer) return;
      relockTimer = setTimeout(() => {
        relockTimer = null;
        if (pacingAtCap) setApplyDisabled(true);
      }, 300);
    }).observe(document.body, { childList: true, subtree: true });
  }

  syncPacing();
  setInterval(syncPacing, 30_000);
})();
