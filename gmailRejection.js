/**
 * Gmail integration for explicit, single-message rejection analysis.
 * Nothing is scanned automatically: the open message is read only after the
 * user clicks the injected button.
 */

(function () {
  'use strict';

  const BUTTON_ID = 'sjsc-analyze-rejection';
  const RESULT_ID = 'sjsc-rejection-result';
  const SUBJECT_SELECTOR = 'h2.hP, h2[data-thread-perm-id], [role="main"] h2';
  const BODY_SELECTOR = '.a3s.aiL, .a3s, [data-message-id] [dir="ltr"]';
  const SENDER_SELECTOR = '.gD[email], [data-hovercard-id][email], span[email]';

  function cleanText(value, max) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function isVisible(node) {
    if (!node || node.closest('[aria-hidden="true"]')) return false;
    const style = globalThis.getComputedStyle?.(node);
    return style?.display !== 'none' && style?.visibility !== 'hidden';
  }

  function lastVisible(selector) {
    return [...document.querySelectorAll(selector)].filter(isVisible).pop() || null;
  }

  function readOpenEmail() {
    const subjectNode = lastVisible(SUBJECT_SELECTOR);
    const bodyNode = lastVisible(BODY_SELECTOR);
    const senderNode = lastVisible(SENDER_SELECTOR);
    const subject = cleanText(subjectNode?.innerText || subjectNode?.textContent, 300);
    const body = cleanText(bodyNode?.innerText || bodyNode?.textContent, 12000);
    const sender = cleanText(
      senderNode?.getAttribute?.('email') ||
        senderNode?.getAttribute?.('data-hovercard-id') ||
        senderNode?.innerText ||
        senderNode?.textContent,
      200
    );

    if (!subject || body.length < 20) return null;
    return {
      subject,
      sender,
      body,
      sourceKey: `${location.pathname}${location.hash}`.slice(0, 500),
    };
  }

  function closeResult() {
    document.getElementById(RESULT_ID)?.remove();
  }

  function showResult(response) {
    closeResult();
    const card = document.createElement('aside');
    card.id = RESULT_ID;
    card.setAttribute('role', 'status');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sjsc-rejection-close';
    close.setAttribute('aria-label', 'Close rejection recovery result');
    close.textContent = '×';
    close.addEventListener('click', closeResult);

    const kicker = document.createElement('span');
    kicker.className = 'sjsc-rejection-kicker';
    kicker.textContent = 'Rejection recovery';

    const title = document.createElement('strong');
    title.textContent = response?.ok
      ? response.notRejection
        ? 'Not identified as a rejection'
        : response.duplicate
          ? 'Already logged'
          : 'Logged without judgment'
      : 'Could not analyze this email';

    const reflection = document.createElement('p');
    reflection.textContent =
      response?.record?.reflection ||
      response?.error ||
      'No recovery guidance was returned.';

    card.append(close, kicker, title, reflection);

    if (response?.record?.nextStep) {
      const next = document.createElement('p');
      next.className = 'sjsc-rejection-next';
      const label = document.createElement('b');
      label.textContent = 'One next step: ';
      next.append(label, document.createTextNode(response.record.nextStep));
      card.appendChild(next);
    }

    document.body.appendChild(card);
  }

  async function analyzeOpenEmail(button) {
    const email = readOpenEmail();
    if (!email) {
      showResult({ ok: false, error: 'Open a complete email message first.' });
      return;
    }

    button.disabled = true;
    button.textContent = 'Analyzing…';
    try {
      if (!chrome.runtime?.id) {
        throw new Error('Extension context invalidated.');
      }
      const response = await chrome.runtime.sendMessage({
        type: 'ANALYZE_REJECTION',
        email,
      });
      showResult(response);
    } catch (err) {
      const invalidated =
        !chrome.runtime?.id || /extension context invalidated/i.test(err?.message || '');
      showResult({
        ok: false,
        error: invalidated
          ? 'The extension was reloaded. Refresh this Gmail tab, reopen the email, then try again.'
          : err?.message || 'Extension analysis failed.',
      });
    } finally {
      button.disabled = false;
      button.textContent = 'Analyze rejection';
    }
  }

  function syncButton() {
    const email = readOpenEmail();
    const existing = document.getElementById(BUTTON_ID);
    if (!email) {
      existing?.remove();
      closeResult();
      return;
    }
    if (existing) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Analyze rejection';
    button.title = 'Sends this open email and your saved resume profile to Gemini.';
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', () => analyzeOpenEmail(button));
    document.body.appendChild(button);
  }

  let timer = null;
  const scheduleSync = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      syncButton();
    }, 250);
  };

  new MutationObserver(scheduleSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  syncButton();
})();
