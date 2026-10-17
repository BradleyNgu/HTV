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
    '[data-view-name*="feed-update"]',
    '[data-testid*="feed-update"]',
    '[data-urn^="urn:li:activity"]',
    '[data-id^="urn:li:activity"]',
    '[role="article"]',
    'main article',
  ].join(',');

  const TEXT_SELECTOR = [
    '.update-components-text',
    '.feed-shared-update-v2__description-wrapper',
    '.feed-shared-inline-show-more-text',
    '[data-view-name="feed-commentary"]',
    '[data-test-id="main-feed-activity-card__commentary"]',
  ].join(',');

  const TEXT_CANDIDATE_SELECTOR = [
    'main [data-view-name*="commentary"]',
    'main [data-test-id*="commentary"]',
    'main [dir="ltr"]',
    'main p',
  ].join(',');

  const AUTHOR_HEADLINE_SELECTOR = [
    '.update-components-actor__description',
    '.feed-shared-actor__description',
    '[data-view-name="feed-actor-description"]',
    '[data-test-id*="actor-description"]',
  ].join(',');

  // "Joining" is an explicit broad preference. Other forms stay narrow enough
  // to avoid blocking recruiting posts such as "join our team".
  const ANNOUNCEMENT_PATTERNS = [
    // User preference: any feed post containing the exact word "joining".
    /\bjoining\b/i,
    // "I will be interning at Coinbase next summer."
    /\binterning\s+(?:at|with)\b/i,
    // "I'm thrilled to share ... joining Wealthsimple as a Software Engineer"
    /\b(?:i am|i'm|i'll|i will)\s+(?:so\s+)?(?:thrilled|excited|happy|delighted|pleased|proud|grateful)\s+to\s+(?:share|announce)\b.{0,500}\b(?:joining|joined|started|starting|accepted)\b/i,
    // "I'll be joining Acme as a..."
    /\b(?:i am|i'm|i'll|i will)\b.{0,220}\b(?:joining|joined)\s+.{2,140}\s+as\s+(?:an?\s+)?/i,
    // "I am starting a new position at..."
    /\b(?:i am|i'm|i'll|i will|i have|i've)\b.{0,100}\b(?:started|starting)\s+(?:a\s+)?new\s+(?:position|role|job|chapter)\s+(?:at|with)\b/i,
    // "I've started a new role as Software Engineer at Shopify."
    /\b(?:started|starting)\s+(?:a\s+)?new\s+(?:position|role|job)\s+as\s+.{2,120}\s+(?:at|with)\b/i,
    // "I'm working at Scribenote as a Data Science Co-op."
    /\b(?:i am|i'm)\s+(?:now\s+)?working\s+(?:at|with)\s+.{2,140}\s+as\s+(?:an?\s+)?/i,
    // "I accepted an offer at..."
    /\b(?:i have|i've|i am|i'm)\b.{0,100}\b(?:accepted|accepting)\s+(?:an?\s+)?(?:offer|position|role)\b.{0,100}\b(?:at|with)\b/i,
    // "I've accepted my offer to join Deloitte as an Analyst."
    /\b(?:accepted|accepting)\s+(?:(?:my|the|an?)\s+)?offer\s+to\s+join\b/i,
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

  function textHash(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return `${text.length}:${hash >>> 0}`;
  }

  function postText(post) {
    const focused = post.querySelector(TEXT_SELECTOR);
    const focusedText = normalize(focused?.innerText || focused?.textContent);
    if (isCareerAnnouncement(focusedText)) return focusedText;

    // Reposts may put the announcement in an embedded card rather than the
    // current author's commentary, so use the full post as a fallback.
    return normalize(post.innerText || post.textContent);
  }

  function authorHeadline(post) {
    const headline = post.querySelector(AUTHOR_HEADLINE_SELECTOR);
    return normalize(headline?.innerText || headline?.textContent);
  }

  function revealPost(post, overlay) {
    post.dataset.sjscFeedRevealed = 'true';
    post.classList.remove('sjsc-career-post-blocked');
    overlay.remove();
  }

  function isDarkTheme(post) {
    const root = document.documentElement;
    const marker = [
      root?.className,
      document.body?.className,
      root?.getAttribute?.('data-theme'),
      document.body?.getAttribute?.('data-theme'),
    ]
      .join(' ')
      .toLowerCase();
    if (/\bdark\b/.test(marker)) return true;
    if (/\blight\b/.test(marker)) return false;

    // LinkedIn's generated classes change often. Its computed card/page color
    // is a more durable signal than any one class name.
    if (typeof getComputedStyle === 'function') {
      for (const node of [post, post.closest?.('main'), document.body, root]) {
        if (!node) continue;
        const color = getComputedStyle(node).backgroundColor;
        const match = color?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!match || color === 'rgba(0, 0, 0, 0)') continue;
        const [, red, green, blue] = match.map(Number);
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        return luminance < 128;
      }
    }
    return Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
  }

  function blockPost(post) {
    if (
      !post ||
      post.dataset.sjscFeedRevealed === 'true' ||
      post.classList.contains('sjsc-career-post-blocked')
    ) {
      return;
    }
    const text = postText(post);
    const headline = authorHeadline(post);
    const hash = textHash(`${headline}\n${text}`);
    if (post.dataset.sjscFeedTextHash === hash) return;
    post.dataset.sjscFeedTextHash = hash;
    if (!isCareerAnnouncement(text) && !/\bincoming\b/i.test(headline)) return;

    post.classList.add('sjsc-career-post-blocked');

    const overlay = document.createElement('div');
    overlay.className = 'sjsc-career-block-overlay';
    overlay.dataset.sjscTheme = isDarkTheme(post) ? 'dark' : 'light';
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
    if (node.closest('.sjsc-career-block-overlay')) return null;
    if (node.matches(POST_SELECTOR)) return node;
    const known = node.closest(POST_SELECTOR);
    if (known) return known;

    // New LinkedIn layouts sometimes use only generated class names. Climb
    // from matching text to the nearest compact ancestor that contains the
    // post's social actions. If those controls are not rendered yet, use the
    // largest compact ancestor as a fallback.
    let current = node;
    let compact = null;
    for (let depth = 0; depth < 12 && current?.parentElement; depth += 1) {
      current = current.parentElement;
      if (current === document.body || current.tagName === 'MAIN') break;
      const text = normalize(current.innerText || current.textContent);
      if (text.length >= 30 && text.length <= 15000) compact = current;

      const hasComment = current.querySelector(
        'button[aria-label^="Comment" i], [role="button"][aria-label^="Comment" i]'
      );
      const hasReaction = current.querySelector(
        'button[aria-label*="Like" i], button[aria-label*="React" i], [data-view-name*="reaction"]'
      );
      if (hasComment && hasReaction) return current;
    }
    return compact;
  }

  function scan(root = document) {
    if (!isFeedPage()) return;

    const posts = new Set();
    const rootPost = resolvePost(root);
    if (rootPost) posts.add(rootPost);

    if (root.querySelectorAll) {
      root.querySelectorAll(POST_SELECTOR).forEach((post) => posts.add(post));
      root.querySelectorAll(TEXT_CANDIDATE_SELECTOR).forEach((node) => {
        if (isCareerAnnouncement(node.innerText || node.textContent)) {
          const post = resolvePost(node);
          if (post) posts.add(post);
        }
      });
      root.querySelectorAll(AUTHOR_HEADLINE_SELECTOR).forEach((headline) => {
        if (/\bincoming\b/i.test(headline.innerText || headline.textContent)) {
          const post = resolvePost(headline);
          if (post) posts.add(post);
        }
      });
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
    if (mutations.some((mutation) => mutation.addedNodes.length || mutation.type === 'characterData')) {
      // Scan the document rather than only the first mutation target. LinkedIn
      // batches unrelated mutations and the announcement may be in a later one.
      scheduleScan(document);
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    scan();
  }
})();
