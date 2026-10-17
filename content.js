/**
 * LinkedIn Jobs DOM scraper + apply-button pacing overlay.
 */

(function () {
  'use strict';

  const TITLE_SELECTORS = [
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title a',
    '.jobs-unified-top-card__job-title',
    'h1.t-24',
    '.jobs-details-top-card__job-title',
    '[data-test-job-title]',
  ];

  const COMPANY_SELECTORS = [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    '.jobs-details-top-card__company-url',
    '[data-test-company-name]',
  ];

  const DESCRIPTION_SELECTORS = [
    '#job-details',
    '.jobs-description__content',
    '.jobs-box__html-content',
    '.jobs-description-content__text',
    'article.jobs-description__container',
    '.job-view-layout .jobs-description',
  ];

  const APPLY_BUTTON_SELECTORS = [
    'button.jobs-apply-button',
    '.jobs-apply-button',
    'button[aria-label*="Easy Apply"]',
    'button[aria-label*="Apply"]',
    '.jobs-s-apply button',
    '#jobs-apply-button-id',
  ];

  let lastUrl = location.href;
  let pacingAtCap = false;

  function queryFirst(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch {
        /* invalid selector — skip */
      }
    }
    return null;
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function scrapeJob() {
    const titleEl = queryFirst(TITLE_SELECTORS);
    const companyEl = queryFirst(COMPANY_SELECTORS);
    const descEl = queryFirst(DESCRIPTION_SELECTORS);

    const title = textOf(titleEl);
    const company = textOf(companyEl);
    const description = textOf(descEl);
    const url = location.href.split('?')[0];

    const missing = [];
    if (!title) missing.push('title');
    if (!company) missing.push('company');
    if (!description) missing.push('description');

    return {
      title,
      company,
      description,
      url,
      scrapedAt: new Date().toISOString(),
      ok: missing.length === 0,
      missing,
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

  // Intercept apply clicks when at cap
  document.addEventListener(
    'click',
    (e) => {
      if (!pacingAtCap) return;
      const target = e.target?.closest?.(APPLY_BUTTON_SELECTORS.join(','));
      if (target || e.target?.closest?.('.jobs-apply-button')) {
        e.preventDefault();
        e.stopPropagation();
        ensureOverlay(true);
      }
    },
    true
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SCRAPE_JOB') {
      const job = scrapeJob();
      sendResponse(job);
      return false;
    }
    if (message?.type === 'PACING_UPDATED') {
      setApplyDisabled(Boolean(message.atCap));
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  // SPA navigation watch
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        syncPacing();
      }, 600);
    }
  });
  urlObserver.observe(document.documentElement, { childList: true, subtree: true });

  // Re-apply disabled styling when LinkedIn re-renders buttons
  const domObserver = new MutationObserver(() => {
    if (pacingAtCap) setApplyDisabled(true);
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  syncPacing();
  setInterval(syncPacing, 30_000);
})();
