/**
 * Local Gmail inbox filter for likely job rejection messages.
 * It changes only the visible inbox row and never opens, moves, or deletes mail.
 */

(function () {
  'use strict';

  const ROW_SELECTOR = [
    'tr.zA',
    'tr[data-legacy-thread-id]',
    'tr[role="link"][data-thread-id]',
  ].join(',');

  const REJECTION_PATTERNS = [
    // Explicit user preference: hide generic application-status updates even
    // when Gmail's inbox preview does not expose the rejection wording.
    /\b(?:job\s+)?application\s+(?:status\s+)?update\b/i,
    /\b(?:will|would|can|could)\s+not\s+(?:be\s+)?moving\s+forward\b/i,
    /\bnot\s+moving\s+forward\s+with\s+(?:your|the)\s+application\b/i,
    /\bdecided\s+not\s+to\s+(?:move|proceed|continue)\b/i,
    /\b(?:we|i)\s+(?:have\s+)?chosen\s+to\s+(?:move|proceed|continue)\s+with\s+other\s+candidates\b/i,
    /\b(?:pursue|proceed|move forward)\s+with\s+other\s+candidates\b/i,
    /\bwe\s+regret\s+to\s+inform\s+you\b/i,
    /\byour\s+application\s+(?:has\s+been|was)\s+(?:unsuccessful|declined|rejected)\b/i,
    /\byou\s+(?:have\s+)?not\s+been\s+selected\b/i,
    /\b(?:were|are)\s+not\s+among\s+(?:those|the candidates)\s+selected\b/i,
    /\bnot\s+(?:be\s+)?advancing\s+(?:your|the)\s+application\b/i,
    /\bdecided\s+to\s+pursue\s+(?:a\s+)?different\s+candidate\b/i,
    /\bnot\s+(?:a\s+)?(?:strong\s+)?fit\s+(?:for\s+.{0,100}\s+)?at\s+this\s+time\b/i,
    /\bposition\s+(?:has\s+been|was)\s+(?:filled|closed|cancelled|canceled)\b/i,
    /\bunable\s+to\s+(?:offer|advance|proceed|move\s+forward)\b/i,
    /\bafter\s+careful\s+(?:consideration|review)\b.{0,180}\b(?:not|other candidates)\b/i,
    /\bthank\s+you\s+for\s+(?:your\s+)?(?:interest|applying)\b.{0,220}\bnot\s+(?:be\s+)?moving\s+forward\b/i,
  ];

  function normalize(value) {
    return String(value || '')
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2500);
  }

  function messagePreview(row) {
    const subject = row.querySelector('.bog, [data-thread-subject], [role="link"] span[email] + span');
    const snippet = row.querySelector('.y2, [data-snippet]');
    const focused = normalize(
      `${subject?.innerText || subject?.textContent || ''} ${
        snippet?.innerText || snippet?.textContent || ''
      }`
    );
    if (focused) return focused;
    return normalize(row.innerText || row.textContent).replace(
      /Application update hidden\s*Show anyway/gi,
      ''
    );
  }

  function textHash(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return `${text.length}:${hash >>> 0}`;
  }

  function isLikelyRejection(text) {
    return REJECTION_PATTERNS.some((pattern) => pattern.test(text));
  }

  function clearCover(row) {
    row.classList.remove('sjsc-rejection-email-hidden');
    row.querySelector('.sjsc-rejection-email-cover')?.remove();
  }

  function revealRow(row, hash) {
    row.dataset.sjscRejectionRevealedHash = hash;
    row.dataset.sjscRejectionCheckedHash = hash;
    clearCover(row);
  }

  function hideRow(row, hash) {
    if (row.classList.contains('sjsc-rejection-email-hidden')) return;

    const target =
      row.querySelector('td.xY.a4W, td[role="main"], td:nth-last-child(2)') ||
      row.querySelector('td');
    if (!target) return;

    row.classList.add('sjsc-rejection-email-hidden');
    row.dataset.sjscRejectionCheckedHash = hash;

    const cover = document.createElement('div');
    cover.className = 'sjsc-rejection-email-cover';
    cover.setAttribute('role', 'status');
    cover.setAttribute('aria-label', 'Likely job rejection email hidden');

    const label = document.createElement('span');
    label.className = 'sjsc-rejection-email-label';
    label.textContent = 'Application update hidden';

    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'sjsc-rejection-email-show';
    show.textContent = 'Show anyway';
    show.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      revealRow(row, hash);
    });

    cover.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    cover.append(label, show);
    target.appendChild(cover);
  }

  function inspectRow(row) {
    if (!(row instanceof Element)) return;
    const preview = messagePreview(row);
    if (!preview) return;
    const hash = textHash(preview);

    if (
      row.dataset.sjscRejectionCheckedHash &&
      row.dataset.sjscRejectionCheckedHash !== hash
    ) {
      clearCover(row);
      delete row.dataset.sjscRejectionCheckedHash;
    }

    if (row.dataset.sjscRejectionRevealedHash === hash) return;
    if (row.dataset.sjscRejectionCheckedHash === hash) return;

    row.dataset.sjscRejectionCheckedHash = hash;
    if (isLikelyRejection(preview)) hideRow(row, hash);
  }

  function scan(root = document) {
    if (root instanceof Element && root.matches(ROW_SELECTOR)) inspectRow(root);
    root.querySelectorAll?.(ROW_SELECTOR).forEach(inspectRow);
  }

  let timer = null;
  function scheduleScan() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      scan(document);
    }, 180);
  }

  new MutationObserver((mutations) => {
    if (
      mutations.some(
        (mutation) => mutation.addedNodes.length || mutation.type === 'characterData'
      )
    ) {
      scheduleScan();
    }
  }).observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  scan();
})();
