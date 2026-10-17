/**
 * LinkedIn Home focus filter.
 *
 * Collapses first-person "I'm joining / starting a new role" announcements.
 * It intentionally requires both a personal announcement signal and a career
 * transition signal so ordinary technical posts and company news remain.
 */

function sjscNormalizePostText(value) {
  return String(value || '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sjscIsCareerAnnouncement(value) {
  const text = sjscNormalizePostText(value);
  if (text.length < 30) return false;

  const personal = /\b(?:i|i'm|i am|i'll|i will|i've|i have|my)\b/i.test(text);
  const celebratory =
    /\b(?:thrilled|excited|happy|pleased|delighted|honou?red|proud|glad)\b.{0,180}\b(?:share|announce|say)\b/i.test(
      text
    );
  const transition =
    /\b(?:i(?:'m| am|'ll| will|'ve| have)?\s+(?:be\s+)?(?:joining|joined|starting|started)|(?:and\s+)?joining\s+[\w&.-]+(?:\s+[\w&.-]+){0,4}\s+as\s+an?|starting\s+(?:a\s+)?new\s+(?:role|position|job|chapter)|started\s+(?:a\s+)?new\s+(?:role|position|job)|accepted\s+(?:an?\s+)?(?:offer|position|role))\b/i.test(
      text
    );
  const careerContext =
    /\b(?:at|with|as\s+an?|company|team|role|position|intern(?:ship)?|engineer|developer|analyst|manager|designer|consultant)\b/i.test(
      text
    );

  return personal && transition && (celebratory || careerContext);
}

(function initCareerAnnouncementFilter() {
  if (!/^\/(?:feed\/?)?$/.test(location.pathname)) return;
  if (globalThis.__sjscCareerAnnouncementFilter) return;
  globalThis.__sjscCareerAnnouncementFilter = true;

  const POST_SELECTOR = [
    '[data-view-name="feed-full-update"]',
    '.feed-shared-update-v2',
    '.occludable-update',
    '[data-urn^="urn:li:activity"]',
    'main article',
  ].join(',');

  function hashText(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return String(hash >>> 0);
  }

  function postText(post) {
    const clone = post.cloneNode(true);
    clone.querySelectorAll('.sjsc-career-placeholder').forEach((node) => node.remove());
    return sjscNormalizePostText(clone.textContent);
  }

  function unfilter(post, allowHash = '') {
    post.classList.remove('sjsc-career-post-hidden');
    post.querySelector(':scope > .sjsc-career-placeholder')?.remove();
    if (allowHash) post.dataset.sjscCareerAllowedHash = allowHash;
  }

  function filterPost(post, hash) {
    if (post.classList.contains('sjsc-career-post-hidden')) return;
    post.classList.add('sjsc-career-post-hidden');

    const placeholder = document.createElement('div');
    placeholder.className = 'sjsc-career-placeholder';
    placeholder.setAttribute('role', 'note');

    const copy = document.createElement('div');
    copy.className = 'sjsc-career-placeholder-copy';
    const title = document.createElement('strong');
    title.textContent = 'Career announcement hidden';
    const detail = document.createElement('span');
    detail.textContent = 'Filtered to keep your LinkedIn feed focused.';
    copy.append(title, detail);

    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'sjsc-career-show';
    show.textContent = 'Show post';
    show.addEventListener('click', () => unfilter(post, hash));

    placeholder.append(copy, show);
    post.appendChild(placeholder);
  }

  function inspect(post) {
    if (!(post instanceof Element) || !post.closest('main')) return;
    const text = postText(post);
    if (!text) return;
    const hash = hashText(text);

    // LinkedIn virtualizes/reuses feed nodes. Reset our state when the post
    // content changes so a previously allowed item cannot exempt a new post.
    if (post.dataset.sjscCareerHash && post.dataset.sjscCareerHash !== hash) {
      unfilter(post);
      delete post.dataset.sjscCareerAllowedHash;
    }
    post.dataset.sjscCareerHash = hash;

    if (post.dataset.sjscCareerAllowedHash === hash) return;
    if (sjscIsCareerAnnouncement(text)) {
      filterPost(post, hash);
    } else {
      unfilter(post);
    }
  }

  function scan(root = document) {
    if (root instanceof Element && root.matches(POST_SELECTOR)) inspect(root);
    root.querySelectorAll?.(POST_SELECTOR).forEach(inspect);
  }

  let scanTimer = null;
  const observer = new MutationObserver((mutations) => {
    if (scanTimer) return;
    const roots = mutations.map((mutation) => mutation.target);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      roots.forEach((root) => {
        const post = root.closest?.(POST_SELECTOR);
        if (post) inspect(post);
        else scan(root);
      });
    }, 200);
  });

  scan();
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
})();
