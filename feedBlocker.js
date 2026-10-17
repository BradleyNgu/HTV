/**
 * LinkedIn home-feed filter for "I am joining..." career announcements.
 * Runs only on the home/feed route and overlays matching posts without
 * deleting them, so a false positive can be revealed deliberately.
 */

(function () {
  'use strict';

  const POST_SELECTOR = [
    '.feed-shared-update-v2',
    '[data-view-name="feed-full-update"]',
    '[data-urn^="urn:li:activity"]',
    'main article',
  ].join(',');

  const TEXT_SELECTOR = [
    '.update-components-text',
    '.feed-shared-update-v2__description-wrapper',
    '.feed-shared-inline-show-more-text',
    '[data-view-name="feed-commentary"]',
    '[data-test-id="main-feed-activity-card__commentary"]',
  ].join(',');

  // Intentionally narrow enough to avoid blocking recruiting posts such as
  // "join our team" while covering first-person and company announcements.
  const ANNOUNCEMENT_PATTERNS = [
    // "I'm thrilled to share ... joining Wealthsimple as a Software Engineer"
    /\b(?:i am|i'm|i'll|i will)\s+(?:so\s+)?(?:thrilled|excited|happy|delighted|pleased|proud|grateful)\s+to\s+(?:share|announce)\b.{0,500}\b(?:joining|joined|starting|accepted)\b/i,
    // "I'll be joining Acme as a..."
    /\b(?:i am|i'm|i'll|i will)\b.{0,220}\b(?:joining|joined)\s+.{2,140}\s+as\s+(?:an?\s+)?/i,
    // "I am starting a new position at..."
    /\b(?:i am|i'm|i'll|i will|i have|i've)\b.{0,100}\b(?:started|starting)\s+(?:a\s+)?new\s+(?:position|role|job|chapter)\s+(?:at|with)\b/i,
    // "I accepted an offer at..."
    /\b(?:i have|i've|i am|i'm)\b.{0,100}\b(?:accepted|accepting)\s+(?:an?\s+)?(?:offer|position|role)\b.{0,100}\b(?:at|with)\b/i,
    // "Incoming Software Engineer Intern at..."
    /\b(?:incoming|future)\s+.{2,100}\b(?:intern|engineer|developer|analyst|designer|manager|consultant|researcher)\b.{0,100}\bat\b/i,
    // Company/manager announcement: "Thrilled to announce Jane is joining..."
    /\b(?:thrilled|excited|happy|delighted|pleased|proud)\s+to\s+(?:share|announce|welcome)\b.{0,300}\b(?:is|will be|has)?\s*(?:joining|joined|joins)\b/i,
    // "Jane will be joining Acme as..."
    /\b(?:is|will be|has)\s+(?:officially\s+)?(?:joining|joined)\s+.{2,140}\s+as\s+(?:an?\s+)?/i,
  ];

  function isFeedPage() {
    return location.pathname === '/' || location.pathname.startsWith('/feed');
  }

  function normalize(text) {
    return String(text || '')
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12000);
  }

  function isCareerAnnouncement(text) {
    const normalized = normalize(text);
    if (!normalized) return false;
    return ANNOUNCEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  function postText(post) {
    const focused = post.querySelector(TEXT_SELECTOR);
    const focusedText = normalize(focused?.innerText || focused?.textContent);
    if (isCareerAnnouncement(focusedText)) return focusedText;

    // Reposts may put the announcement in an embedded card rather than the
    // current author's commentary, so use the full post as a fallback.
    return normalize(post.innerText || post.textContent);
  }

  function revealPost(post, overlay) {
    post.dataset.sjscFeedRevealed = 'true';
    post.classList.remove('sjsc-career-post-blocked');
    overlay.remove();
  }

  function blockPost(post) {
    if (
      !post ||
      post.dataset.sjscFeedChecked === 'true' ||
      post.dataset.sjscFeedRevealed === 'true'
    ) {
      return;
    }
    post.dataset.sjscFeedChecked = 'true';
    if (!isCareerAnnouncement(postText(post))) return;

    post.classList.add('sjsc-career-post-blocked');

    const overlay = document.createElement('div');
    overlay.className = 'sjsc-career-block-overlay';
    overlay.setAttribute('role', 'region');
    overlay.setAttribute('aria-label', 'Blocked career announcement');

    const shield = document.createElement('span');
    shield.className = 'sjsc-career-block-icon';
    shield.textContent = '✓';
    shield.setAttribute('aria-hidden', 'true');

    const title = document.createElement('strong');
    title.textContent = 'This is blocked';

    const explanation = document.createElement('p');
    explanation.textContent =
      'A new-job announcement was hidden to protect your job-search focus.';

    const reveal = document.createElement('button');
    reveal.type = 'button';
    reveal.className = 'sjsc-career-block-reveal';
    reveal.textContent = 'Show anyway';
    reveal.addEventListener('click', () => revealPost(post, overlay));

    overlay.append(shield, title, explanation, reveal);
    post.appendChild(overlay);
  }

  function resolvePost(node) {
    if (!(node instanceof Element)) return null;
    if (node.matches(POST_SELECTOR)) return node;
    return node.closest(POST_SELECTOR);
  }

  function scan(root = document) {
    if (!isFeedPage()) return;

    const posts = new Set();
    const rootPost = resolvePost(root);
    if (rootPost) posts.add(rootPost);

    if (root.querySelectorAll) {
      root.querySelectorAll(POST_SELECTOR).forEach((post) => posts.add(post));
    }
    posts.forEach(blockPost);
  }

  let scanTimer = null;
  const scheduleScan = (root) => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan(root?.isConnected ? root : document);
    }, 150);
  };

  const observer = new MutationObserver((mutations) => {
    if (!isFeedPage()) return;
    const added = mutations.find((mutation) => mutation.addedNodes.length)?.target;
    scheduleScan(added instanceof Element ? added : document);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  }
})();
