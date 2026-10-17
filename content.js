/**
 * LinkedIn Jobs DOM scraper + apply-button pacing overlay.
 * Supports /jobs/search/* (split pane) and /jobs/view/* (standalone / guest).
 */

(function () {
  'use strict';

  const TITLE_SELECTORS = [
    // Logged-in unified job details
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title a',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title h1',
    '.jobs-unified-top-card__job-title a',
    '.jobs-unified-top-card__job-title',
    'h1.t-24',
    'h1.jobs-details-top-card__job-title',
    '.jobs-details-top-card__job-title',
    '[data-test-job-title]',
    // Guest / public /jobs/view pages
    'h1.top-card-layout__title',
    '.top-card-layout__entity-info h1',
    '.topcard__title',
    'h1.topcard__title',
    '.job-view-layout h1',
    'main h1',
    'h1',
  ];

  const COMPANY_SELECTORS = [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    '.job-details-jobs-unified-top-card__primary-description-container a',
    '.jobs-details-top-card__company-url',
    '[data-test-company-name]',
    // Guest / public
    '.topcard__org-name-link',
    '.top-card-layout__card .topcard__flavor a',
    'a.topcard__org-name-link',
    '.top-card-layout__entity-info a[href*="/company/"]',
    'a[data-tracking-control-name="public_jobs_topcard-org-name"]',
    '.job-details-jobs-unified-top-card__primary-description-without-tagline a',
  ];

  const DESCRIPTION_SELECTORS = [
    // Logged-in
    '#job-details',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content__text',
    '.jobs-description-content__text--stretch',
    'article.jobs-description__container',
    '.jobs-description',
    '.job-view-layout .jobs-description',
    // Guest / public /jobs/view
    '.show-more-less-html__markup',
    '.description__text',
    '.description__text--rich',
    'section.description .show-more-less-html',
    '.core-section-container__content .description__text',
    'div[class*="show-more-less-html"]',
    'article.jobs-description',
  ];

  const APPLY_BUTTON_SELECTORS = [
    'button.jobs-apply-button',
    '.jobs-apply-button',
    'button[aria-label*="Easy Apply" i]',
    'button[aria-label*="Apply" i]',
    '.jobs-s-apply button',
    '#jobs-apply-button-id',
    'button.topcard__link',
    'a.topcard__link',
  ];

  let lastUrl = location.href;
  let pacingAtCap = false;

  function queryFirst(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el && textOf(el)) return el;
      } catch {
        /* invalid selector — skip */
      }
    }
    return null;
  }

  function queryFirstAny(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch {
        /* skip */
      }
    }
    return null;
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function expandDescription() {
    const buttons = document.querySelectorAll(
      [
        'button.show-more-less-html__button',
        'button[aria-label*="more" i]',
        'button.inline-show-more-text__button',
        '.jobs-description__footer button',
        'button[data-tracking-control-name*="show-more"]',
      ].join(',')
    );
    buttons.forEach((btn) => {
      const label = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('see more') || label.includes('show more') || label.includes('more')) {
        try {
          btn.click();
        } catch {
          /* ignore */
        }
      }
    });
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
        /* bad json — skip */
      }
    }
    return null;
  }

  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return textOf(tmp);
  }

  function parseMetaFallbacks() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';
    const docTitle = document.title || '';

    // e.g. "SageSure hiring Software Engineer Intern in Jersey City, NJ | LinkedIn"
    let title = '';
    let company = '';
    const hiring = ogTitle.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?\s*\|\s*LinkedIn$/i);
    if (hiring) {
      company = hiring[1].trim();
      title = hiring[2].trim();
    } else if (docTitle.includes('|')) {
      title = docTitle.split('|')[0].trim();
    }

    return { title, company, description: (ogDesc || '').trim() };
  }

  function cleanCompany(raw) {
    if (!raw) return '';
    // Guest cards sometimes glue "SageSure Jersey City, NJ"
    return raw
      .replace(/\s*[·•|].*$/, '')
      .replace(/\s+\d+\s*(followers|employees).*$/i, '')
      .trim();
  }

  function cleanTitle(raw) {
    if (!raw) return '';
    return raw.replace(/\s+with verification$/i, '').trim();
  }

  function longestText(selectors) {
    let best = '';
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          const t = textOf(el);
          if (t.length > best.length) best = t;
        });
      } catch {
        /* skip */
      }
    }
    return best;
  }

  function scrapeJob() {
    expandDescription();

    const jsonLd = parseJsonLdJob();
    const meta = parseMetaFallbacks();

    const titleEl = queryFirst(TITLE_SELECTORS);
    const companyEl = queryFirst(COMPANY_SELECTORS);
    const descEl = queryFirstAny(DESCRIPTION_SELECTORS);

    let title = cleanTitle(textOf(titleEl) || jsonLd?.title || meta.title);
    let company = cleanCompany(textOf(companyEl) || jsonLd?.company || meta.company);
    let description =
      textOf(descEl) ||
      longestText(DESCRIPTION_SELECTORS) ||
      jsonLd?.description ||
      meta.description ||
      '';

    // Drop short/noisy description fragments (sign-in CTAs, etc.)
    if (description && description.length < 120) {
      const richer =
        jsonLd?.description ||
        longestText([
          '.show-more-less-html__markup',
          '#job-details',
          '.jobs-description__content',
          '.description__text',
        ]);
      if (richer && richer.length > description.length) description = richer;
    }

    // Avoid capturing global nav "LinkedIn" as title
    if (title && /^(linkedin|home|jobs)$/i.test(title)) {
      title = cleanTitle(jsonLd?.title || meta.title || '');
    }

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
      source: jsonLd ? 'json-ld+dom' : 'dom',
    };
  }

  function setApplyDisabled(disabled) {
    pacingAtCap = disabled;
    const buttons = [];
    for (const sel of APPLY_BUTTON_SELECTORS) {
      try {
        document.querySelectorAll(sel).forEach((btn) => buttons.push(btn));
      } catch {
        /* skip */
      }
    }

    const unique = [...new Set(buttons)];
    unique.forEach((btn) => {
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
      /* extension context may be unavailable during reload */
    }
  }

  document.addEventListener(
    'click',
    (e) => {
      if (!pacingAtCap) return;
      const hit = APPLY_BUTTON_SELECTORS.some((sel) => {
        try {
          return Boolean(e.target?.closest?.(sel));
        } catch {
          return false;
        }
      });
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        ensureOverlay(true);
      }
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

  const domObserver = new MutationObserver(() => {
    if (pacingAtCap) setApplyDisabled(true);
  });
  if (document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true });
  }

  syncPacing();
  setInterval(syncPacing, 30_000);
})();
